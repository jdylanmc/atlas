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
import type {
  TrustedGitResult,
  runTrustedGitBytes,
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

test("atlas explore --machine refuses oversized queries as machine JSON", () => {
  const command = runAtlas([
    "explore",
    "--machine",
    "x".repeat(exploreCommandBudgets.maxQueryCharacters + 1),
    "--atlas-host-directory",
    resolve(ROOT, "tests", "fixtures", "complete-atlas"),
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
    if (args[0] === "cat-file") return { state: "succeeded", stdout: "5" };
    return { reason: "unexpected", state: "failed" };
  };
  const shortBytes: typeof runTrustedGitBytes = () => ({
    state: "succeeded",
    stdout: new TextEncoder().encode("abcd"),
  });
  assert.equal(
    captureLocalAtlasExploreSnapshot(repository, exploreCommandBudgets, {
      readBytes: shortBytes,
      readText: textRunner,
    }).state,
    "unreadable",
  );

  const badSize = captureLocalAtlasExploreSnapshot(repository, exploreCommandBudgets, {
    readBytes: shortBytes,
    readText: (_repository, args) => {
      if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
      if (args[0] === "ls-tree") return { state: "succeeded", stdout: tree };
      if (args[0] === "cat-file") return { state: "succeeded", stdout: "NaN" };
      return { reason: "unexpected", state: "failed" };
    },
  });
  assert.equal(badSize.state, "unreadable");

  const badMode = captureLocalAtlasExploreSnapshot(repository, exploreCommandBudgets, {
    readBytes: shortBytes,
    readText: (_repository, args) => {
      if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
      if (args[0] === "ls-tree") {
        return { state: "succeeded", stdout: `120000 blob c\t${path}\0` };
      }
      return { reason: "unexpected", state: "failed" };
    },
  });
  assert.equal(badMode.state, "unreadable");

  const twoFiles = `${tree}100644 blob ${"c".repeat(40)}\t.atlas/second.md\0`;
  const fiveBytes: typeof runTrustedGitBytes = () => ({
    state: "succeeded",
    stdout: new TextEncoder().encode("abcde"),
  });
  const totalTooLarge = captureLocalAtlasExploreSnapshot(
    repository,
    { ...exploreCommandBudgets, maxFileBytes: 10, maxTotalBytes: 9 },
    {
      readBytes: fiveBytes,
      readText: (_repository, args) => {
        if (args[0] === "rev-parse") return { state: "succeeded", stdout: revision };
        if (args[0] === "ls-tree") return { state: "succeeded", stdout: twoFiles };
        if (args[0] === "cat-file") return { state: "succeeded", stdout: "5" };
        return { reason: "unexpected", state: "failed" };
      },
    },
  );
  assert.equal(totalTooLarge.state, "oversized");

  const readFailed = captureLocalAtlasExploreSnapshot(
    repository,
    exploreCommandBudgets,
    {
      readBytes: () => ({ reason: "read failed", state: "failed" }),
      readText: textRunner,
    },
  );
  assert.equal(readFailed.state, "unreadable");

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
