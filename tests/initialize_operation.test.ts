import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  readLocalAtlasInitializationState,
  resumeLocalAtlasInitialization,
  runLocalAtlasInitialization,
} from "../src/platform/local_atlas_initialization.ts";
import { captureLocalAtlasSnapshot as captureSnapshot } from "../src/platform/local_atlas_snapshot.ts";
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
    baseSnapshotDigest: "base-digest",
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
  assert.deepEqual(
    git(repository, [
      "ls-tree",
      "--name-only",
      result.payload.workflowState.proposalBranch,
    ]).split("\n"),
    [".atlas", "README.md"],
  );
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
    parsed.payload.atlasReadinessReport?.lintStamp.checkRevision.startsWith("sha256:"),
    true,
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
    currentBaseSnapshotDigest: () => interrupted.baseSnapshotDigest,
    lintProposal: () => ({
      lint: runLintOperation(atlasInitializationFiles(interrupted), {
        maxFileBytes: 4096,
        maxTotalBytes: 65536,
      }),
      receipt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
    currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
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
    "ATLAS_INITIALIZATION_BASE_SNAPSHOT_STALE",
  );
  assert.match(result.handoff.recommendedNextAction, /Refresh the base snapshot/u);
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
    currentBaseSnapshotDigest: () => unsafe.baseSnapshotDigest,
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
    baseSnapshotDigest: "stale",
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
    currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
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
    currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
    lintProposal: () => ({
      lint: runLintOperation([], { maxFileBytes: 4096, maxTotalBytes: 65536 }),
      receipt: "cccccccccccccccccccccccccccccccccccccccc",
    }),
    writeChangeSet: () => ({ receipt: "written" }),
  });

  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.result.summary,
    "Initialization proposal did not pass trusted Lint.",
  );
});

test("Atlas Initialization preserves produced receipts when an effect after them fails", () => {
  for (const [failAt, expectedReceipts] of [
    ["write", ["create-proposal-worktree"]],
    ["commit", ["create-proposal-worktree", "write-change-set"]],
    ["lint", ["create-proposal-worktree", "write-change-set", "commit-proposal"]],
  ] as const) {
    const persisted: AtlasInitializationWorkflowState[] = [];
    const initial = state();
    const result = runAtlasInitializationWorkflow(initial, {
      commitProposal: () => {
        if (failAt === "commit") throw new Error("commit failed");
        const commit = "ffffffffffffffffffffffffffffffffffffffff";
        return { commit, receipt: commit };
      },
      createProposalWorktree: () => ({ receipt: "created" }),
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      currentTargetHead: () => initial.targetHead,
      lintProposal: () => {
        if (failAt === "lint") throw new Error("lint failed");
        return {
          lint: runLintOperation(atlasInitializationFiles(initial), {
            maxFileBytes: 4096,
            maxTotalBytes: 65536,
          }),
          receipt: "ffffffffffffffffffffffffffffffffffffffff",
        };
      },
      persistState: (nextState) => {
        persisted.push(nextState);
      },
      writeChangeSet: () => {
        if (failAt === "write") throw new Error("write failed");
        return { receipt: "written" };
      },
    });

    assert.equal(result.completion, "not-completed");
    assert.deepEqual(
      result.payload.workflowState.effectReceipts.map((receipt) => receipt.effect),
      expectedReceipts,
    );
    assert.deepEqual(
      persisted.at(-1)?.effectReceipts.map((receipt) => receipt.effect),
      expectedReceipts,
    );
  }
});

test("Atlas Initialization refuses a Lint Stamp when Lint evidence names another commit", () => {
  const initial = state();
  const result = runAtlasInitializationWorkflow(initial, {
    commitProposal: () => {
      const commit = "1111111111111111111111111111111111111111";
      return { commit, receipt: commit };
    },
    createProposalWorktree: () => ({ receipt: "created" }),
    currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
    currentTargetHead: () => initial.targetHead,
    lintProposal: () => ({
      lint: runLintOperation(atlasInitializationFiles(initial), {
        maxFileBytes: 4096,
        maxTotalBytes: 65536,
      }),
      receipt: "2222222222222222222222222222222222222222",
    }),
    writeChangeSet: () => ({ receipt: "written" }),
  });

  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_LINT_STAMP_STALE",
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
      Object.freeze({
        effect: "lint-proposal" as const,
        receipt: "dddddddddddddddddddddddddddddddddddddddd",
      }),
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
    currentBaseSnapshotDigest: () => resumed.baseSnapshotDigest,
    lintProposal: () => {
      linted += 1;
      return {
        lint: runLintOperation(atlasInitializationFiles(resumed), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "dddddddddddddddddddddddddddddddddddddddd",
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
    currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
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
  assert.notEqual(captured.baseSnapshotDigest.length, 0);
  assert.throws(() =>
    createLocalAtlasInitializationState(resolve(WORKSPACE, "missing-repository")),
  );
});

test("Local Atlas Initialization persists resumable state and excludes Operation Workspaces", () => {
  const repository = resolve(WORKSPACE, "persisted-resume");
  initRepository(repository);
  rmSync(resolve(repository, ".git", "info", "exclude"), { force: true });

  const result = runLocalAtlasInitialization(repository);
  const branch = result.payload.workflowState.proposalBranch;
  const persisted = readLocalAtlasInitializationState(repository, branch);
  const resumed = resumeLocalAtlasInitialization(repository, branch);
  const command = spawnSync(
    process.execPath,
    [
      COMMAND,
      "initialize",
      "--machine",
      "--atlas-host-directory",
      repository,
      "--resume-proposal-branch",
      branch,
    ],
    { encoding: "utf8" },
  );
  const status = spawnSync("git", ["-C", repository, "status", "--short"], {
    encoding: "utf8",
  });

  assert.equal(result.completion, "completed");
  assert.equal(resumed.completion, "completed");
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(
    persisted.effectReceipts,
    result.payload.workflowState.effectReceipts,
  );
  assert.doesNotMatch(status.stdout, /\.atlas-operation-workspaces/u);
});

test("Local Atlas Initialization refuses to overwrite an existing Operation Workspace", () => {
  const repository = resolve(WORKSPACE, "existing-workspace");
  initRepository(repository);
  const first = runLocalAtlasInitialization(repository);
  const branch = first.payload.workflowState.proposalBranch;
  const sentinel = resolve(
    repository,
    ".atlas-operation-workspaces",
    branch,
    ".atlas",
    "REVIEW-NOTES.md",
  );
  writeFileSync(sentinel, "SENTINEL: uncommitted human review notes\n", "utf8");

  const second = runLocalAtlasInitialization(repository);
  const resumed = resumeLocalAtlasInitialization(repository, branch);

  assert.equal(second.completion, "not-completed");
  assert.equal(
    second.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_WORKSPACE_EXISTS",
  );
  assert.match(second.handoff.recommendedNextAction, /--resume-proposal-branch/u);
  assert.equal(
    readFileSync(sentinel, "utf8"),
    "SENTINEL: uncommitted human review notes\n",
  );
  assert.equal(resumed.completion, "completed");
  assert.equal(
    readFileSync(sentinel, "utf8"),
    "SENTINEL: uncommitted human review notes\n",
  );
});

test("Local Atlas Initialization does not execute repository-local hooks or filters", () => {
  const repository = resolve(WORKSPACE, "hostile-git-config");
  initRepository(repository);
  writeFileSync(
    resolve(repository, ".gitattributes"),
    ".atlas/** filter=evil\n",
    "utf8",
  );
  git(repository, ["add", ".gitattributes"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Configure evil attributes",
  ]);
  git(repository, [
    "config",
    "filter.evil.smudge",
    `sh -c 'touch "$1"; cat' sh ${resolve(repository, "PWN_smudge")}`,
  ]);
  git(repository, [
    "config",
    "filter.evil.clean",
    `sh -c 'touch "$1"; cat' sh ${resolve(repository, "PWN_clean")}`,
  ]);
  const hooks = resolve(repository, ".git", "hooks");
  writeFileSync(
    resolve(hooks, "post-checkout"),
    `#!/bin/sh\ntouch "${resolve(repository, "PWN_postcheckout")}"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  writeFileSync(
    resolve(hooks, "pre-commit"),
    `#!/bin/sh\ntouch "${resolve(repository, "PWN_precommit")}"\n`,
    { encoding: "utf8", mode: 0o755 },
  );

  const result = runLocalAtlasInitialization(repository);

  assert.equal(result.completion, "completed");
  for (const marker of [
    "PWN_smudge",
    "PWN_clean",
    "PWN_postcheckout",
    "PWN_precommit",
  ]) {
    assert.equal(existsSync(resolve(repository, marker)), false, marker);
  }
});

test("Local Atlas Initialization does not execute repo-local fsmonitor commands", () => {
  const repository = resolve(WORKSPACE, "hostile-fsmonitor");
  initRepository(repository);
  const marker = resolve(repository, "PWN_fsmonitor");
  const fsmonitor = resolve(repository, "fsmonitor.sh");
  writeFileSync(fsmonitor, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`, {
    encoding: "utf8",
    mode: 0o755,
  });
  const include = resolve(repository, "included-config");
  writeFileSync(include, `[core]\n\tfsmonitor = ${fsmonitor}\n`, "utf8");
  git(repository, ["config", "include.path", include]);

  const result = runLocalAtlasInitialization(repository);

  assert.equal(result.completion, "completed");
  assert.equal(existsSync(marker), false);
});

test("Local Atlas Initialization refuses symlinked Operation Workspace paths", () => {
  for (const [name, branchOf, setup] of [
    [
      "container",
      (branch: string) => branch,
      (repository: string, outside: string, branch: string) => {
        void branch;
        symlinkSync(outside, resolve(repository, ".atlas-operation-workspaces"));
      },
    ],
    [
      "intermediate",
      (branch: string) => `${branch}/child`,
      (repository: string, outside: string, branch: string) => {
        const first = branch.split("/")[0] ?? branch;
        mkdirSync(resolve(repository, ".atlas-operation-workspaces"), {
          recursive: true,
        });
        symlinkSync(outside, resolve(repository, ".atlas-operation-workspaces", first));
      },
    ],
    [
      "leaf",
      (branch: string) => branch,
      (repository: string, outside: string, branch: string) => {
        mkdirSync(resolve(repository, ".atlas-operation-workspaces"), {
          recursive: true,
        });
        symlinkSync(
          outside,
          resolve(repository, ".atlas-operation-workspaces", branch),
        );
      },
    ],
  ] as const) {
    const repository = resolve(WORKSPACE, `workspace-symlink-${name}`);
    const outside = resolve(WORKSPACE, `workspace-symlink-${name}-outside`);
    initRepository(repository);
    rmSync(outside, { force: true, recursive: true });
    mkdirSync(outside, { recursive: true });
    const initial = createLocalAtlasInitializationState(repository);
    const branch = branchOf(initial.proposalBranch);
    setup(repository, outside, branch);

    const result = runLocalAtlasInitialization(repository, {
      ...initial,
      proposalBranch: branch,
    });

    assert.equal(result.completion, "not-completed", name);
    assert.equal(
      result.handoff.validationState.findings[0]?.code,
      name === "leaf"
        ? "ATLAS_INITIALIZATION_WORKSPACE_EXISTS"
        : "ATLAS_INITIALIZATION_WORKSPACE_PATH_INVALID",
    );
    assert.equal(existsSync(resolve(outside, branch, ".atlas", "index.md")), false);
  }
});

test("atlas initialize --machine reports ordinary bad inputs as machine JSON", () => {
  const missingRepository = resolve(WORKSPACE, "missing-for-cli");
  rmSync(missingRepository, { force: true, recursive: true });

  const command = spawnSync(
    process.execPath,
    [COMMAND, "initialize", "--machine", "--atlas-host-directory", missingRepository],
    { encoding: "utf8" },
  );

  assert.equal(command.status, 2);
  assert.equal(command.stderr, "");
  const parsed = JSON.parse(command.stdout) as ReturnType<
    typeof runLocalAtlasInitialization
  >;
  assert.equal(parsed.completion, "not-completed");
  assert.equal(
    parsed.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_CAPTURE_FAILED",
  );
});

test("Local Atlas Initialization reports snapshot budget failures as values", () => {
  const repository = resolve(WORKSPACE, "large-atlas");
  initRepository(repository);
  mkdirSync(resolve(repository, ".atlas"), { recursive: true });
  writeFileSync(resolve(repository, ".atlas", "large.md"), "x".repeat(1024 * 1024 + 1));
  git(repository, ["add", ".atlas/large.md"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Add large atlas file",
  ]);

  const result = runLocalAtlasInitialization(repository);

  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_CAPTURE_FAILED",
  );
});

test("Local Atlas Snapshot enforces file count and total byte budgets", () => {
  const repository = resolve(WORKSPACE, "snapshot-budget");
  initRepository(repository);
  mkdirSync(resolve(repository, ".atlas"), { recursive: true });
  writeFileSync(resolve(repository, ".atlas", "one.md"), "one", "utf8");
  writeFileSync(resolve(repository, ".atlas", "two.md"), "two", "utf8");
  git(repository, ["add", ".atlas"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Add atlas files",
  ]);

  assert.equal(
    captureSnapshot(repository, {
      maxFileBytes: 1024,
      maxFiles: 1,
      maxTotalBytes: 1024,
    }).state,
    "failed",
  );
  assert.equal(
    captureSnapshot(repository, {
      maxFileBytes: 1024,
      maxFiles: 2,
      maxTotalBytes: 5,
    }).state,
    "failed",
  );
});

test("Local Atlas Initialization reports write adapter failures as values", () => {
  const repository = resolve(WORKSPACE, "write-adapter-failure");
  initRepository(repository);
  const initial = createLocalAtlasInitializationState(repository);
  const result = runLocalAtlasInitialization(repository, {
    ...initial,
    effectReceipts: Object.freeze([
      Object.freeze({
        effect: "create-proposal-worktree" as const,
        receipt: "created",
      }),
    ]),
  });

  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_RUNTIME_FAILED",
  );
  assert.deepEqual(
    result.payload.workflowState.effectReceipts.map((receipt) => receipt.effect),
    ["create-proposal-worktree"],
  );
});

test("Local Atlas Initialization rejects malformed persisted workflow receipts", () => {
  const repository = resolve(WORKSPACE, "malformed-state");
  initRepository(repository);
  const branch = "atlas-initialization-malformed";
  const stateFile = resolve(
    repository,
    ".atlas-operation-workspaces",
    branch,
    ".atlas-operation-state.json",
  );
  mkdirSync(resolve(stateFile, ".."), { recursive: true });

  for (const stateText of [
    "null",
    "{}",
    '{"operation-workflow-schema":"1.0.0","baseSnapshotDigest":"d","effectReceipts":[{}],"proposalBranch":"atlas-initialization-malformed","targetBranch":"main","targetHead":"h"}',
    '{"operation-workflow-schema":"1.0.0","baseSnapshotDigest":"d","effectReceipts":[{"effect":"bad","receipt":"r"}],"proposalBranch":"atlas-initialization-malformed","targetBranch":"main","targetHead":"h"}',
    '{"operation-workflow-schema":"1.0.0","baseSnapshotDigest":"d","effectReceipts":[{"effect":"lint-proposal","receipt":1}],"proposalBranch":"atlas-initialization-malformed","targetBranch":"main","targetHead":"h"}',
    '{"operation-workflow-schema":"1.0.0","baseSnapshotDigest":"d","effectReceipts":[],"proposalBranch":"main","targetBranch":"main","targetHead":"h"}',
  ]) {
    writeFileSync(stateFile, stateText, "utf8");
    assert.throws(() => readLocalAtlasInitializationState(repository, branch));
    assert.equal(
      resumeLocalAtlasInitialization(repository, branch).handoff.validationState
        .findings[0]?.code,
      "ATLAS_INITIALIZATION_STATE_UNREADABLE",
    );
  }

  assert.equal(
    resumeLocalAtlasInitialization(repository, "../outside").handoff.validationState
      .findings[0]?.code,
    "ATLAS_INITIALIZATION_WORKFLOW_STATE_INVALID",
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
