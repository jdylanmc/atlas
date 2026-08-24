import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import type { Finding } from "../src/domain/finding.ts";
import {
  errorFindings,
  main,
  parseMachineResult,
  readLintOperationResult,
  runSdkAtlasLintGate,
  type LintMachineRun,
  type RunLintMachine,
} from "../scripts/sdk_atlas_lint.ts";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(ROOT, "scripts", "sdk_atlas_lint.ts");
const INVALID_SDK_ATLAS = resolve(ROOT, "tests/fixtures/invalid-sdk-atlas");

const envelopeFinding: Finding = Object.freeze({
  attribution: Object.freeze({
    checkId: "sdk-core.atlas-structure",
    kind: "sdk-core" as const,
    trusted: true as const,
  }),
  code: "ATLAS_PAGE_INVALID_ENVELOPE",
  "finding-schema": "1.0.0",
  location: Object.freeze({
    end: Object.freeze({ column: 1, line: 2 }),
    start: Object.freeze({ column: 1, line: 2 }),
  }),
  message: "Atlas page frontmatter does not satisfy the page envelope.",
  path: ".atlas/index.md",
  severity: "error" as const,
});

const missingAtlasFinding: Finding = Object.freeze({
  attribution: Object.freeze({
    checkId: "sdk-core.atlas-lint-command",
    kind: "sdk-core" as const,
    trusted: true as const,
  }),
  code: "ATLAS_LINT_ATLAS_NOT_FOUND",
  "finding-schema": "1.0.0",
  message: "Atlas Host Directory does not contain a .atlas directory.",
  path: ".atlas",
  severity: "error" as const,
});

function machineRun(result: unknown, status = 0): LintMachineRun {
  return { status, stderr: "", stdout: `${JSON.stringify(result)}\n` };
}

function textFile(
  path: string,
  content = "content\n",
): { content: string; path: string } {
  return { content, path };
}

function completedResult(input?: {
  readonly disposition?: "success" | "failed";
  readonly findings?: readonly Finding[];
  readonly opaque?: unknown;
  readonly outcome?: "valid" | "invalid";
  readonly pages?: unknown;
  readonly validationState?: "passed" | "failed" | "not-completed";
}): unknown {
  const findings = input?.findings ?? [];
  const outcome = input?.outcome ?? "valid";
  const disposition = input?.disposition ?? "success";
  return {
    "operation-result-schema": "1.0.0",
    completion: "completed",
    disposition,
    handoff: {
      "operation-handoff-schema": "1.0.0",
      operation: { kind: "lint", subject: "captured-home-atlas" },
      result: {
        disposition,
        summary: disposition === "success" ? "Lint passed." : "Lint failed.",
      },
      validationState: {
        findings,
        state: input?.validationState ?? "passed",
      },
    },
    operation: { kind: "lint", subject: "captured-home-atlas" },
    payload: {
      lint:
        outcome === "valid"
          ? {
              findings,
              opaque: input?.opaque ?? [
                textFile(".atlas/CHANGELOG.md", "# Changelog\n"),
              ],
              outcome,
              pages: input?.pages ?? [textFile(".atlas/index.md", "# Home Atlas\n")],
            }
          : { findings, outcome },
      state: "completed",
    },
  };
}

function notCompletedResult(): unknown {
  return {
    "operation-result-schema": "1.0.0",
    completion: "not-completed",
    disposition: "failed",
    handoff: {
      "operation-handoff-schema": "1.0.0",
      operation: { kind: "lint", subject: "atlas-host-directory" },
      result: { disposition: "failed", summary: "No Atlas was found." },
      validationState: {
        findings: [missingAtlasFinding],
        state: "not-completed",
      },
    },
    operation: { kind: "lint", subject: "atlas-host-directory" },
    payload: {
      findings: [missingAtlasFinding],
      state: "not-completed",
    },
  };
}

test("SDK Atlas lint gate accepts the committed SDK Atlas", () => {
  const result = runSdkAtlasLintGate(ROOT);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stderr, []);
  assert.deepEqual(result.stdout, [
    "validated SDK Atlas Lint: 18 page(s), 2 opaque record(s), 0 error Findings",
  ]);
});

test("SDK Atlas lint gate rejects an invalid Root Anchor envelope", () => {
  const result = runSdkAtlasLintGate(INVALID_SDK_ATLAS);

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, []);
  assert.equal(result.stderr[0], "error: SDK Atlas is not a Valid Atlas Lint Result.");
  assert.match(
    result.stderr.join("\n"),
    /error: \.atlas\/index\.md:2:1: ATLAS_PAGE_INVALID_ENVELOPE Atlas page frontmatter does not satisfy the page envelope\./,
  );
});

test("SDK Atlas lint gate rejects a missing Atlas Host Directory", () => {
  const result = runSdkAtlasLintGate(resolve(ROOT, "tests/fixtures/ingest"));

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, []);
  assert.equal(result.stderr[0], "error: SDK Atlas is not a Valid Atlas Lint Result.");
  assert.match(
    result.stderr.join("\n"),
    /error: \.atlas: ATLAS_LINT_ATLAS_NOT_FOUND Atlas Host Directory does not contain a \.atlas directory\./,
  );
});

test("SDK Atlas lint gate rejects a valid-shaped result with error Findings", () => {
  const runLintMachine: RunLintMachine = () =>
    machineRun(completedResult({ findings: [envelopeFinding] }));

  const result = runSdkAtlasLintGate(ROOT, runLintMachine);
  const machineResult = readLintOperationResult(
    parseMachineResult(runLintMachine(ROOT).stdout.trim()),
  );

  assert.deepEqual(errorFindings(machineResult), [envelopeFinding]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr[0], "error: SDK Atlas is not a Valid Atlas Lint Result.");
  assert.match(result.stderr.join("\n"), /ATLAS_PAGE_INVALID_ENVELOPE/);
});

test("SDK Atlas lint gate rejects completed result state contradictions", () => {
  const invalidOutcome = runSdkAtlasLintGate(ROOT, () =>
    machineRun(completedResult({ outcome: "invalid" })),
  );
  assert.equal(invalidOutcome.exitCode, 1);
  assert.deepEqual(invalidOutcome.stderr, [
    "error: SDK Atlas is not a Valid Atlas Lint Result.",
    "Lint status=0 disposition=success completion=completed outcome=invalid validation=passed",
  ]);

  const failedValidation = runSdkAtlasLintGate(ROOT, () =>
    machineRun(completedResult({ validationState: "failed" })),
  );
  assert.equal(failedValidation.exitCode, 1);
  assert.deepEqual(failedValidation.stderr, [
    "error: SDK Atlas is not a Valid Atlas Lint Result.",
    "Lint status=0 disposition=success completion=completed outcome=valid validation=failed",
  ]);

  const failedDisposition = runSdkAtlasLintGate(ROOT, () =>
    machineRun(completedResult({ disposition: "failed" })),
  );
  assert.equal(failedDisposition.exitCode, 1);
  assert.deepEqual(failedDisposition.stderr, [
    "error: SDK Atlas is not a Valid Atlas Lint Result.",
    "Lint status=0 disposition=failed completion=completed outcome=valid validation=passed",
  ]);
});

test("SDK Atlas lint gate rejects malformed operation and handoff metadata", () => {
  const wrongSchema = completedResult() as Record<string, unknown>;
  wrongSchema["operation-result-schema"] = "9.9.9";
  const schemaResult = runSdkAtlasLintGate(ROOT, () => machineRun(wrongSchema));
  assert.equal(schemaResult.exitCode, 1);
  assert.deepEqual(schemaResult.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: Lint result must use Operation Result schema 1.0.0.",
  ]);

  const wrongOperation = completedResult() as Record<string, unknown>;
  wrongOperation["operation"] = { kind: "initialize", subject: "captured-home-atlas" };
  const operationResult = runSdkAtlasLintGate(ROOT, () => machineRun(wrongOperation));
  assert.equal(operationResult.exitCode, 1);
  assert.deepEqual(operationResult.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: operation.kind must be lint.",
  ]);

  const mismatchedHandoffOperation = completedResult() as Record<string, unknown>;
  const mismatchHandoff = mismatchedHandoffOperation["handoff"] as Record<
    string,
    unknown
  >;
  mismatchHandoff["operation"] = { kind: "lint", subject: "atlas-host-directory" };
  const mismatchResult = runSdkAtlasLintGate(ROOT, () =>
    machineRun(mismatchedHandoffOperation),
  );
  assert.equal(mismatchResult.exitCode, 1);
  assert.deepEqual(mismatchResult.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: Lint handoff operation must match the Operation Result.",
  ]);

  const wrongSubject = completedResult() as Record<string, unknown>;
  wrongSubject["operation"] = { kind: "lint", subject: "atlas-host-directory" };
  const subjectHandoff = wrongSubject["handoff"] as Record<string, unknown>;
  subjectHandoff["operation"] = { kind: "lint", subject: "atlas-host-directory" };
  const subjectResult = runSdkAtlasLintGate(ROOT, () => machineRun(wrongSubject));
  assert.equal(subjectResult.exitCode, 1);
  assert.deepEqual(subjectResult.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: Completed Lint operation subject must be captured-home-atlas.",
  ]);

  const wrongHandoff = completedResult() as Record<string, unknown>;
  const handoff = wrongHandoff["handoff"] as Record<string, unknown>;
  handoff["operation-handoff-schema"] = "9.9.9";
  const handoffResult = runSdkAtlasLintGate(ROOT, () => machineRun(wrongHandoff));
  assert.equal(handoffResult.exitCode, 1);
  assert.deepEqual(handoffResult.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: Lint handoff must use Operation Handoff schema 1.0.0.",
  ]);

  const wrongResult = completedResult() as Record<string, unknown>;
  const wrongResultHandoff = wrongResult["handoff"] as Record<string, unknown>;
  wrongResultHandoff["result"] = { disposition: "failed", summary: "Mismatch." };
  const result = runSdkAtlasLintGate(ROOT, () => machineRun(wrongResult));
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: Lint handoff result disposition must match the Operation Result.",
  ]);
});

test("SDK Atlas lint gate rejects malformed page and opaque records", () => {
  const pageResult = runSdkAtlasLintGate(ROOT, () =>
    machineRun(completedResult({ pages: ["not a page"] })),
  );
  assert.equal(pageResult.exitCode, 1);
  assert.deepEqual(pageResult.stdout, []);
  assert.deepEqual(pageResult.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: payload.lint.pages contains a malformed Atlas text file.",
  ]);

  const opaqueResult = runSdkAtlasLintGate(ROOT, () =>
    machineRun(completedResult({ opaque: [42] })),
  );
  assert.equal(opaqueResult.exitCode, 1);
  assert.deepEqual(opaqueResult.stdout, []);
  assert.deepEqual(opaqueResult.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: payload.lint.opaque contains a malformed Atlas text file.",
  ]);
});

test("SDK Atlas lint gate rejects impossible Atlas text-file paths", () => {
  for (const [path, expected] of [
    ["", 'payload.lint.pages contains invalid Atlas path: "".'],
    [
      "../outside.md",
      'payload.lint.pages contains invalid Atlas path: "../outside.md".',
    ],
    [
      "docs/index.md",
      'payload.lint.pages contains invalid Atlas path: "docs/index.md".',
    ],
    [
      ".atlas//index.md",
      'payload.lint.pages contains non-canonical Atlas path: ".atlas//index.md" normalized to ".atlas/index.md".',
    ],
  ] as const) {
    const result = runSdkAtlasLintGate(ROOT, () =>
      machineRun(completedResult({ pages: [textFile(path)] })),
    );
    assert.equal(result.exitCode, 1, path);
    assert.deepEqual(result.stdout, [], path);
    assert.deepEqual(
      result.stderr,
      [`error: SDK Atlas Lint produced an invalid machine result: ${expected}`],
      path,
    );
  }
});

test("SDK Atlas lint gate rejects duplicate Atlas text-file paths", () => {
  const withinPages = runSdkAtlasLintGate(ROOT, () =>
    machineRun(
      completedResult({
        pages: [textFile(".atlas/index.md"), textFile(".atlas/index.md")],
      }),
    ),
  );
  assert.equal(withinPages.exitCode, 1);
  assert.deepEqual(withinPages.stderr, [
    'error: SDK Atlas Lint produced an invalid machine result: Valid Atlas Lint Result contains duplicate Atlas path: ".atlas/index.md".',
  ]);

  const withinOpaque = runSdkAtlasLintGate(ROOT, () =>
    machineRun(
      completedResult({
        opaque: [textFile(".atlas/CHANGELOG.md"), textFile(".atlas/CHANGELOG.md")],
      }),
    ),
  );
  assert.equal(withinOpaque.exitCode, 1);
  assert.deepEqual(withinOpaque.stderr, [
    'error: SDK Atlas Lint produced an invalid machine result: Valid Atlas Lint Result contains duplicate Atlas path: ".atlas/CHANGELOG.md".',
  ]);
});

test("SDK Atlas lint gate rejects page and opaque classification drift", () => {
  const opaquePage = runSdkAtlasLintGate(ROOT, () =>
    machineRun(completedResult({ pages: [textFile(".atlas/CHANGELOG.md")] })),
  );
  assert.equal(opaquePage.exitCode, 1);
  assert.deepEqual(opaquePage.stderr, [
    'error: SDK Atlas Lint produced an invalid machine result: payload.lint.pages contains an opaque Atlas path: ".atlas/CHANGELOG.md".',
  ]);

  const pageOpaque = runSdkAtlasLintGate(ROOT, () =>
    machineRun(completedResult({ opaque: [textFile(".atlas/index.md")] })),
  );
  assert.equal(pageOpaque.exitCode, 1);
  assert.deepEqual(pageOpaque.stderr, [
    'error: SDK Atlas Lint produced an invalid machine result: payload.lint.opaque contains a page Atlas path: ".atlas/index.md".',
  ]);
});

test("SDK Atlas lint gate rejects contradictory Finding collections", () => {
  const wrongHandoff = completedResult() as Record<string, unknown>;
  const handoff = wrongHandoff["handoff"] as Record<string, unknown>;
  const validationState = handoff["validationState"] as Record<string, unknown>;
  validationState["findings"] = [envelopeFinding];
  const completedMismatch = runSdkAtlasLintGate(ROOT, () => machineRun(wrongHandoff));
  assert.equal(completedMismatch.exitCode, 1);
  assert.deepEqual(completedMismatch.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: Lint handoff Findings must match payload Lint Findings.",
  ]);

  const wrongNotCompleted = notCompletedResult() as Record<string, unknown>;
  const payload = wrongNotCompleted["payload"] as Record<string, unknown>;
  payload["findings"] = [];
  const notCompletedMismatch = runSdkAtlasLintGate(ROOT, () =>
    machineRun(wrongNotCompleted),
  );
  assert.equal(notCompletedMismatch.exitCode, 1);
  assert.deepEqual(notCompletedMismatch.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: Lint handoff Findings must match payload Findings.",
  ]);
});

test("SDK Atlas lint gate rejects non-zero Lint status", () => {
  const result = runSdkAtlasLintGate(ROOT, () => machineRun(completedResult(), 1));

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, []);
  assert.deepEqual(result.stderr, [
    "error: SDK Atlas is not a Valid Atlas Lint Result.",
    "Lint status=1 disposition=success completion=completed outcome=valid validation=passed",
  ]);
});

test("SDK Atlas lint gate rejects malformed machine output", () => {
  const result = runSdkAtlasLintGate(ROOT, () => ({
    status: 0,
    stderr: "not json from Lint",
    stdout: "",
  }));

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, []);
  assert.deepEqual(result.stderr, [
    "error: SDK Atlas Lint produced an invalid machine result: Lint did not print a JSON Operation Result.",
    "not json from Lint",
  ]);
});

test("SDK Atlas lint gate rejects a not-completed Operation Result with Findings", () => {
  const result = runSdkAtlasLintGate(ROOT, () => machineRun(notCompletedResult(), 2));

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, []);
  assert.equal(result.stderr[0], "error: SDK Atlas is not a Valid Atlas Lint Result.");
  assert.match(result.stderr.join("\n"), /ATLAS_LINT_ATLAS_NOT_FOUND/);
});

test("SDK Atlas lint gate rejects an unstartable Lint process", () => {
  const result = runSdkAtlasLintGate(ROOT, () => ({
    error: new Error("spawn failed"),
    status: null,
    stderr: "",
    stdout: "",
  }));

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, []);
  assert.deepEqual(result.stderr, [
    "error: SDK Atlas Lint could not start: spawn failed",
  ]);
});

test("SDK Atlas lint gate rejects invalid command usage", () => {
  assert.equal(main([]), 2);
  assert.equal(main(["validate", "extra"]), 2);
  assert.equal(main(["validate", "--atlas-host-directory"]), 2);
});

test("SDK Atlas lint script is directly executable for the committed SDK Atlas", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "validate"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    "validated SDK Atlas Lint: 18 page(s), 2 opaque record(s), 0 error Findings\n",
  );
});

test("SDK Atlas lint script exits non-zero for an invalid Atlas fixture", () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "validate", "--atlas-host-directory", INVALID_SDK_ATLAS],
    { cwd: ROOT, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /error: \.atlas\/index\.md:2:1: ATLAS_PAGE_INVALID_ENVELOPE Atlas page frontmatter does not satisfy the page envelope\./,
  );
});
