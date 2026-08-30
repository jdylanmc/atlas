import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { captureAtlasHostDirectory, CaptureBudgetError } from "../scripts/atlas.ts";
import {
  exitCodeForLintOperationResult,
  lintCommandExitCodes,
  serializeLintMachineResult,
  unreadableAtlasLintOperationResult,
  usageLintOperationResult,
} from "../src/interfaces/lint_command.ts";
import {
  runLintOperation,
  type LintOperationResult,
} from "../src/operations/lint_operation.ts";

const ROOT = resolve(import.meta.dirname, "..");
const COMMAND = resolve(ROOT, "scripts", "atlas.ts");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "atlas-cli");

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: Buffer;
}

function runAtlas(arguments_: readonly string[]): CommandResult {
  const result = spawnSync(process.execPath, [COMMAND, ...arguments_], {
    cwd: ROOT,
    encoding: "buffer",
  });
  assert.equal(result.error, undefined);
  return {
    status: result.status,
    stderr: result.stderr.toString("utf8"),
    stdout: result.stdout,
  };
}

function runAtlasLint(fixture: string): CommandResult {
  return runAtlas([
    "lint",
    "--machine",
    "--atlas-host-directory",
    resolve(ROOT, fixture),
  ]);
}

function parseResult(stdout: Buffer): LintOperationResult {
  const parsed = JSON.parse(stdout.toString("utf8")) as LintOperationResult;
  assert.equal(parsed["operation-result-schema"], "1.0.0");
  assert.equal(parsed.handoff["operation-handoff-schema"], "1.0.0");
  assert.deepEqual(parsed.handoff.operation, parsed.operation);
  return parsed;
}

function assertNotCompletedHasNoAtlasVerdict(result: LintOperationResult): void {
  assert.equal(result.completion, "not-completed");
  assert.equal(result.payload.state, "not-completed");
  assert.equal("lint" in result.payload, false);
  assert.notEqual(result.operation.subject, "captured-home-atlas");
}

test("atlas lint --machine emits a completed Operation Result and Handoff for a valid complete fixture", () => {
  const command = runAtlasLint("tests/fixtures/complete-atlas");

  assert.equal(command.status, lintCommandExitCodes.success);
  assert.equal(command.stderr, "");
  const result = parseResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.operation.kind, "lint");
  assert.equal(result.operation.subject, "captured-home-atlas");
  assert.equal(result.payload.state, "completed");
  assert.equal(result.payload.lint.outcome, "valid");
  assert.deepEqual(result.handoff.validationState, {
    findings: [],
    state: "passed",
  });
  assert.equal(result.handoff.result.summary, "Lint passed.");
});

test("atlas lint --machine emits stable diagnostics and an invalid exit code for an invalid complete fixture", () => {
  const command = runAtlasLint("tests/fixtures/invalid-complete-atlas");

  assert.equal(command.status, lintCommandExitCodes.atlasInvalid);
  assert.equal(command.stderr, "");
  const result = parseResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "failed");
  assert.equal(result.payload.state, "completed");
  assert.equal(result.payload.lint.outcome, "invalid");
  assert.equal("pages" in result.payload.lint, false);
  assert.deepEqual(
    result.payload.lint.findings.map((finding) => finding.code),
    [
      "ATLAS_PAGE_TITLE_H1_MISMATCH",
      "ATLAS_CITATION_TARGET_NOT_SOURCE",
      "ATLAS_PAGE_TYPE_PATH_MISMATCH",
    ],
  );
  assert.deepEqual(result.handoff.validationState, {
    findings: result.payload.lint.findings,
    state: "failed",
  });
});

test("atlas lint --machine emits byte-identical stdout for repeated identical inputs", () => {
  const first = runAtlasLint("tests/fixtures/complete-atlas");
  const second = runAtlasLint("tests/fixtures/complete-atlas");

  assert.equal(first.status, lintCommandExitCodes.success);
  assert.equal(second.status, lintCommandExitCodes.success);
  assert.equal(Buffer.compare(first.stdout, second.stdout), 0);
});

test("atlas lint --machine reports usage errors as JSON on stdout and stderr text", () => {
  const command = runAtlas(["lint", "--machine", "--bogus"]);
  assert.equal(command.status, lintCommandExitCodes.usage);
  assert.match(command.stderr, /usage: atlas lint/u);

  const result = parseResult(command.stdout);
  assertNotCompletedHasNoAtlasVerdict(result);
  assert.equal(result.handoff.validationState.findings[0]?.code, "ATLAS_LINT_USAGE");
});

test("atlas lint --machine rejects duplicate flags instead of linting the last Atlas", () => {
  const duplicateAtlas = runAtlas([
    "lint",
    "--machine",
    "--atlas-host-directory",
    resolve(ROOT, "tests/fixtures/invalid-complete-atlas"),
    "--atlas-host-directory",
    resolve(ROOT, "tests/fixtures/complete-atlas"),
  ]);
  assert.equal(duplicateAtlas.status, lintCommandExitCodes.usage);
  const duplicateAtlasResult = parseResult(duplicateAtlas.stdout);
  assertNotCompletedHasNoAtlasVerdict(duplicateAtlasResult);
  assert.equal(
    duplicateAtlasResult.handoff.validationState.findings[0]?.code,
    "ATLAS_LINT_USAGE",
  );

  const duplicateMachine = runAtlas(["lint", "--machine", "--machine"]);
  assert.equal(duplicateMachine.status, lintCommandExitCodes.usage);
  assert.equal(
    parseResult(duplicateMachine.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_LINT_USAGE",
  );
});

test("atlas lint --machine rejects the retired repository flag", () => {
  const command = runAtlas([
    "lint",
    "--machine",
    "--repository",
    resolve(ROOT, "tests/fixtures/complete-atlas"),
  ]);

  assert.equal(command.status, lintCommandExitCodes.usage);
  assert.match(command.stderr, /--atlas-host-directory/u);
  assert.equal(
    parseResult(command.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_LINT_USAGE",
  );
});

test("atlas lint --machine reports a missing Atlas as determinate usage, not a retryable runtime failure", () => {
  const command = runAtlas([
    "lint",
    "--machine",
    "--atlas-host-directory",
    resolve(ROOT, "tests/fixtures/no-such-atlas"),
  ]);
  assert.equal(command.status, lintCommandExitCodes.usage);
  assert.match(command.stderr, /does not contain/u);

  const result = parseResult(command.stdout);
  assertNotCompletedHasNoAtlasVerdict(result);
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_LINT_ATLAS_NOT_FOUND",
  );
  assert.deepEqual(result.handoff.degradationState, {
    reason: "No Atlas was found in the selected Atlas Host Directory.",
    state: "not-degraded",
  });
  assert.match(result.handoff.recommendedNextAction, /--atlas-host-directory/u);
  assert.doesNotMatch(result.handoff.recommendedNextAction, /Retry/u);
});

test("atlas lint --machine gives unreadable Atlas files a distinct runtime diagnostic", (context) => {
  rmSync(WORKSPACE, { force: true, recursive: true });
  mkdirSync(resolve(WORKSPACE, ".atlas"), { recursive: true });
  chmodSync(resolve(WORKSPACE, ".atlas"), 0o000);
  try {
    const command = runAtlas([
      "lint",
      "--machine",
      "--atlas-host-directory",
      WORKSPACE,
    ]);
    if (command.status !== lintCommandExitCodes.operationNotCompleted) {
      context.skip("filesystem permissions did not block reading .atlas");
      return;
    }
    const result = parseResult(command.stdout);
    assertNotCompletedHasNoAtlasVerdict(result);
    assert.equal(
      result.handoff.validationState.findings[0]?.code,
      "ATLAS_LINT_ATLAS_UNREADABLE",
    );
    assert.deepEqual(result.handoff.degradationState, {
      reason: "Lint could not capture the Atlas files.",
      state: "degraded",
    });
  } finally {
    chmodSync(resolve(WORKSPACE, ".atlas"), 0o700);
    rmSync(WORKSPACE, { force: true, recursive: true });
  }
});

test("Atlas capture enforces total byte budget before reading the offending file", () => {
  rmSync(WORKSPACE, { force: true, recursive: true });
  mkdirSync(resolve(WORKSPACE, ".atlas"), { recursive: true });
  writeFileSync(resolve(WORKSPACE, ".atlas", "a.md"), "a".repeat(10));
  writeFileSync(resolve(WORKSPACE, ".atlas", "b.md"), "b".repeat(10));
  let bytesRead = 0;
  try {
    captureAtlasHostDirectory(
      WORKSPACE,
      {
        maxFileBytes: 10,
        maxFiles: 10,
        maxTotalBytes: 15,
        maxTraversalDepth: 4,
      },
      (fd) => {
        const bytes = readFileSync(fd);
        bytesRead += bytes.byteLength;
        return bytes;
      },
    );
    assert.fail("expected capture budget failure");
  } catch (error: unknown) {
    assert.ok(error instanceof CaptureBudgetError);
    assert.equal(bytesRead, 10);
    const result = runLintOperation(error.capturedFiles, {
      maxFileBytes: 10,
      maxTotalBytes: 15,
    });
    assert.equal(result.completion, "completed");
    assert.equal(result.disposition, "failed");
    if (result.payload.state !== "completed") assert.fail("budget result failed");
    assert.equal(result.payload.lint.findings[0]?.code, "ATLAS_LOAD_TOTAL_TOO_LARGE");
  } finally {
    rmSync(WORKSPACE, { force: true, recursive: true });
  }
});

test("Atlas capture enforces file count and traversal depth during the walk", () => {
  rmSync(WORKSPACE, { force: true, recursive: true });
  mkdirSync(resolve(WORKSPACE, ".atlas", "a", "b"), { recursive: true });
  writeFileSync(resolve(WORKSPACE, ".atlas", "a.md"), "a");
  assert.throws(
    () =>
      captureAtlasHostDirectory(WORKSPACE, {
        maxFileBytes: 10,
        maxFiles: 0,
        maxTotalBytes: 10,
        maxTraversalDepth: 4,
      }),
    /file count/u,
  );
  assert.throws(
    () =>
      captureAtlasHostDirectory(WORKSPACE, {
        maxFileBytes: 10,
        maxFiles: 10,
        maxTotalBytes: 10,
        maxTraversalDepth: 1,
      }),
    /traversal depth/u,
  );
  rmSync(WORKSPACE, { force: true, recursive: true });
});

test("Lint command exit-code and JSON helpers preserve the public machine contract", () => {
  const usage = usageLintOperationResult("bad arguments");
  const unreadable = unreadableAtlasLintOperationResult("capture failed");

  assert.equal(serializeLintMachineResult(usage), `${JSON.stringify(usage)}\n`);
  assert.equal(exitCodeForLintOperationResult(usage), lintCommandExitCodes.usage);
  assertNotCompletedHasNoAtlasVerdict(usage);
  if (usage.payload.state !== "not-completed") assert.fail("usage completed");
  assert.equal(usage.payload.findings[0]?.message, "bad arguments");
  assert.equal(
    exitCodeForLintOperationResult(unreadable),
    lintCommandExitCodes.operationNotCompleted,
  );
  if (unreadable.payload.state !== "not-completed") {
    assert.fail("unreadable completed");
  }
  assert.equal(unreadable.payload.findings[0]?.code, "ATLAS_LINT_ATLAS_UNREADABLE");
});
