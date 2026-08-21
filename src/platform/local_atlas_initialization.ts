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
import {
  initialAtlasInitializationWorkflowState,
  isSafeGitBranchName,
  notCompletedAtlasInitializationResult,
  runAtlasInitializationWorkflow,
  type AtlasInitializationChangeSet,
  type AtlasInitializationWorkflowState,
} from "../operations/initialize_operation.ts";
import { runLintOperation } from "../operations/lint_operation.ts";
import { captureLocalAtlasSnapshot } from "./local_atlas_snapshot.ts";
import { runTrustedGit, runTrustedGitForWrite } from "./trusted_git.ts";

function git(repository: string, args: readonly string[]): string {
  const result = runTrustedGit(repository, args);
  if (result.state === "failed") {
    throw new Error("trusted git command failed");
  }
  return result.stdout.trim();
}

function gitWrite(repository: string, args: readonly string[]): string {
  const result = runTrustedGitForWrite(repository, args);
  if (result.state === "failed") {
    throw new Error("trusted git write command failed");
  }
  return result.stdout.trim();
}

function gitSucceeds(repository: string, args: readonly string[]): boolean {
  return runTrustedGit(repository, args).state === "succeeded";
}

function digestSnapshot(repository: string, targetHead: string): string {
  const capture = captureLocalAtlasSnapshot(repository);
  if (capture.state === "failed") throw new Error(capture.reason);
  const hash = createHash("sha256");
  hash.update(`target\0${targetHead}\0`);
  for (const file of capture.snapshot.capturedFiles) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(createHash("sha256").update(file.bytes).digest("hex"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function proposalBranchName(targetHead: string): string {
  return `atlas-initialization-${targetHead.slice(0, 12)}`;
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

function writeStateAtomically(
  repository: string,
  state: AtlasInitializationWorkflowState,
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

function parseWorkflowState(value: unknown): AtlasInitializationWorkflowState {
  if (typeof value !== "object" || value === null) {
    throw new Error("operation state is not an object");
  }
  const state = value as Partial<AtlasInitializationWorkflowState>;
  if (
    state["operation-workflow-schema"] !== "1.0.0" ||
    typeof state.baseSnapshotDigest !== "string" ||
    !Array.isArray(state.effectReceipts) ||
    typeof state.proposalBranch !== "string" ||
    typeof state.targetBranch !== "string" ||
    typeof state.targetHead !== "string"
  ) {
    throw new Error("operation state is malformed");
  }
  return Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    baseSnapshotDigest: state.baseSnapshotDigest,
    effectReceipts: Object.freeze(
      (state.effectReceipts as readonly unknown[]).map((receipt) => {
        if (
          typeof receipt !== "object" ||
          receipt === null ||
          !("effect" in receipt) ||
          !("receipt" in receipt)
        ) {
          throw new Error("operation receipt is malformed");
        }
        const record = receipt as Readonly<Record<string, unknown>>;
        const effect = record["effect"];
        if (
          effect !== "create-proposal-worktree" &&
          effect !== "write-change-set" &&
          effect !== "commit-proposal" &&
          effect !== "lint-proposal"
        ) {
          throw new Error("operation receipt effect is malformed");
        }
        const receiptValue = record["receipt"];
        if (typeof receiptValue !== "string") {
          throw new Error("operation receipt value is malformed");
        }
        return Object.freeze({ effect, receipt: receiptValue });
      }),
    ),
    proposalBranch: state.proposalBranch,
    targetBranch: state.targetBranch,
    targetHead: state.targetHead,
  });
}

export function createLocalAtlasInitializationState(
  repository: string,
): AtlasInitializationWorkflowState {
  const targetBranch = git(repository, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const targetHead = git(repository, ["rev-parse", "HEAD"]);
  return initialAtlasInitializationWorkflowState({
    baseSnapshotDigest: digestSnapshot(repository, targetHead),
    proposalBranch: proposalBranchName(targetHead),
    targetBranch,
    targetHead,
  });
}

export function readLocalAtlasInitializationState(
  repository: string,
  proposalBranch: string,
): AtlasInitializationWorkflowState {
  const state = parseWorkflowState(
    JSON.parse(readFileSync(statePath(repository, proposalBranch), "utf8")),
  );
  if (
    state.proposalBranch !== proposalBranch ||
    !/^atlas-initialization-[0-9a-f]{12}$/u.test(state.proposalBranch)
  ) {
    throw new Error("operation state proposal branch is malformed");
  }
  return state;
}

export function resumeLocalAtlasInitialization(
  repository: string,
  proposalBranch: string,
): ReturnType<typeof runLocalAtlasInitialization> {
  if (!isSafeGitBranchName(proposalBranch)) {
    return notCompletedAtlasInitializationResult({
      code: "ATLAS_INITIALIZATION_WORKFLOW_STATE_INVALID",
      message: "Atlas Initialization resume named an unsafe proposal branch.",
      recommendedNextAction:
        "Resume with a safe proposal branch name emitted by a prior Initialization result.",
      summary:
        "Initialization refused unsafe resume state before reading workspace state.",
    });
  }
  try {
    return runLocalAtlasInitialization(
      repository,
      readLocalAtlasInitializationState(repository, proposalBranch),
    );
  } catch {
    return notCompletedAtlasInitializationResult({
      code: "ATLAS_INITIALIZATION_STATE_UNREADABLE",
      message:
        "Atlas Initialization could not read the persisted workflow state for the requested proposal branch.",
      recommendedNextAction:
        "Inspect the Operation Workspace state file before attempting resume again.",
      summary: "Initialization could not resume from persisted workflow state.",
    });
  }
}

export function runLocalAtlasInitialization(
  repository: string,
  state?: AtlasInitializationWorkflowState,
): ReturnType<typeof runAtlasInitializationWorkflow> {
  let workflowState: AtlasInitializationWorkflowState;
  try {
    workflowState = state ?? createLocalAtlasInitializationState(repository);
    excludeOperationWorkspaces(repository);
  } catch {
    return notCompletedAtlasInitializationResult({
      code: "ATLAS_INITIALIZATION_CAPTURE_FAILED",
      message:
        "Atlas Initialization could not capture a Git-backed base snapshot for the Atlas Host Directory.",
      recommendedNextAction:
        "Run Initialization from a Git worktree with an existing commit, then retry.",
      summary: "Initialization could not start from the selected Atlas Host Directory.",
    });
  }

  const workspace = workspacePath(repository, workflowState.proposalBranch);
  return runAtlasInitializationWorkflow(workflowState, {
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
        "Initialize minimal Atlas",
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
      gitWrite(repository, [
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
      return { receipt: workflowState.proposalBranch };
    },
    currentTargetHead: () => git(repository, ["rev-parse", workflowState.targetBranch]),
    currentBaseSnapshotDigest: () =>
      digestSnapshot(
        repository,
        git(repository, ["rev-parse", workflowState.targetBranch]),
      ),
    lintProposal: () => {
      const capture = captureLocalAtlasSnapshot(workspace);
      if (capture.state === "failed") throw new Error(capture.reason);
      const lint = runLintOperation(capture.snapshot.capturedFiles, {
        maxFileBytes: 1024 * 1024,
        maxTotalBytes: 16 * 1024 * 1024,
      });
      const commit = git(workspace, ["rev-parse", "HEAD"]);
      return { lint, receipt: commit };
    },
    persistState: (nextState: AtlasInitializationWorkflowState) => {
      writeStateAtomically(repository, nextState);
    },
    workspaceExists: () => workspaceExists(repository, workflowState.proposalBranch),
    workspacePathValid: () =>
      workspacePathIsContained(repository, workflowState.proposalBranch),
    writeChangeSet: (changeSet: AtlasInitializationChangeSet) => {
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
