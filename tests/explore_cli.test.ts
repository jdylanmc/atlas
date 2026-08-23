import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  exitCodeForExploreOperationResult,
  exploreCommandBudgets,
  exploreCommandExitCodes,
  missingAtlasExploreOperationResult,
  oversizedAtlasExploreOperationResult,
  serializeExploreMachineResult,
  unreadableAtlasExploreOperationResult,
  usageExploreOperationResult,
} from "../src/interfaces/explore_command.ts";
import type { ExploreOperationResult } from "../src/operations/explore_operation.ts";
import {
  captureLocalAtlasExploreSnapshot,
  runLocalAtlasExplore,
} from "../src/platform/local_atlas_explore.ts";
import {
  runTrustedGitBytesWithInput,
  runTrustedGitWithInput,
  type TrustedGitResult,
} from "../src/platform/trusted_git.ts";

const ROOT = resolve(import.meta.dirname, "..");
const COMMAND = resolve(ROOT, "scripts", "atlas.ts");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "explore-cli");

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runAtlas(arguments_: readonly string[], cwd = ROOT): CommandResult {
  const result = spawnSync(process.execPath, [COMMAND, ...arguments_], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function parseExploreResult(stdout: string): ExploreOperationResult {
  const parsed = JSON.parse(stdout) as ExploreOperationResult;
  assert.equal(parsed["operation-result-schema"], "1.0.0");
  assert.equal(parsed.handoff["operation-handoff-schema"], "1.0.0");
  assert.deepEqual(parsed.handoff.operation, parsed.operation);
  return parsed;
}

function initAtlasRepository(repository: string): string {
  rmSync(repository, { force: true, recursive: true });
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-b", "main"]);
  cpSync(
    resolve(ROOT, "tests", "fixtures", "complete-atlas", ".atlas"),
    resolve(repository, ".atlas"),
    { recursive: true },
  );
  writeFileSync(resolve(repository, "README.md"), "# host\n", "utf8");
  git(repository, ["add", ".atlas", "README.md"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Initial Atlas",
  ]);
  return git(repository, ["rev-parse", "HEAD"]);
}

test("atlas explore --machine returns routed context from the complete fixture", () => {
  const command = runAtlas([
    "explore",
    "--machine",
    "canonical bytes",
    "--atlas-host-directory",
    resolve(ROOT, "tests", "fixtures", "complete-atlas"),
  ]);

  assert.equal(command.status, exploreCommandExitCodes.success, command.stderr);
  assert.equal(command.stderr, "");
  const result = parseExploreResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.operation.kind, "explore");
  assert.equal(result.payload.degradation.level, "valid-structured");
  assert.deepEqual(
    result.payload.results[0]?.route.map((step) => step.objectId),
    ["anchor:root", "anchor:lint", "concept:canonical-serialization"],
  );
  assert.deepEqual(
    result.payload.reanchors.map((entry) => entry.anchor.id),
    ["anchor:root", "anchor:lint"],
  );
  assert.equal(result.handoff.baseSnapshot.state, "known");
});

test("atlas explore --machine reaches the repository's own Home Atlas", () => {
  const command = runAtlas(["explore", "--machine", "minimal Home Atlas"]);

  assert.equal(command.status, exploreCommandExitCodes.success, command.stderr);
  const result = parseExploreResult(command.stdout);
  assert.equal(result.payload.degradation.level, "valid-structured");
  assert.ok(result.payload.results.length > 0);
  assert.equal(result.payload.reanchors[0]?.anchor.id, "anchor:root");
});

test("atlas explore --machine reports usage errors as Operation Result JSON", () => {
  const command = runAtlas(["explore", "--machine", "first", "second"]);

  assert.equal(command.status, exploreCommandExitCodes.usage);
  assert.match(command.stderr, /usage: atlas explore/u);
  const result = parseExploreResult(command.stdout);
  assert.equal(result.completion, "not-completed");
  assert.equal(result.payload.degradation.level, "blocked");
  assert.deepEqual(result.payload.results, []);
  assert.equal(result.handoff.validationState.findings[0]?.code, "ATLAS_EXPLORE_USAGE");
});

test("atlas explore --machine reports missing Atlas as determinate usage", () => {
  const command = runAtlas([
    "explore",
    "--machine",
    "anything",
    "--atlas-host-directory",
    resolve(ROOT, "tests", "fixtures", "no-such-atlas"),
  ]);

  assert.equal(command.status, exploreCommandExitCodes.usage);
  assert.equal(
    parseExploreResult(command.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_EXPLORE_ATLAS_NOT_FOUND",
  );
});

test("atlas explore --machine refuses oversized queries before Atlas capture", () => {
  const command = runAtlas([
    "explore",
    "--machine",
    "x".repeat(exploreCommandBudgets.maxQueryCharacters + 1),
    "--atlas-host-directory",
    resolve(ROOT, "tests", "fixtures", "no-such-atlas"),
  ]);

  assert.equal(command.status, exploreCommandExitCodes.usage);
  assert.equal(command.stderr, "");
  const result = parseExploreResult(command.stdout);
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_EXPLORE_QUERY_TOO_LARGE",
  );
  assert.equal(result.payload.degradation.level, "blocked");
});

test("atlas explore --machine completes at the file-count budget under constrained heap", () => {
  const repository = resolve(WORKSPACE, "max-files-atlas");
  initAtlasRepository(repository);
  const existingFiles = git(repository, [
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    ".atlas",
  ])
    .split(/\n/u)
    .filter((path) => path !== "").length;
  const extraFiles = exploreCommandBudgets.maxFiles - existingFiles;
  assert.ok(extraFiles > 0);
  mkdirSync(resolve(repository, ".atlas", "many"), { recursive: true });
  for (let index = 0; index < extraFiles; index += 1) {
    writeFileSync(resolve(repository, ".atlas", "many", `${String(index)}.md`), "");
  }
  git(repository, ["add", ".atlas/many"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Reach Explore file-count budget",
  ]);
  assert.equal(
    git(repository, ["ls-tree", "-r", "--name-only", "HEAD", ".atlas"])
      .split(/\n/u)
      .filter((path) => path !== "").length,
    exploreCommandBudgets.maxFiles,
  );

  const started = performance.now();
  const command = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=32",
      COMMAND,
      "explore",
      "--machine",
      "canonical bytes",
      "--atlas-host-directory",
      repository,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 30000 },
  );
  const elapsedMs = performance.now() - started;

  assert.equal(command.error, undefined);
  assert.notEqual(command.status, null, "Explore timed out before emitting a result");
  assert.ok(command.stdout.length > 0);
  const result = parseExploreResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.ok(result.payload.results.length > 0);
  assert.ok(elapsedMs < 30000, `Explore max-file capture took ${String(elapsedMs)}ms`);
});

test("atlas explore --machine refuses too many committed Atlas files before per-file reads", () => {
  const repository = resolve(WORKSPACE, "too-many-files-atlas");
  initAtlasRepository(repository);
  mkdirSync(resolve(repository, ".atlas", "many"), { recursive: true });
  for (let index = 0; index <= exploreCommandBudgets.maxFiles; index += 1) {
    writeFileSync(resolve(repository, ".atlas", "many", `${String(index)}.md`), "");
  }
  git(repository, ["add", ".atlas/many"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Add many Atlas files",
  ]);

  const started = performance.now();
  const command = runAtlas([
    "explore",
    "--machine",
    "canonical bytes",
    "--atlas-host-directory",
    repository,
  ]);
  const elapsedMs = performance.now() - started;

  assert.equal(command.status, exploreCommandExitCodes.usage);
  assert.ok(elapsedMs < 5000, `Explore file-count refusal took ${String(elapsedMs)}ms`);
  assert.equal(
    parseExploreResult(command.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_EXPLORE_ATLAS_TOO_MANY_FILES",
  );
});

test("atlas explore --machine refuses oversized committed Atlas files before reading them", () => {
  const repository = resolve(WORKSPACE, "oversized-atlas");
  initAtlasRepository(repository);
  writeFileSync(
    resolve(repository, ".atlas", "oversized.md"),
    "x".repeat(exploreCommandBudgets.maxFileBytes + 1),
    "utf8",
  );
  git(repository, ["add", ".atlas/oversized.md"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Add oversized Atlas file",
  ]);

  const command = runAtlas([
    "explore",
    "--machine",
    "canonical bytes",
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, exploreCommandExitCodes.usage);
  assert.equal(
    parseExploreResult(command.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_EXPLORE_ATLAS_TOO_LARGE",
  );
});

test("atlas explore --machine is read-only against the selected Atlas repository", () => {
  const repository = resolve(WORKSPACE, "read-only");
  const head = initAtlasRepository(repository);
  const beforeStatus = git(repository, ["status", "--porcelain=v1"]);

  const command = runAtlas([
    "explore",
    "--machine",
    "canonical bytes",
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, exploreCommandExitCodes.success, command.stderr);
  assert.equal(git(repository, ["rev-parse", "HEAD"]), head);
  assert.equal(git(repository, ["status", "--porcelain=v1"]), beforeStatus);
  assert.equal(existsSync(resolve(repository, ".atlas-operation-workspaces")), false);
});

test("Explore command helpers preserve machine JSON and exit classes", () => {
  const usage = usageExploreOperationResult("bad arguments");
  const missing = missingAtlasExploreOperationResult("missing Atlas");
  const oversized = oversizedAtlasExploreOperationResult("large Atlas");
  const unreadable = unreadableAtlasExploreOperationResult("unreadable Atlas");
  const operationNotCompleted = {
    ...usage,
    handoff: {
      ...usage.handoff,
      validationState: {
        findings: [
          {
            attribution: {
              checkId: "test",
              kind: "sdk-core" as const,
              trusted: true as const,
            },
            code: "ATLAS_EXPLORE_UNKNOWN_NOT_COMPLETED",
            "finding-schema": "1.0.0" as const,
            message: "unknown",
            path: ".atlas",
            severity: "error" as const,
          },
        ],
        state: "not-completed" as const,
      },
    },
  };
  const operationFailed = {
    ...usage,
    completion: "completed" as const,
    handoff: {
      ...usage.handoff,
      validationState: { findings: [], state: "failed" as const },
    },
  };

  assert.equal(serializeExploreMachineResult(usage), `${JSON.stringify(usage)}\n`);
  assert.equal(exitCodeForExploreOperationResult(usage), exploreCommandExitCodes.usage);
  assert.equal(
    exitCodeForExploreOperationResult(missing),
    exploreCommandExitCodes.usage,
  );
  assert.equal(
    exitCodeForExploreOperationResult(oversized),
    exploreCommandExitCodes.usage,
  );
  assert.equal(
    exitCodeForExploreOperationResult(unreadable),
    exploreCommandExitCodes.operationNotCompleted,
  );
  assert.equal(
    exitCodeForExploreOperationResult(operationNotCompleted),
    exploreCommandExitCodes.operationNotCompleted,
  );
  assert.equal(
    exitCodeForExploreOperationResult(operationFailed),
    exploreCommandExitCodes.operationFailed,
  );
  assert.equal(unreadable.handoff.degradationState.state, "degraded");
});

test("local Explore capture fails closed on unsupported Git entries and read drift", () => {
  const repository = resolve(WORKSPACE, "injected-capture");
  rmSync(repository, { force: true, recursive: true });
  mkdirSync(resolve(repository, ".git"), { recursive: true });
  mkdirSync(resolve(repository, ".atlas"), { recursive: true });
  const revision = "a".repeat(40);
  const path = ".atlas/index.md";
  const tree = `100644 blob ${"b".repeat(40)}\t${path}\0`;
  const textRunner = (
    _repository: string,
    args: readonly string[],
  ): TrustedGitResult => {
    if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
    if (args[0] === "ls-tree") return { state: "succeeded", stdout: tree };
    return { reason: "unexpected", state: "failed" };
  };
  const batchCheck: typeof runTrustedGitWithInput = () => ({
    state: "succeeded",
    stdout: `${"b".repeat(40)} blob 5\n`,
  });
  const truncatedBatch: typeof runTrustedGitBytesWithInput = () => ({
    state: "succeeded",
    stdout: new TextEncoder().encode(`${"b".repeat(40)} blob 5\nabcd\n`),
  });
  assert.equal(
    captureLocalAtlasExploreSnapshot(repository, exploreCommandBudgets, {
      readBatchBytes: truncatedBatch,
      readBatchText: batchCheck,
      readText: textRunner,
    }).state,
    "unreadable",
  );

  const failedBatchCheck = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readBatchText: () => ({ reason: "check failed", state: "failed" }),
      readText: textRunner,
    },
  );
  assert.equal(failedBatchCheck.state, "unreadable");

  const incompleteBatchCheck = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readBatchText: () => ({ state: "succeeded", stdout: "" }),
      readText: textRunner,
    },
  );
  assert.equal(incompleteBatchCheck.state, "unreadable");

  const malformedBatchCheck = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readBatchText: () => ({ state: "succeeded", stdout: "malformed line\n" }),
      readText: textRunner,
    },
  );
  assert.equal(malformedBatchCheck.state, "unreadable");

  const badSize = captureLocalAtlasExploreSnapshot(repository, exploreCommandBudgets, {
    readBatchText: () => ({
      state: "succeeded",
      stdout: `${"b".repeat(40)} blob NaN\n`,
    }),
    readText: textRunner,
  });
  assert.equal(badSize.state, "unreadable");

  const badMode = captureLocalAtlasExploreSnapshot(repository, exploreCommandBudgets, {
    readBatchText: batchCheck,
    readText: (_repository, args) => {
      if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
      if (args[0] === "ls-tree") {
        return {
          state: "succeeded",
          stdout: `120000 blob ${"b".repeat(40)}\t${path}\0`,
        };
      }
      return { reason: "unexpected", state: "failed" };
    },
  });
  assert.equal(badMode.state, "unreadable");

  const twoFiles = `${tree}100644 blob ${"c".repeat(40)}\t.atlas/second.md\0`;
  const totalTooLarge = captureLocalAtlasExploreSnapshot(
    repository,
    { ...exploreCommandBudgets, maxFileBytes: 10, maxTotalBytes: 9 },
    {
      readBatchText: () => ({
        state: "succeeded",
        stdout: `${"b".repeat(40)} blob 5\n${"c".repeat(40)} blob 5\n`,
      }),
      readText: (_repository, args) => {
        if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
        if (args[0] === "ls-tree") return { state: "succeeded", stdout: twoFiles };
        return { reason: "unexpected", state: "failed" };
      },
    },
  );
  assert.equal(totalTooLarge.state, "oversized");

  const readFailed = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readBatchBytes: () => ({ reason: "read failed", state: "failed" }),
      readBatchText: batchCheck,
      readText: textRunner,
    },
  );
  assert.equal(readFailed.state, "unreadable");

  const missingBatchHeader = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readBatchBytes: () => ({ state: "succeeded", stdout: new Uint8Array() }),
      readBatchText: batchCheck,
      readText: textRunner,
    },
  );
  assert.equal(missingBatchHeader.state, "unreadable");

  const unexpectedBatchHeader = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readBatchBytes: () => ({
        state: "succeeded",
        stdout: new TextEncoder().encode(`${"c".repeat(40)} blob 5\nabcde\n`),
      }),
      readBatchText: batchCheck,
      readText: textRunner,
    },
  );
  assert.equal(unexpectedBatchHeader.state, "unreadable");

  const trailingBatchData = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readBatchBytes: () => ({
        state: "succeeded",
        stdout: new TextEncoder().encode(`${"b".repeat(40)} blob 5\nabcde\nextra`),
      }),
      readBatchText: batchCheck,
      readText: textRunner,
    },
  );
  assert.equal(trailingBatchData.state, "unreadable");

  const statFailed = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readStat: () => {
        throw new Error("stat failed");
      },
    },
  );
  assert.equal(statFailed.state, "unreadable");

  const hiddenGitRoot = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readStat: (path_, options) =>
        path_.endsWith(".git") ? undefined : lstatSync(path_, options),
    },
  );
  assert.equal(hiddenGitRoot.state, "unreadable");

  const failedListing = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readText: (_repository, args) => {
        if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
        if (args[0] === "ls-tree") return { reason: "list failed", state: "failed" };
        return { reason: "unexpected", state: "failed" };
      },
    },
  );
  assert.equal(failedListing.state, "unreadable");

  const emptyListing = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readText: (_repository, args) => {
        if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
        if (args[0] === "ls-tree") return { state: "succeeded", stdout: "" };
        return { reason: "unexpected", state: "failed" };
      },
    },
  );
  assert.equal(emptyListing.state, "missing");

  const missingSeparator = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readText: (_repository, args) => {
        if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
        if (args[0] === "ls-tree") return { state: "succeeded", stdout: "malformed\0" };
        return { reason: "unexpected", state: "failed" };
      },
    },
  );
  assert.equal(missingSeparator.state, "missing");

  const missingPath = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readText: (_repository, args) => {
        if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
        if (args[0] === "ls-tree") {
          return { state: "succeeded", stdout: "100644 blob c\t\0" };
        }
        return { reason: "unexpected", state: "failed" };
      },
    },
  );
  assert.equal(missingPath.state, "missing");

  const malformedRepository = resolve(WORKSPACE, "malformed-git");
  rmSync(malformedRepository, { force: true, recursive: true });
  mkdirSync(resolve(malformedRepository, ".git"), { recursive: true });
  mkdirSync(resolve(malformedRepository, ".atlas"), { recursive: true });
  const unreadableResult = runLocalAtlasExplore(
    malformedRepository,
    "anything",
    exploreCommandBudgets,
  );
  assert.equal(
    unreadableResult.handoff.validationState.findings[0]?.code,
    "ATLAS_EXPLORE_ATLAS_UNREADABLE",
  );
});

test("trusted Git batch helpers fail closed when output exceeds the declared buffer", () => {
  assert.equal(
    runTrustedGitWithInput(ROOT, ["rev-parse", "HEAD"], "", 1).state,
    "failed",
  );
  assert.equal(
    runTrustedGitBytesWithInput(
      ROOT,
      ["cat-file", "--batch"],
      `${git(ROOT, ["rev-parse", "HEAD"])}\n`,
      1,
    ).state,
    "failed",
  );
});
