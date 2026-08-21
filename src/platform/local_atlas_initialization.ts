import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  initialAtlasInitializationWorkflowState,
  runAtlasInitializationWorkflow,
  type AtlasInitializationChangeSet,
  type AtlasInitializationWorkflowState,
} from "../operations/initialize_operation.ts";
import { runLintOperation } from "../operations/lint_operation.ts";
import { captureLocalAtlasSnapshot } from "./local_atlas_snapshot.ts";

const trustedGitExecutable = "/usr/bin/git";

function trustedGitEnvironment(): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: "/nonexistent",
    NODE_V8_COVERAGE: process.env["NODE_V8_COVERAGE"],
    PATH: "/usr/bin:/bin",
    XDG_CONFIG_HOME: "/nonexistent",
  };
}

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    encoding: "utf8",
    env: trustedGitEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
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

export function createLocalAtlasInitializationState(
  repository: string,
): AtlasInitializationWorkflowState {
  const targetBranch = git(repository, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const targetHead = git(repository, ["rev-parse", "HEAD"]);
  return initialAtlasInitializationWorkflowState({
    atlasViewDigest: digestSnapshot(repository, targetHead),
    proposalBranch: proposalBranchName(targetHead),
    targetBranch,
    targetHead,
  });
}

export function runLocalAtlasInitialization(
  repository: string,
  state = createLocalAtlasInitializationState(repository),
): ReturnType<typeof runAtlasInitializationWorkflow> {
  const workspace = workspacePath(repository, state.proposalBranch);
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
      rmSync(workspace, { force: true, recursive: true });
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
    currentViewDigest: () =>
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
    writeChangeSet: (changeSet: AtlasInitializationChangeSet) => {
      for (const change of changeSet.changes) {
        const path = join(workspace, change.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, change.content, "utf8");
      }
      return {
        receipt: createHash("sha256").update(state.atlasViewDigest).digest("hex"),
      };
    },
  });
}
