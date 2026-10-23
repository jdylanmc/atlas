import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  atlasCommandNames,
  atlasCommandUsage,
  captureAtlasHostDirectory,
} from "../scripts/atlas.ts";
import {
  atlasCommandExitCodes,
  commandNamesForDispatch,
  formatAtlasCommandUsage,
  serializeAtlasCommandMachineResult,
  unknownAtlasCommandOperationResult,
  usageAtlasCommandOperationResult,
  type AtlasCommandOperationResult,
} from "../src/interfaces/atlas_command.ts";
import {
  exitCodeForLintOperationResult,
  lintCommandExitCodes,
  serializeLintMachineResult,
  unreadableAtlasLintOperationResult,
  usageLintOperationResult,
} from "../src/interfaces/lint_command.ts";
import type { LintOperationResult } from "../src/operations/lint_operation.ts";
import { writeProseStyle } from "./prose_lint_fixtures.ts";

const ROOT = resolve(import.meta.dirname, "..");
const COMMAND = resolve(ROOT, "scripts", "atlas.ts");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "atlas-cli");
const HOSTS = resolve(ROOT, ".test-workspaces", "atlas-cli-hosts");

test.after(() => {
  rmSync(HOSTS, { force: true, recursive: true });
});

/**
 * Copies a committed fixture Atlas into its own Atlas Host Directory. The CLI
 * runs the real pinned Vale, so a host meant to lint as its fixture does
 * carries the Atlas SDK default prose style unless a test omits it.
 */
function fixtureHost(
  fixture: string,
  name: string,
  options: { readonly proseStyle: boolean } = { proseStyle: true },
): string {
  const host = resolve(HOSTS, name);
  rmSync(host, { force: true, recursive: true });
  cpSync(resolve(ROOT, "tests", "fixtures", fixture), host, { recursive: true });
  if (options.proseStyle) writeProseStyle(host);
  return host;
}

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

function runAtlasLint(atlasHostDirectory: string): CommandResult {
  return runAtlas(["lint", "--machine", "--atlas-host-directory", atlasHostDirectory]);
}

function parseResult(stdout: Buffer): LintOperationResult {
  const parsed = JSON.parse(stdout.toString("utf8")) as LintOperationResult;
  assert.equal(parsed["operation-result-schema"], "1.0.0");
  assert.equal(parsed.handoff["operation-handoff-schema"], "1.0.0");
  assert.deepEqual(parsed.handoff.operation, parsed.operation);
  return parsed;
}

function parseAtlasCommandResult(stdout: Buffer): AtlasCommandOperationResult {
  const parsed = JSON.parse(stdout.toString("utf8")) as AtlasCommandOperationResult;
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

test("bare atlas invocation returns typed usage naming every dispatchable command", () => {
  const command = runAtlas([]);

  assert.equal(command.status, atlasCommandExitCodes.usage);
  const result = parseAtlasCommandResult(command.stdout);
  assert.equal(result.completion, "not-completed");
  assert.equal(result.disposition, "failed");
  assert.equal(result.operation.kind, "atlas-command");
  assert.equal(result.payload.state, "not-completed");
  assert.equal(result.handoff.validationState.findings[0]?.code, "ATLAS_COMMAND_USAGE");
  for (const name of atlasCommandNames) {
    assert.match(command.stderr, new RegExp(`\\b${name}\\b`, "u"));
    assert.match(
      result.handoff.recommendedNextAction,
      new RegExp(`\\b${name}\\b`, "u"),
    );
  }
});

test("unknown atlas command returns a typed refusal naming it and every valid command", () => {
  const command = runAtlas(["frobnicate", "--machine"]);

  assert.equal(command.status, atlasCommandExitCodes.usage);
  const result = parseAtlasCommandResult(command.stdout);
  const finding = result.handoff.validationState.findings[0];
  assert.ok(finding);
  assert.equal(finding.code, "ATLAS_COMMAND_UNKNOWN");
  assert.match(finding.message, /frobnicate/u);
  assert.match(command.stderr, /frobnicate/u);
  for (const name of atlasCommandNames) {
    assert.match(command.stderr, new RegExp(`\\b${name}\\b`, "u"));
    assert.match(
      result.handoff.recommendedNextAction,
      new RegExp(`\\b${name}\\b`, "u"),
    );
  }
});

test("Atlas command usage derives from the dispatch keys", () => {
  const dispatch = Object.freeze({
    alpha: () => 0,
    beta: () => 0,
  });
  const names = commandNamesForDispatch(dispatch);

  assert.deepEqual(names, ["alpha", "beta"]);
  assert.equal(
    formatAtlasCommandUsage(names),
    "usage: atlas <command> --machine [arguments]\ncommands: alpha, beta",
  );
  assert.deepEqual(atlasCommandNames, [
    "lint",
    "initialize",
    "explore",
    "ingest",
    "govern",
    "input-contract",
  ]);
  assert.equal(atlasCommandUsage, formatAtlasCommandUsage(atlasCommandNames));
});

test("Atlas command refusal helpers preserve the public machine contract", () => {
  const usage = usageAtlasCommandOperationResult(atlasCommandUsage);
  const unknown = unknownAtlasCommandOperationResult("frobnicate", atlasCommandUsage);

  assert.equal(serializeAtlasCommandMachineResult(usage), `${JSON.stringify(usage)}\n`);
  assert.equal(usage.payload.findings, usage.handoff.validationState.findings);
  assert.equal(usage.handoff.degradationState.state, "not-degraded");
  assert.equal(
    unknown.payload.findings[0]?.message,
    'Unknown Atlas command "frobnicate".',
  );
});

test("atlas lint --machine emits a completed Operation Result and Handoff for a valid complete fixture", () => {
  const command = runAtlasLint(fixtureHost("complete-atlas", "valid"));

  assert.equal(command.status, lintCommandExitCodes.success);
  assert.equal(command.stderr, "");
  const result = parseResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.operation.kind, "lint");
  assert.equal(result.operation.subject, "captured-home-atlas");
  assert.equal(result.payload.state, "completed");
  assert.equal(result.payload.lint.outcome, "valid");
  assert.equal(result.handoff.validationState.state, "passed");
  // The default style's Google rules may advise on fixture prose; none may fail it.
  for (const finding of result.handoff.validationState.findings) {
    assert.match(finding.code, /^VALE_GOOGLE_/u);
    assert.notEqual(finding.severity, "error");
    assert.equal(finding.attribution.kind, "atlas-owned");
  }
  assert.equal(result.handoff.result.summary, "Lint passed.");
});

test("atlas lint --machine emits stable diagnostics and an invalid exit code for an invalid complete fixture", () => {
  const command = runAtlasLint(fixtureHost("invalid-complete-atlas", "invalid"));

  assert.equal(command.status, lintCommandExitCodes.atlasInvalid);
  assert.equal(command.stderr, "");
  const result = parseResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "failed");
  assert.equal(result.payload.state, "completed");
  assert.equal(result.payload.lint.outcome, "invalid");
  assert.equal("pages" in result.payload.lint, false);
  assert.deepEqual(
    result.payload.lint.findings
      .filter((finding) => finding.attribution.kind === "sdk-core")
      .map((finding) => finding.code),
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

test("atlas lint --machine fails a page whose prose exceeds the default Vale page length", () => {
  const host = fixtureHost("complete-atlas", "long-page");
  appendFileSync(
    resolve(host, ".atlas", "anchors", "lint.md"),
    `\n${"word ".repeat(1001).trimEnd()}.\n`,
  );

  const command = runAtlasLint(host);

  assert.equal(command.status, lintCommandExitCodes.atlasInvalid);
  assert.equal(command.stderr, "");
  const result = parseResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "failed");
  assert.equal(result.payload.state, "completed");
  assert.equal(result.payload.lint.outcome, "invalid");
  assert.deepEqual(
    result.payload.lint.findings
      .filter((finding) => finding.severity === "error")
      .map(({ attribution, code, path, severity }) => ({
        attribution,
        code,
        path,
        severity,
      })),
    [
      {
        attribution: {
          checkId: "vale.AtlasSDK.PageLength",
          kind: "atlas-owned",
          trusted: false,
        },
        code: "VALE_ATLASSDK_PAGELENGTH",
        path: ".atlas/anchors/lint.md",
        severity: "error",
      },
    ],
  );
});

test("atlas lint --machine fails an Atlas missing its Vale configuration", () => {
  const command = runAtlasLint(
    fixtureHost("complete-atlas", "no-vale-config", { proseStyle: false }),
  );

  assert.equal(command.status, lintCommandExitCodes.atlasInvalid);
  const result = parseResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.payload.state, "completed");
  assert.equal(result.payload.lint.outcome, "invalid");
  assert.deepEqual(
    result.payload.lint.findings.map(({ code, path }) => ({ code, path })),
    [{ code: "ATLAS_VALE_CONFIG_MISSING", path: ".atlas/.vale.ini" }],
  );
});

test("atlas lint --machine emits byte-identical stdout for repeated identical inputs", () => {
  const host = fixtureHost("complete-atlas", "repeated");
  const first = runAtlasLint(host);
  const second = runAtlasLint(host);

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
    fixtureHost("invalid-complete-atlas", "duplicate-invalid"),
    "--atlas-host-directory",
    fixtureHost("complete-atlas", "duplicate-valid"),
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

test("Atlas capture enforces file count and traversal depth during the walk", () => {
  rmSync(WORKSPACE, { force: true, recursive: true });
  mkdirSync(resolve(WORKSPACE, ".atlas", "a", "b"), { recursive: true });
  writeFileSync(resolve(WORKSPACE, ".atlas", "a.md"), "a");
  assert.throws(
    () => captureAtlasHostDirectory(WORKSPACE, { maxFiles: 0, maxTraversalDepth: 4 }),
    /file count/u,
  );
  assert.throws(
    () => captureAtlasHostDirectory(WORKSPACE, { maxFiles: 10, maxTraversalDepth: 1 }),
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
