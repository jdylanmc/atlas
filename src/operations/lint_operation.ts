import type { AtlasTextBudgets, CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { lintAtlas, type AtlasLintResult } from "../lint/lint_atlas.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationChanges,
  type OperationHandoff,
  type OperationIdentity,
  type OperationReference,
  type OperationResult,
  type OperationReviewLink,
} from "./operation_result.ts";

export interface LintOperationIdentity extends OperationIdentity {
  readonly kind: "lint";
  readonly subject: "captured-home-atlas";
}

export interface LintOperationPayload {
  readonly lint: AtlasLintResult;
}

export type LintOperationHandoff = OperationHandoff<LintOperationIdentity>;
export type LintOperationResult = OperationResult<
  LintOperationIdentity,
  LintOperationHandoff,
  LintOperationPayload
>;

const lintOperation: LintOperationIdentity = Object.freeze({
  kind: "lint",
  subject: "captured-home-atlas",
});

const unknownHomeAtlas: OperationReference = Object.freeze({
  reason: "Lint received captured Atlas files without a resolved Atlas Locator.",
  state: "unknown",
});

const unknownBaseSnapshot: OperationReference = Object.freeze({
  reason: "Lint received captured Atlas files without a Git-backed Atlas Snapshot.",
  state: "unknown",
});

const noProposedChanges: OperationChanges = Object.freeze({
  reason: "Lint is read-only and proposes no Atlas Change Set.",
  state: "not-applicable",
});

const noReviewLink: OperationReviewLink = Object.freeze({
  reason: "Lint did not create an Atlas Proposal.",
  state: "not-applicable",
});

function didLintRuntimeFail(lint: AtlasLintResult): boolean {
  return lint.findings.some(
    (finding) =>
      finding.code === "ATLAS_LINT_FAILED" ||
      finding.code === "ATLAS_CAPTURE_UNREADABLE",
  );
}

function lintHandoff(lint: AtlasLintResult): LintOperationHandoff {
  const runtimeFailure = didLintRuntimeFail(lint);
  const success = lint.outcome === "valid";
  return Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: unknownBaseSnapshot,
    degradationState: runtimeFailure
      ? Object.freeze({
          reason: "Lint could not complete because the program running it failed.",
          state: "degraded" as const,
        })
      : Object.freeze({
          reason: "The operation completed through deterministic Lint.",
          state: "not-degraded" as const,
        }),
    homeAtlas: unknownHomeAtlas,
    operation: lintOperation,
    proposedChanges: noProposedChanges,
    recommendedNextAction: runtimeFailure
      ? "Retry Lint in a healthy runtime; if it repeats, escalate the operation failure."
      : success
        ? "Use the validated Atlas records returned by Lint."
        : "Resolve the reported Findings, then run Lint again.",
    result: Object.freeze({
      disposition: success ? ("success" as const) : ("failed" as const),
      summary: runtimeFailure
        ? "Lint did not complete."
        : success
          ? "Lint passed."
          : "Lint reported error Findings.",
    }),
    reviewLink: noReviewLink,
    unresolvedHumanDecisions: Object.freeze({
      state: "none" as const,
      summary: "No human decision is required to interpret this Lint result.",
    }),
    validationState: Object.freeze({
      findings: lint.findings,
      state: runtimeFailure
        ? ("not-completed" as const)
        : success
          ? ("passed" as const)
          : ("failed" as const),
    }),
  });
}

export function runLintOperation(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): LintOperationResult {
  const lint = lintAtlas(capturedFiles, budgets);
  const handoff = lintHandoff(lint);
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion:
      handoff.validationState.state === "not-completed"
        ? ("not-completed" as const)
        : ("completed" as const),
    disposition: handoff.result.disposition,
    handoff,
    operation: lintOperation,
    payload: Object.freeze({ lint }),
  });
}
