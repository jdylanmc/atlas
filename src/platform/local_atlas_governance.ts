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
import {
  governanceAttestationPayload,
  runAtlasGovernanceWorkflow,
  type AtlasGovernanceChangeSet,
  type AtlasGovernanceRequest,
  type AtlasGovernanceResult,
  type AtlasGovernanceWorkflowState,
} from "../operations/governance_operation.ts";
import { canonicalJson } from "../operations/operation_support.ts";
import { runLintOperation } from "../operations/lint_operation.ts";
import { captureLocalAtlasSnapshot } from "./local_atlas_snapshot.ts";
import {
  completeOperationWorkspace,
  discardOwnedOperationWorkspace,
  isOperationWorkspaceOwnershipConflict,
  type OperationWorkspaceOwnershipConflict,
} from "./operation_workspace.ts";
import {
  runTrustedGit,
  runTrustedGitForWrite,
  runTrustedGitWithInput,
  type TrustedGitResult,
} from "./trusted_git.ts";

// Atlas SDK does not invoke a model (docs/adr/0001-sdk-is-a-deterministic-library.md).
// This platform adapter drives the deterministic governance workflow against a
// local Git repository: it captures the base snapshot, creates an isolated
// Operation Workspace, writes the human-authored Atlas Change Set, commits it,
// and Lints the proposal. Every effect is local Git and the filesystem — no
// network, no model, no semantic judgment. Approval and semantic verdicts are
// carried by the request the operation validates; this adapter supplies none.

const lintBudgets = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
});

type GitRunner = (repository: string, args: readonly string[]) => TrustedGitResult;

function trustedGitOutput(result: TrustedGitResult): string {
  if (result.state === "failed") {
    throw new Error("trusted git command failed");
  }
  return result.stdout.trim();
}

function runOrThrow(
  run: GitRunner,
  repository: string,
  args: readonly string[],
): string {
  return trustedGitOutput(run(repository, args));
}

function git(repository: string, args: readonly string[]): string {
  return runOrThrow(runTrustedGit, repository, args);
}

function gitWrite(repository: string, args: readonly string[]): string {
  return runOrThrow(runTrustedGitForWrite, repository, args);
}

function gitWithInput(
  repository: string,
  args: readonly string[],
  input: string,
): string {
  return trustedGitOutput(
    runTrustedGitWithInput(
      repository,
      args,
      input,
      Math.max(1024, Buffer.byteLength(input, "utf8") + 1024),
    ),
  );
}

function gitSucceeds(repository: string, args: readonly string[]): boolean {
  return runTrustedGit(repository, args).state === "succeeded";
}

function treeEntry(
  repository: string,
  tree: string,
  path: string,
):
  | { readonly mode: string; readonly object: string; readonly path: string }
  | undefined {
  const output = git(repository, ["ls-tree", "-z", tree, "--", path]);
  if (output === "") return undefined;
  const [metadata = "", entryPath = ""] = output.replace(/\0$/u, "").split("\t", 2);
  const [mode = "", , object = ""] = metadata.split(" ", 3);
  return {
    mode,
    object,
    path: entryPath,
  };
}

export function writtenTreeMatchesChangeSet(
  repository: string,
  targetHead: string,
  tree: string,
  changeSet: AtlasGovernanceChangeSet,
): boolean {
  const intendedPaths = new Set(changeSet.changes.map(({ path }) => path));
  const changedPaths = git(repository, [
    "diff",
    "--name-only",
    "-z",
    targetHead,
    tree,
    "--",
  ])
    .split("\0")
    .filter((path) => path.length > 0);
  if (changedPaths.some((path) => !intendedPaths.has(path))) return false;
  for (const change of changeSet.changes) {
    const entry = treeEntry(repository, tree, change.path);
    if (change.content === null) {
      if (entry !== undefined) return false;
      continue;
    }
    const expectedObject = gitWithInput(
      repository,
      ["hash-object", "--stdin"],
      change.content,
    );
    if (
      entry?.mode !== "100644" ||
      entry.object !== expectedObject ||
      entry.path !== change.path
    ) {
      return false;
    }
  }
  return true;
}

function capturedAtlasFiles(repository: string): readonly CapturedAtlasFile[] {
  const capture = captureLocalAtlasSnapshot(repository);
  if (capture.state === "failed") throw new Error(capture.reason);
  return capture.snapshot.capturedFiles;
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

function operationLabel(request: AtlasGovernanceRequest, targetHead: string): string {
  const intent = canonicalJson(governanceAttestationPayload(request));
  return `${targetHead.slice(0, 12)}-${sha256Hex(intent).slice(0, 8)}`;
}

function proposalBranchName(label: string): string {
  return `atlas-governance-${label}`;
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
  state: AtlasGovernanceWorkflowState,
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

export function createLocalAtlasGovernanceState(
  repository: string,
  request: AtlasGovernanceRequest,
): AtlasGovernanceWorkflowState {
  const root = resolve(repository);
  const targetBranch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const targetHead = git(root, ["rev-parse", "HEAD"]);
  const label = operationLabel(request, targetHead);
  return Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    baseSnapshotDigest: digestSnapshot(root, targetHead),
    effectReceipts: Object.freeze([]),
    operationId: `governance-${label}`,
    proposalBranch: proposalBranchName(label),
    targetBranch,
    targetHead,
  });
}

export function notCompletedLocalGovernanceResult(
  reason: string,
  summary: string,
): AtlasGovernanceResult {
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
      checkId: "sdk-core.atlas-governance-command",
      kind: "sdk-core" as const,
      trusted: true as const,
    }),
    code: "ATLAS_GOVERNANCE_CAPTURE_FAILED",
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
        kind: "governance" as const,
        subject: "principle" as const,
      }),
      proposedChanges: Object.freeze({ reason: summary, state: "unknown" as const }),
      recommendedNextAction:
        "Run governance from a Git worktree whose target branch carries a readable .atlas, then retry.",
      result: Object.freeze({ disposition: "failed" as const, summary }),
      reviewLink: Object.freeze({
        reason: "Governance did not create an Atlas Proposal.",
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
      kind: "governance" as const,
      subject: "principle" as const,
    }),
    payload: Object.freeze({ state: "not-completed" as const, workflowState: state }),
  });
}

export function runLocalAtlasGovernance(
  repository: string,
  request: AtlasGovernanceRequest,
): AtlasGovernanceResult {
  const root = resolve(repository);
  let workflowState: AtlasGovernanceWorkflowState;
  try {
    workflowState = createLocalAtlasGovernanceState(root, request);
    excludeOperationWorkspaces(root);
  } catch {
    return notCompletedLocalGovernanceResult(
      "Atlas Governance could not capture a Git-backed base snapshot for the Atlas Host Directory.",
      "Governance could not start from the selected Atlas Host Directory.",
    );
  }

  const workspace = workspacePath(root, workflowState.proposalBranch);
  const progress: {
    completionConflict?: OperationWorkspaceOwnershipConflict;
    created: boolean;
    retirementConflict?: string;
  } = {
    created: false,
  };
  const result = runAtlasGovernanceWorkflow(workflowState, request, {
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
        `Governance ${request.action} ${request.subject}`,
      ]);
      gitWrite(workspace, [
        "update-ref",
        `refs/heads/${workflowState.proposalBranch}`,
        commit,
      ]);
      try {
        completeOperationWorkspace(workspace, parent, commit);
      } catch (error) {
        if (isOperationWorkspaceOwnershipConflict(error)) {
          progress.completionConflict = error;
        }
        throw error;
      }
      return { commit, receipt: commit, tree };
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
      progress.created = true;
      const gitDirectory = git(workspace, ["rev-parse", "--git-dir"]);
      const gitDirectoryPath = resolve(workspace, gitDirectory);
      mkdirSync(join(gitDirectoryPath, "info"), { recursive: true });
      gitWrite(workspace, ["read-tree", workflowState.targetHead]);
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
    persistState: (nextState: AtlasGovernanceWorkflowState) => {
      writeStateAtomically(root, nextState);
    },
    referenceTime: () => new Date().toISOString(),
    workspaceExists: () => workspaceExists(root, workflowState.proposalBranch),
    workspacePathValid: () =>
      workspacePathIsContained(root, workflowState.proposalBranch),
    writeChangeSet: (changeSet: AtlasGovernanceChangeSet) => {
      const removals = new Set(
        changeSet.changes
          .filter((change) => change.content === null)
          .map((change) => change.path),
      );
      for (const path of removals) {
        if (lstatSync(join(workspace, path), { throwIfNoEntry: false }) !== undefined) {
          progress.retirementConflict = path;
          throw new Error(
            `Refusing to overwrite an existing retirement target in the Operation Workspace: ${path}`,
          );
        }
      }
      materializeCapturedAtlasFiles(
        workspace,
        capturedAtlasFiles(root).filter((file) => !removals.has(file.path)),
      );
      for (const change of changeSet.changes) {
        if (change.content === null) {
          gitWrite(workspace, ["update-index", "--force-remove", "--", change.path]);
          continue;
        }
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
      const writtenTree = gitWrite(workspace, ["write-tree"]);
      return {
        receipt: writtenTree,
        verifiedChangeSet: writtenTreeMatchesChangeSet(
          workspace,
          workflowState.targetHead,
          writtenTree,
          changeSet,
        ),
      };
    },
  });
  if (progress.retirementConflict !== undefined) {
    return Object.freeze({
      ...result,
      handoff: Object.freeze({
        ...result.handoff,
        recommendedNextAction: `Operation Workspace ${workspace} was retained for inspection: unexpected path ${progress.retirementConflict} was not removed. Resolve competing work before retrying.`,
      }),
    });
  }
  if (progress.completionConflict !== undefined) {
    return Object.freeze({
      ...result,
      handoff: Object.freeze({
        ...result.handoff,
        recommendedNextAction:
          `Operation Workspace ${workspace} was retained for inspection after an ownership conflict at ` +
          `${progress.completionConflict.path}. Resolve or preserve the competing path before retrying.`,
      }),
    });
  }
  // A worktree this invocation created but could not carry to a completed
  // proposal is torn down so a corrected retry at the same target HEAD is not
  // wedged. A completed proposal is kept for review; a pre-existing workspace
  // (created === false) is left untouched.
  if (progress.created && result.completion !== "completed") {
    discardOwnedOperationWorkspace(root, workspace, workflowState.proposalBranch);
  }
  return result;
}
