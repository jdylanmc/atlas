import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  atlasInitializationFiles,
  initialAtlasInitializationWorkflowState,
  runAtlasInitializationWorkflow,
  validateAtlasInitializationChangeSet,
  type AtlasInitializationEffectReceipt,
  type AtlasInitializationWorkflowState,
} from "../src/operations/initialize_operation.ts";
import { runLintOperation } from "../src/operations/lint_operation.ts";
import {
  createLocalAtlasInitializationState,
  runLocalAtlasInitialization,
} from "../src/platform/local_atlas_initialization.ts";
import { exitCodeForInitializeOperationResult } from "../src/interfaces/initialize_command.ts";

const WORKSPACE = resolve(
  import.meta.dirname,
  "..",
  ".test-workspaces",
  "initialization",
);
const ROOT = resolve(import.meta.dirname, "..");
const COMMAND = resolve(ROOT, "scripts", "atlas.ts");

function state(
  receipts: readonly AtlasInitializationEffectReceipt[] = Object.freeze([]),
): AtlasInitializationWorkflowState {
  const initial = initialAtlasInitializationWorkflowState({
    atlasViewDigest: "view-digest",
    proposalBranch: "atlas-initialization-test",
    targetBranch: "main",
    targetHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  return Object.freeze({ ...initial, effectReceipts: receipts });
}

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepository(repository: string): string {
  rmSync(repository, { force: true, recursive: true });
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-b", "main"]);
  writeFileSync(resolve(repository, "README.md"), "# host\n", "utf8");
  git(repository, ["add", "README.md"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Initial commit",
  ]);
  return git(repository, ["rev-parse", "HEAD"]);
}

test("Atlas Initialization writes a valid proposal while the target branch commit stays fixed", () => {
  const repository = resolve(WORKSPACE, "valid-proposal");
  const before = initRepository(repository);

  const result = runLocalAtlasInitialization(repository);
  const after = git(repository, ["rev-parse", "main"]);

  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(after, before);
  assert.ok(result.payload.lint !== undefined);
  assert.equal(result.payload.lint.payload.state, "completed");
  assert.equal(result.payload.lint.payload.lint.outcome, "valid");
  assert.equal(
    result.payload.atlasReadinessReport?.lintStamp.atlasCommit,
    result.payload.workflowState.effectReceipts.find(
      (receipt) => receipt.effect === "commit-proposal",
    )?.receipt,
  );
  assert.match(
    result.payload.atlasReadinessReport?.publicationHandoff ?? "",
    /Forge publication was not requested/u,
  );
  assert.deepEqual(result.handoff.reviewLink, {
    reason: "Forge publication was not requested; the Atlas Proposal remains local.",
    state: "not-applicable",
  });
});

test("atlas initialize --machine emits the proposal Operation Result", () => {
  const repository = resolve(WORKSPACE, "cli-proposal");
  const before = initRepository(repository);
  const command = spawnSync(
    process.execPath,
    [COMMAND, "initialize", "--machine", "--atlas-host-directory", repository],
    { encoding: "utf8" },
  );

  assert.equal(command.status, 0, command.stderr);
  assert.equal(git(repository, ["rev-parse", "main"]), before);
  const parsed = JSON.parse(command.stdout) as ReturnType<
    typeof runLocalAtlasInitialization
  >;
  assert.equal(parsed.completion, "completed");
  assert.equal(
    parsed.payload.atlasReadinessReport?.lintStamp.check,
    "sdk-core.atlas-lint",
  );
});

test("atlas initialize --machine reports usage errors as machine JSON", () => {
  const command = spawnSync(process.execPath, [COMMAND, "initialize", "--bogus"], {
    encoding: "utf8",
  });

  assert.equal(command.status, 64);
  assert.match(command.stderr, /usage: atlas initialize/u);
  const parsed = JSON.parse(command.stdout) as ReturnType<
    typeof runLocalAtlasInitialization
  >;
  assert.equal(parsed.completion, "not-completed");
  assert.equal(
    parsed.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_USAGE",
  );
});

test("Atlas Initialization resumes from effect receipts without replaying completed writes", () => {
  let created = 0;
  let written = 0;
  let committed = 0;
  const interrupted = {
    ...state(),
    effectReceipts: Object.freeze([
      Object.freeze({
        effect: "create-proposal-worktree" as const,
        receipt: "created",
      }),
      Object.freeze({ effect: "write-change-set" as const, receipt: "written" }),
    ]),
  };

  const result = runAtlasInitializationWorkflow(interrupted, {
    commitProposal: () => {
      committed += 1;
      const commit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      return { commit, receipt: commit };
    },
    createProposalWorktree: () => {
      created += 1;
      return { receipt: "created-again" };
    },
    currentTargetHead: () => interrupted.targetHead,
    currentViewDigest: () => interrupted.atlasViewDigest,
    lintProposal: () => ({
      lint: runLintOperation(atlasInitializationFiles(interrupted), {
        maxFileBytes: 4096,
        maxTotalBytes: 65536,
      }),
      receipt: "linted",
    }),
    writeChangeSet: () => {
      written += 1;
      return { receipt: "written-again" };
    },
  });

  assert.equal(result.completion, "completed");
  assert.equal(created, 0);
  assert.equal(written, 0);
  assert.equal(committed, 1);
  assert.deepEqual(
    result.payload.workflowState.effectReceipts.map((receipt) => receipt.effect),
    [
      "create-proposal-worktree",
      "write-change-set",
      "commit-proposal",
      "lint-proposal",
    ],
  );
});

test("Atlas Initialization blocks stale target or digest drift before mutation", () => {
  let effects = 0;
  const initial = state();
  const result = runAtlasInitializationWorkflow(initial, {
    commitProposal: () => {
      effects += 1;
      return { commit: "c", receipt: "c" };
    },
    createProposalWorktree: () => {
      effects += 1;
      return { receipt: "created" };
    },
    currentTargetHead: () => "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    currentViewDigest: () => initial.atlasViewDigest,
    lintProposal: () => {
      effects += 1;
      throw new Error("must not lint stale view");
    },
    writeChangeSet: () => {
      effects += 1;
      return { receipt: "written" };
    },
  });

  assert.equal(result.completion, "not-completed");
  assert.equal(effects, 0);
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_VIEW_STALE",
  );
  assert.match(result.handoff.recommendedNextAction, /Refresh the Atlas View/u);
});

test("Atlas Initialization rejects unsafe workflow branch names before effects", () => {
  let effects = 0;
  const unsafe = {
    ...state(),
    proposalBranch: "../outside",
  };
  const result = runAtlasInitializationWorkflow(unsafe, {
    commitProposal: () => {
      effects += 1;
      return { commit: "c", receipt: "c" };
    },
    createProposalWorktree: () => {
      effects += 1;
      return { receipt: "created" };
    },
    currentTargetHead: () => unsafe.targetHead,
    currentViewDigest: () => unsafe.atlasViewDigest,
    lintProposal: () => {
      effects += 1;
      throw new Error("must not lint unsafe state");
    },
    writeChangeSet: () => {
      effects += 1;
      return { receipt: "written" };
    },
  });

  assert.equal(result.completion, "not-completed");
  assert.equal(effects, 0);
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_WORKFLOW_STATE_INVALID",
  );
});

test("Atlas Initialization reports invalid Change Sets and failed Lint as values", () => {
  const initial = state();
  const invalidChangeSet = {
    atlasViewDigest: "stale",
    changes: Object.freeze([Object.freeze({ content: "bad", path: "../outside.md" })]),
    targetHead: initial.targetHead,
  };
  assert.deepEqual(
    validateAtlasInitializationChangeSet(initial, invalidChangeSet).map(
      (finding) => finding.code,
    ),
    [
      "ATLAS_INITIALIZATION_CHANGE_SET_STALE",
      "ATLAS_INITIALIZATION_CHANGE_SET_PATH_INVALID",
    ],
  );

  const rejected = runAtlasInitializationWorkflow(initial, {
    changeSet: () => invalidChangeSet,
    commitProposal: () => {
      throw new Error("invalid change set must not commit");
    },
    createProposalWorktree: () => ({ receipt: "created" }),
    currentTargetHead: () => initial.targetHead,
    currentViewDigest: () => initial.atlasViewDigest,
    lintProposal: () => {
      throw new Error("invalid change set must not lint");
    },
    writeChangeSet: () => {
      throw new Error("invalid change set must not write");
    },
  });
  assert.equal(rejected.completion, "not-completed");
  assert.equal(
    rejected.handoff.result.summary,
    "Initialization refused an invalid Atlas Change Set.",
  );

  const result = runAtlasInitializationWorkflow(initial, {
    commitProposal: () => {
      const commit = "cccccccccccccccccccccccccccccccccccccccc";
      return { commit, receipt: commit };
    },
    createProposalWorktree: () => ({ receipt: "created" }),
    currentTargetHead: () => initial.targetHead,
    currentViewDigest: () => initial.atlasViewDigest,
    lintProposal: () => ({
      lint: runLintOperation([], { maxFileBytes: 4096, maxTotalBytes: 65536 }),
      receipt: "linted",
    }),
    writeChangeSet: () => ({ receipt: "written" }),
  });

  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.result.summary,
    "Initialization proposal did not pass trusted Lint.",
  );
});

test("Atlas Initialization can resume after an already recorded Lint receipt", () => {
  const resumed = state(
    Object.freeze([
      Object.freeze({
        effect: "create-proposal-worktree" as const,
        receipt: "created",
      }),
      Object.freeze({ effect: "write-change-set" as const, receipt: "written" }),
      Object.freeze({
        effect: "commit-proposal" as const,
        receipt: "dddddddddddddddddddddddddddddddddddddddd",
      }),
      Object.freeze({ effect: "lint-proposal" as const, receipt: "linted" }),
    ]),
  );
  let linted = 0;
  const result = runAtlasInitializationWorkflow(resumed, {
    commitProposal: () => {
      throw new Error("commit must not replay");
    },
    createProposalWorktree: () => {
      throw new Error("create must not replay");
    },
    currentTargetHead: () => resumed.targetHead,
    currentViewDigest: () => resumed.atlasViewDigest,
    lintProposal: () => {
      linted += 1;
      return {
        lint: runLintOperation(atlasInitializationFiles(resumed), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "linted-again",
      };
    },
    writeChangeSet: () => {
      throw new Error("write must not replay");
    },
  });

  assert.equal(result.completion, "completed");
  assert.equal(linted, 1);
  assert.equal(
    result.payload.atlasReadinessReport?.lintStamp.atlasCommit,
    "dddddddddddddddddddddddddddddddddddddddd",
  );
});

test("Atlas Initialization reports runtime failure without throwing across the operation boundary", () => {
  const initial = state();
  const result = runAtlasInitializationWorkflow(initial, {
    commitProposal: () => {
      throw new Error("not reached");
    },
    createProposalWorktree: () => {
      throw new Error("workspace failed");
    },
    currentTargetHead: () => initial.targetHead,
    currentViewDigest: () => initial.atlasViewDigest,
    lintProposal: () => {
      throw new Error("not reached");
    },
    writeChangeSet: () => {
      throw new Error("not reached");
    },
  });

  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_RUNTIME_FAILED",
  );
  assert.equal(exitCodeForInitializeOperationResult(result), 2);
});

test("Local Atlas Initialization state captures Atlas Snapshot content and git failures", () => {
  const repository = resolve(WORKSPACE, "state-with-atlas");
  initRepository(repository);
  mkdirSync(resolve(repository, ".atlas"), { recursive: true });
  writeFileSync(resolve(repository, ".atlas", "note.md"), "opaque\n", "utf8");
  git(repository, ["add", ".atlas/note.md"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Add atlas note",
  ]);

  const captured = createLocalAtlasInitializationState(repository);
  assert.equal(captured.targetHead, git(repository, ["rev-parse", "HEAD"]));
  assert.notEqual(captured.atlasViewDigest.length, 0);
  assert.throws(() =>
    createLocalAtlasInitializationState(resolve(WORKSPACE, "missing-repository")),
  );
});

test("Local Atlas Initialization reports a missing proposal workspace as non-completion", () => {
  const repository = resolve(WORKSPACE, "missing-proposal-workspace");
  initRepository(repository);
  const initial = createLocalAtlasInitializationState(repository);
  const resumed = {
    ...initial,
    effectReceipts: Object.freeze([
      Object.freeze({
        effect: "create-proposal-worktree" as const,
        receipt: "created",
      }),
      Object.freeze({ effect: "write-change-set" as const, receipt: "written" }),
      Object.freeze({
        effect: "commit-proposal" as const,
        receipt: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      }),
    ]),
  };

  const result = runLocalAtlasInitialization(repository, resumed);

  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_RUNTIME_FAILED",
  );
});
