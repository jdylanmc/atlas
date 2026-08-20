import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type {
  AtlasTextBudgets,
  CapturedAtlasFile,
} from "../src/atlas/load_atlas_text.ts";
import type {
  OperationHandoff,
  OperationIdentity,
  OperationResult,
} from "../src/operations/operation_result.ts";
import { runLintOperation } from "../src/operations/lint_operation.ts";

const encoder = new TextEncoder();
const fixturesRoot = resolve(import.meta.dirname, "fixtures", "complete-atlas");

const generousBudgets: AtlasTextBudgets = Object.freeze({
  maxFileBytes: 4096,
  maxTotalBytes: 65536,
});

const atlasPaths = [
  ".atlas/framework/README.md",
  ".atlas/CHANGELOG.md",
  ".atlas/sources/atlas-sdk-lint.md",
  ".atlas/index.md",
  ".atlas/edges/lint-covers-canonical-serialization.md",
  ".atlas/principles/determinism.md",
  ".atlas/concepts/canonical-serialization.md",
  ".atlas/anchors/lint.md",
] as const;

const defects: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  ".atlas/concepts/canonical-serialization.md": [
    "# Canonical Serialization",
    "# Canonical Bytes",
  ],
  ".atlas/edges/lint-covers-canonical-serialization.md": [
    "[[.atlas/sources/atlas-sdk-lint]]",
    "[[.atlas/concepts/canonical-serialization]]",
  ],
  ".atlas/principles/determinism.md": ["  type: principle", "  type: concept"],
});

function fixtureText(path: string): string {
  return readFileSync(resolve(fixturesRoot, path), "utf8");
}

function fixtureBytes(variant: "invalid" | "valid", path: string): Uint8Array {
  const text = fixtureText(path);
  const defect = variant === "invalid" ? defects[path] : undefined;
  if (defect === undefined) return encoder.encode(text);
  const [before, after] = defect;
  assert.equal(text.includes(before), true, `${path} no longer holds ${before}`);
  return encoder.encode(text.replace(before, after));
}

function completeAtlas(variant: "invalid" | "valid"): CapturedAtlasFile[] {
  return atlasPaths.map((path) => ({ bytes: fixtureBytes(variant, path), path }));
}

test("Operation Workflow returns a versioned completed Lint result and handoff for a valid Atlas", () => {
  const result = runLintOperation(completeAtlas("valid"), generousBudgets);

  assert.equal(result["operation-result-schema"], "1.0.0");
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.payload.lint.outcome, "valid");
  assert.deepEqual(result.payload.lint.findings, []);
  assert.equal(result.handoff["operation-handoff-schema"], "1.0.0");
  assert.deepEqual(result.handoff.operation, result.operation);
  assert.deepEqual(result.handoff.homeAtlas, {
    reason: "Lint received captured Atlas files without a resolved Atlas Locator.",
    state: "unknown",
  });
  assert.deepEqual(result.handoff.baseSnapshot, {
    reason: "Lint received captured Atlas files without a Git-backed Atlas Snapshot.",
    state: "unknown",
  });
  assert.deepEqual(result.handoff.proposedChanges, {
    reason: "Lint is read-only and proposes no Atlas Change Set.",
    state: "not-applicable",
  });
  assert.deepEqual(result.handoff.validationState, {
    findings: [],
    state: "passed",
  });
  assert.deepEqual(result.handoff.reviewLink, {
    reason: "Lint did not create an Atlas Proposal.",
    state: "not-applicable",
  });
  assert.deepEqual(result.handoff.unresolvedHumanDecisions, {
    state: "none",
    summary: "No human decision is required to interpret this Lint result.",
  });
  assert.equal(
    result.handoff.recommendedNextAction,
    "Use the validated Atlas records returned by Lint.",
  );
});

test("Operation Workflow returns a non-success Lint result and handoff for an invalid Atlas", () => {
  const result = runLintOperation(completeAtlas("invalid"), generousBudgets);

  assert.equal(result["operation-result-schema"], "1.0.0");
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "failed");
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
  assert.deepEqual(result.handoff.result, {
    disposition: "failed",
    summary: "Lint reported error Findings.",
  });
  assert.equal(result.handoff["operation-handoff-schema"], "1.0.0");
  assert.deepEqual(result.handoff.validationState, {
    findings: result.payload.lint.findings,
    state: "failed",
  });
  assert.deepEqual(result.handoff.degradationState, {
    reason: "The operation completed through deterministic Lint.",
    state: "not-degraded",
  });
  assert.equal(
    result.handoff.recommendedNextAction,
    "Resolve the reported Findings, then run Lint again.",
  );
});

test("Operation Workflow reports captured-file runtime failure as degraded non-completion", () => {
  const [first, ...rest] = completeAtlas("valid");
  assert.ok(first !== undefined);
  const hostile = {
    get bytes(): Uint8Array {
      throw new Error("capture failed");
    },
    path: first.path,
  };
  const result = runLintOperation([hostile, ...rest], generousBudgets);

  assert.equal(result.completion, "not-completed");
  assert.equal(result.disposition, "failed");
  assert.equal(result.payload.lint.outcome, "invalid");
  assert.deepEqual(
    result.payload.lint.findings.map((finding) => finding.code),
    ["ATLAS_CAPTURE_UNREADABLE"],
  );
  assert.deepEqual(result.handoff.degradationState, {
    reason: "Lint could not complete because the program running it failed.",
    state: "degraded",
  });
  assert.deepEqual(result.handoff.validationState, {
    findings: result.payload.lint.findings,
    state: "not-completed",
  });
  assert.equal(
    result.handoff.recommendedNextAction,
    "Retry Lint in a healthy runtime; if it repeats, escalate the operation failure.",
  );
});

test("Operation Workflow reports stack exhaustion as degraded non-completion", () => {
  function atStackDepth<T>(depth: number, run: () => T): T {
    return depth <= 0 ? run() : atStackDepth(depth - 1, run);
  }

  const atlas = completeAtlas("valid");
  let ceiling = 1000;
  for (; ceiling < 1e7; ceiling *= 2) {
    try {
      atStackDepth(ceiling, () => runLintOperation(atlas, generousBudgets));
    } catch {
      break;
    }
  }

  let reported: ReturnType<typeof runLintOperation> | undefined;
  for (
    let depth = ceiling / 2;
    depth <= ceiling && reported === undefined;
    depth += 2
  ) {
    try {
      const result = atStackDepth(depth, () =>
        runLintOperation(atlas, generousBudgets),
      );
      if (result.payload.lint.findings[0]?.code === "ATLAS_LINT_FAILED") {
        reported = result;
      }
    } catch {
      continue;
    }
  }

  assert.ok(reported !== undefined, "no Lint ran out of room to complete");
  assert.equal(reported.completion, "not-completed");
  assert.deepEqual(reported.handoff.result, {
    disposition: "failed",
    summary: "Lint did not complete.",
  });
  assert.deepEqual(reported.handoff.degradationState, {
    reason: "Lint could not complete because the program running it failed.",
    state: "degraded",
  });
});

test("Operation Handoff contract accepts non-Lint operation states", () => {
  const operation = Object.freeze({
    kind: "initialization",
    subject: "home-atlas",
  }) satisfies OperationIdentity;
  const handoff: OperationHandoff<typeof operation> = Object.freeze({
    "operation-handoff-schema": "1.0.0",
    baseSnapshot: Object.freeze({
      reference: "abc123",
      state: "known",
    }),
    degradationState: Object.freeze({
      reason: "A required external service did not answer.",
      state: "degraded",
    }),
    homeAtlas: Object.freeze({
      reference: "atlas-sdk",
      state: "known",
    }),
    operation,
    proposedChanges: Object.freeze({
      summary: "Open an Atlas Proposal for review.",
      state: "available",
    }),
    recommendedNextAction: "Review the proposed Atlas initialization.",
    result: Object.freeze({
      disposition: "failed",
      summary: "Initialization requires a human decision.",
    }),
    reviewLink: Object.freeze({
      state: "available",
      url: "https://example.invalid/review/1",
    }),
    unresolvedHumanDecisions: Object.freeze({
      decisions: Object.freeze(["Choose the publication scope."]),
      state: "pending",
    }),
    validationState: Object.freeze({
      findings: Object.freeze([]),
      state: "not-completed",
    }),
  });
  const result: OperationResult<typeof operation, typeof handoff, object> =
    Object.freeze({
      "operation-result-schema": "1.0.0",
      completion: "not-completed",
      disposition: "failed",
      handoff,
      operation,
      payload: Object.freeze({}),
    });

  assert.deepEqual(result.handoff.operation, operation);
  assert.equal(result.handoff.reviewLink.state, "available");
});

test("Lint operation results and handoffs are deterministic and frozen", () => {
  for (const variant of ["invalid", "valid"] as const) {
    const first = runLintOperation(completeAtlas(variant), generousBudgets);
    assert.deepEqual(runLintOperation(completeAtlas(variant), generousBudgets), first);
    assert.deepEqual(
      runLintOperation(completeAtlas(variant).toReversed(), generousBudgets),
      first,
    );
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.handoff), true);
    assert.equal(Object.isFrozen(first.handoff.result), true);
    assert.equal(Object.isFrozen(first.handoff.validationState), true);
  }
});
