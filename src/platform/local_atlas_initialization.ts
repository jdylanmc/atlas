import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  initialAtlasInitializationWorkflowState,
  runAtlasInitializationWorkflow,
  type AtlasInitializationChangeSet,
  type AtlasInitializationWorkflowState,
} from "../operations/initialize_operation.ts";
import { runLintOperation } from "../operations/lint_operation.ts";
import { captureLocalAtlasSnapshot } from "./local_atlas_snapshot.ts";
import { runTrustedGit } from "./trusted_git.ts";

function git(repository: string, args: readonly string[]): string {
  const result = runTrustedGit(repository, args);
  if (result.state === "failed") {
    throw new Error("trusted git command failed");
  }
  return result.stdout.trim();
}

function digestSnapshot(repository: string, targetHead: string): string {
  const capture = captureLocalAtlasSnapshot(repository);
  /* c8 ignore next -- createLocalAtlasInitializationState proves Git before digesting. */
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
  return isAbsolute(common) ? common : resolve(repository, common);
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
  appendFileSync(
    excludePath,
    `${content.endsWith("\n") || content === "" ? "" : "\n"}${entry}\n`,
    "utf8",
  );
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
  return parseWorkflowState(
    JSON.parse(readFileSync(statePath(repository, proposalBranch), "utf8")),
  );
}

export function resumeLocalAtlasInitialization(
  repository: string,
  proposalBranch: string,
): ReturnType<typeof runLocalAtlasInitialization> {
  return runLocalAtlasInitialization(
    repository,
    readLocalAtlasInitializationState(repository, proposalBranch),
  );
}

export function runLocalAtlasInitialization(
  repository: string,
  state = createLocalAtlasInitializationState(repository),
): ReturnType<typeof runAtlasInitializationWorkflow> {
  const workspace = workspacePath(repository, state.proposalBranch);
  excludeOperationWorkspaces(repository);
  if (state.effectReceipts.length === 0) {
    rmSync(workspace, { force: true, recursive: true });
  }
  return runAtlasInitializationWorkflow(state, {
    commitProposal: () => {
      git(workspace, ["add", ".atlas"]);
      git(workspace, [
        "-c",
        "user.name=Atlas SDK",
        "-c",
        "user.email=atlas-sdk@example.invalid",
        "commit",
        "-m",
        "Initialize minimal Atlas",
      ]);
      const commit = git(workspace, ["rev-parse", "HEAD"]);
      return { commit, receipt: commit };
    },
    createProposalWorktree: () => {
      mkdirSync(dirname(workspace), { recursive: true });
      git(repository, [
        "worktree",
        "add",
        "-b",
        state.proposalBranch,
        workspace,
        state.targetBranch,
      ]);
      return { receipt: state.proposalBranch };
    },
    currentTargetHead: () => git(repository, ["rev-parse", state.targetBranch]),
    currentBaseSnapshotDigest: () =>
      digestSnapshot(repository, git(repository, ["rev-parse", state.targetBranch])),
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
    writeChangeSet: (changeSet: AtlasInitializationChangeSet) => {
      for (const change of changeSet.changes) {
        const path = join(workspace, change.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, change.content, "utf8");
      }
      return {
        receipt: createHash("sha256").update(state.baseSnapshotDigest).digest("hex"),
      };
    },
  });
}
