import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { sha256Hex } from "../atlas/sha256.ts";
import { runLintOperation } from "../operations/lint_operation.ts";
import {
  runAtlasIngestWorkflow,
  type AtlasIngestChangeSet,
  type AtlasIngestRequest,
  type AtlasIngestResult,
  type AtlasIngestSourceCapture,
  type AtlasIngestWorkflowState,
} from "../operations/ingest_operation.ts";
import { captureLocalAtlasSnapshot } from "./local_atlas_snapshot.ts";
import {
  runTrustedGit,
  runTrustedGitForWrite,
  type TrustedGitResult,
} from "./trusted_git.ts";

// Atlas SDK does not invoke a model (docs/adr/0001-sdk-is-a-deterministic-library.md).
// This platform adapter drives the deterministic Ingest workflow against a local
// Git repository: it captures the base snapshot, creates an isolated Operation
// Workspace, writes the reconciled Atlas Change Set, commits it, and Lints the
// proposal. Every effect is local Git and the filesystem — no network, no model.

const lintBudgets = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
});

type GitRunner = (repository: string, args: readonly string[]) => TrustedGitResult;

function runOrThrow(
  run: GitRunner,
  repository: string,
  args: readonly string[],
): string {
  const result = run(repository, args);
  if (result.state === "failed") {
    throw new Error("trusted git command failed");
  }
  return result.stdout.trim();
}

function git(repository: string, args: readonly string[]): string {
  return runOrThrow(runTrustedGit, repository, args);
}

function gitWrite(repository: string, args: readonly string[]): string {
  return runOrThrow(runTrustedGitForWrite, repository, args);
}

function gitSucceeds(repository: string, args: readonly string[]): boolean {
  return runTrustedGit(repository, args).state === "succeeded";
}

function capturedAtlasFiles(repository: string): readonly CapturedAtlasFile[] {
  const capture = captureLocalAtlasSnapshot(repository);
  if (capture.state === "failed") throw new Error(capture.reason);
  return capture.snapshot.capturedFiles;
}

/**
 * Independently captures each asserted Source locator's bytes and last commit
 * time straight from the immutable Git base snapshot, rather than trusting the
 * crawler's own claim. A locator this host is unable to read at `targetHead`
 * (absent, renamed, or not yet committed) is simply omitted, so Ingest
 * validation reports it as uncapturable instead of this adapter throwing. Once
 * that same locator's bytes are confirmed present at `targetHead`, its commit
 * history for that path is expected to resolve too; a `git log` failure at that
 * point is treated as the same class of unexpected runtime failure every other
 * trusted Git call in this adapter throws on, rather than a second silent
 * degradation path.
 */
function capturedSourceRevisions(
  repository: string,
  targetHead: string,
  locators: readonly string[],
): ReadonlyMap<string, AtlasIngestSourceCapture> {
  const captures = new Map<string, AtlasIngestSourceCapture>();
  for (const locator of new Set(locators)) {
    const content = runTrustedGit(repository, ["show", `${targetHead}:${locator}`]);
    if (content.state === "failed") continue;
    const revisionTime = git(repository, [
      "log",
      "-1",
      "--format=%cI",
      targetHead,
      "--",
      locator,
    ]);
    captures.set(locator, {
      commit: targetHead,
      content: content.stdout,
      revisionTime,
    });
  }
  return Object.freeze(captures);
}

function digestSnapshot(repository: string, targetHead: string): string {
  const hash = createHash("sha256");
  hash.update(`target\0${targetHead}\0`);
  for (const file of capturedAtlasFiles(repository)) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(createHash("sha256").update(file.bytes).digest("hex"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function operationLabel(sourceId: string, targetHead: string): string {
  return `${targetHead.slice(0, 12)}-${sha256Hex(sourceId).slice(0, 8)}`;
}

function proposalBranchName(label: string): string {
  return `atlas-ingest-${label}`;
}

function workspacePath(repository: string, proposalBranch: string): string {
  return join(repository, ".atlas-operation-workspaces", proposalBranch);
}

function workspaceExists(repository: string, proposalBranch: string): boolean {
  return (
    existsSync(workspacePath(repository, proposalBranch)) ||
    gitSucceeds(repository, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${proposalBranch}`,
    ])
  );
}

function workspacePathIsContained(repository: string, proposalBranch: string): boolean {
  const repositoryRoot = realpathSync(repository);
  let current = repositoryRoot;
  for (const component of [
    ".atlas-operation-workspaces",
    ...proposalBranch.split("/"),
  ]) {
    current = join(current, component);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (stat.isSymbolicLink()) return false;
  }
  return true;
}

function statePath(repository: string, proposalBranch: string): string {
  return join(workspacePath(repository, proposalBranch), ".atlas-operation-state.json");
}

function materializeCapturedAtlasFiles(
  workspace: string,
  files: readonly CapturedAtlasFile[],
): void {
  for (const file of files) {
    const path = join(workspace, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes);
  }
}

function writeStateAtomically(
  repository: string,
  state: AtlasIngestWorkflowState,
): void {
  const path = statePath(repository, state.proposalBranch);
  const pending = `${path}.next`;
  writeFileSync(pending, `${JSON.stringify(state)}\n`, "utf8");
  renameSync(pending, path);
}

function gitCommonDirectory(repository: string): string {
  const common = git(repository, ["rev-parse", "--git-common-dir"]);
  return resolve(repository, common);
}

function excludeOperationWorkspaces(repository: string): void {
  const excludePath = join(gitCommonDirectory(repository), "info", "exclude");
  mkdirSync(dirname(excludePath), { recursive: true });
  let content: string;
  try {
    content = readFileSync(excludePath, "utf8");
  } catch {
    content = "";
  }
  const entry = ".atlas-operation-workspaces/";
  if (content.split(/\r?\n/u).includes(entry)) return;
  appendFileSync(excludePath, `\n${entry}\n`, "utf8");
}

export function createLocalAtlasIngestState(
  repository: string,
  request: AtlasIngestRequest,
): AtlasIngestWorkflowState {
  const root = resolve(repository);
  const targetBranch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const targetHead = git(root, ["rev-parse", "HEAD"]);
  const label = operationLabel(request.scope.sourceId, targetHead);
  return Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    baseSnapshotDigest: digestSnapshot(root, targetHead),
    effectReceipts: Object.freeze([]),
    operationId: `ingest-${label}`,
    proposalBranch: proposalBranchName(label),
    targetBranch,
    targetHead,
  });
}

export function notCompletedLocalIngestResult(
  reason: string,
  summary: string,
): AtlasIngestResult {
  const state = Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    baseSnapshotDigest: "unknown",
    effectReceipts: Object.freeze([]),
    operationId: "unknown",
    proposalBranch: "unknown",
    targetBranch: "unknown",
    targetHead: "unknown",
  });
  const finding = Object.freeze({
    attribution: Object.freeze({
      checkId: "sdk-core.atlas-ingest-command",
      kind: "sdk-core" as const,
      trusted: true as const,
    }),
    code: "ATLAS_INGEST_CAPTURE_FAILED",
    "finding-schema": "1.0.0" as const,
    message: reason,
    path: ".atlas",
    severity: "error" as const,
  });
  return Object.freeze({
    "operation-result-schema": "1.0.0" as const,
    completion: "not-completed" as const,
    disposition: "failed" as const,
    handoff: Object.freeze({
      "operation-handoff-schema": "1.0.0" as const,
      baseSnapshot: Object.freeze({ reason, state: "unknown" as const }),
      degradationState: Object.freeze({
        reason: summary,
        state: "not-degraded" as const,
      }),
      homeAtlas: Object.freeze({ reason, state: "unknown" as const }),
      operation: Object.freeze({
        kind: "ingest" as const,
        subject: "repository-source" as const,
      }),
      proposedChanges: Object.freeze({ reason: summary, state: "unknown" as const }),
      recommendedNextAction:
        "Run Ingest from a Git worktree whose target branch carries a readable .atlas, then retry.",
      result: Object.freeze({ disposition: "failed" as const, summary }),
      reviewLink: Object.freeze({
        reason: "Ingest did not create an Atlas Proposal.",
        state: "not-applicable" as const,
      }),
      unresolvedHumanDecisions: Object.freeze({
        state: "none" as const,
        summary: "No unresolved human decision is encoded in this result.",
      }),
      validationState: Object.freeze({
        findings: Object.freeze([finding]),
        state: "not-completed" as const,
      }),
    }),
    operation: Object.freeze({
      kind: "ingest" as const,
      subject: "repository-source" as const,
    }),
    payload: Object.freeze({ state: "not-completed" as const, workflowState: state }),
  });
}

export function runLocalAtlasIngest(
  repository: string,
  request: AtlasIngestRequest,
): AtlasIngestResult {
  const root = resolve(repository);
  let workflowState: AtlasIngestWorkflowState;
  try {
    workflowState = createLocalAtlasIngestState(root, request);
    excludeOperationWorkspaces(root);
  } catch {
    return notCompletedLocalIngestResult(
      "Atlas Ingest could not capture a Git-backed base snapshot for the Atlas Host Directory.",
      "Ingest could not start from the selected Atlas Host Directory.",
    );
  }

  const workspace = workspacePath(root, workflowState.proposalBranch);
  return runAtlasIngestWorkflow(workflowState, request, {
    capturedSources: () =>
      capturedSourceRevisions(
        root,
        workflowState.targetHead,
        request.candidateGraph.sources.map((source) => source.locator),
      ),
    commitProposal: () => {
      const tree = gitWrite(workspace, ["write-tree"]);
      const parent = git(workspace, ["rev-parse", "HEAD"]);
      const commit = gitWrite(workspace, [
        "-c",
        "user.name=Atlas SDK",
        "-c",
        "user.email=atlas-sdk@example.invalid",
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        `Ingest ${request.scope.sourceId}`,
      ]);
      gitWrite(workspace, [
        "update-ref",
        `refs/heads/${workflowState.proposalBranch}`,
        commit,
      ]);
      return { commit, receipt: commit };
    },
    createProposalWorktree: () => {
      mkdirSync(dirname(workspace), { recursive: true });
      gitWrite(root, [
        "worktree",
        "add",
        "--no-checkout",
        "-b",
        workflowState.proposalBranch,
        workspace,
        workflowState.targetBranch,
      ]);
      const gitDirectory = git(workspace, ["rev-parse", "--git-dir"]);
      const gitDirectoryPath = resolve(workspace, gitDirectory);
      mkdirSync(join(gitDirectoryPath, "info"), { recursive: true });
      gitWrite(workspace, ["read-tree", workflowState.targetHead]);
      materializeCapturedAtlasFiles(workspace, capturedAtlasFiles(root));
      return { receipt: workflowState.proposalBranch };
    },
    currentBaseSnapshotDigest: () =>
      digestSnapshot(root, git(root, ["rev-parse", workflowState.targetBranch])),
    currentTargetHead: () => git(root, ["rev-parse", workflowState.targetBranch]),
    existingAtlasFiles: () => capturedAtlasFiles(root),
    lintProposal: () => {
      const lint = runLintOperation(capturedAtlasFiles(workspace), lintBudgets);
      const commit = git(workspace, ["rev-parse", "HEAD"]);
      return { lint, receipt: commit };
    },
    persistState: (nextState: AtlasIngestWorkflowState) => {
      writeStateAtomically(root, nextState);
    },
    referenceTime: () => new Date().toISOString(),
    workspaceExists: () => workspaceExists(root, workflowState.proposalBranch),
    workspacePathValid: () =>
      workspacePathIsContained(root, workflowState.proposalBranch),
    writeChangeSet: (changeSet: AtlasIngestChangeSet) => {
      for (const change of changeSet.changes) {
        const path = join(workspace, change.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, change.content, "utf8");
        const object = gitWrite(workspace, [
          "hash-object",
          "-w",
          "--no-filters",
          change.path,
        ]);
        gitWrite(workspace, [
          "update-index",
          "--add",
          "--cacheinfo",
          "100644",
          object,
          change.path,
        ]);
      }
      return {
        receipt: createHash("sha256")
          .update(workflowState.baseSnapshotDigest)
          .digest("hex"),
      };
    },
  });
}
