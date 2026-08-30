import type { Finding } from "../domain/finding.ts";
import type { AtlasTextBudgets, CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { lintAtlas, type AtlasLintResult } from "../lint/lint_atlas.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationChanges,
  type OperationDegradationState,
  type OperationHandoff,
  type OperationIdentity,
  type OperationReference,
  type OperationResult,
  type OperationReviewLink,
} from "./operation_result.ts";

export type LintOperationSubject = "atlas-host-directory" | "captured-home-atlas";

export interface LintOperationIdentity extends OperationIdentity {
  readonly kind: "lint";
  readonly subject: LintOperationSubject;
}

const completedLintOperationPayloadBrand: unique symbol = Symbol(
  "completed-lint-operation-payload",
);

export interface CompletedLintOperationPayload {
  readonly [completedLintOperationPayloadBrand]: true;
  readonly lint: AtlasLintResult;
  readonly state: "completed";
}

export interface NotCompletedLintOperationPayload {
  readonly findings: readonly Finding[];
  readonly state: "not-completed";
}

export type LintOperationPayload =
  CompletedLintOperationPayload | NotCompletedLintOperationPayload;

export type LintOperationHandoff = OperationHandoff<LintOperationIdentity>;
export type LintOperationResult = OperationResult<
  LintOperationIdentity,
  LintOperationHandoff,
  LintOperationPayload
>;

export interface NotCompletedLintOperationInput {
  readonly baseSnapshotReason: string;
  readonly code: string;
  readonly degradationReason?: string;
  readonly homeAtlasReason: string;
  readonly message: string;
  readonly recommendedNextAction: string;
  readonly subject: LintOperationSubject;
  readonly summary: string;
}

const capturedHomeAtlasLintOperation: LintOperationIdentity = Object.freeze({
  kind: "lint",
  subject: "captured-home-atlas",
});

const noProposedChanges: OperationChanges = Object.freeze({
  reason: "Lint is read-only and proposes no Atlas Change Set.",
  state: "not-applicable",
});

const noReviewLink: OperationReviewLink = Object.freeze({
  reason: "Lint did not create an Atlas Proposal.",
  state: "not-applicable",
});

const noHumanDecisions = Object.freeze({
  state: "none" as const,
  summary: "No human decision is required to interpret this Lint result.",
});

const commandAttribution = Object.freeze({
  checkId: "sdk-core.atlas-lint-command",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const unknownHomeAtlas: OperationReference = Object.freeze({
  reason: "Lint received captured Atlas files without a resolved Atlas Locator.",
  state: "unknown",
});

const unknownBaseSnapshot: OperationReference = Object.freeze({
  reason: "Lint received captured Atlas files without a Git-backed Atlas Snapshot.",
  state: "unknown",
});

function lintOperation(subject: LintOperationSubject): LintOperationIdentity {
  return Object.freeze({ kind: "lint" as const, subject });
}

function commandFinding(code: string, message: string): Finding {
  return Object.freeze({
    attribution: commandAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path: ".atlas",
    severity: "error" as const,
  });
}

const schemaVersionDegradationCode = "ATLAS_SCHEMA_VERSION_NEWER_THAN_SDK";

interface LintSchemaDegradation {
  readonly degradationState: OperationDegradationState;
  readonly recommendedNextAction: string | undefined;
}

// Lint and Explore share one degradation vocabulary rather than each stating
// its own: `OperationDegradationState` on the Operation Handoff, already used
// identically by Explore. Explore derives its own `degraded`/`reason` from its
// own traversal signal (ExploreDegradationLevel, a fallback ladder over
// structural readability with no meaning for a schema-version Finding); Lint
// derives its own from this Finding instead of adopting that ladder or
// hardcoding a constant "not-degraded" disconnected from its Findings.
function schemaVersionDegradation(findings: readonly Finding[]): LintSchemaDegradation {
  const newerSchemaFindings = findings.filter(
    (finding) => finding.code === schemaVersionDegradationCode,
  );
  if (newerSchemaFindings.length === 0) {
    return Object.freeze({
      degradationState: Object.freeze({
        reason:
          "No Atlas page targets an atlas-sdk-schema contract newer than this Atlas SDK.",
        state: "not-degraded" as const,
      }),
      recommendedNextAction: undefined,
    });
  }
  const detail = newerSchemaFindings.map((finding) => finding.message).join(" ");
  return Object.freeze({
    degradationState: Object.freeze({
      reason: detail,
      state: "degraded" as const,
    }),
    recommendedNextAction: `Update Atlas SDK. ${detail}`,
  });
}

function completedLintHandoff(lint: AtlasLintResult): LintOperationHandoff {
  const success = lint.outcome === "valid";
  const schemaDegradation = schemaVersionDegradation(lint.findings);
  return Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: unknownBaseSnapshot,
    degradationState: schemaDegradation.degradationState,
    homeAtlas: unknownHomeAtlas,
    operation: capturedHomeAtlasLintOperation,
    proposedChanges: noProposedChanges,
    recommendedNextAction: success
      ? (schemaDegradation.recommendedNextAction ??
        "Use the validated Atlas records returned by Lint.")
      : "Resolve the reported Findings, then run Lint again.",
    result: Object.freeze({
      disposition: success ? ("success" as const) : ("failed" as const),
      summary: success ? "Lint passed." : "Lint reported error Findings.",
    }),
    reviewLink: noReviewLink,
    unresolvedHumanDecisions: noHumanDecisions,
    validationState: Object.freeze({
      findings: lint.findings,
      state: success ? ("passed" as const) : ("failed" as const),
    }),
  });
}

function didLintRuntimeFail(lint: AtlasLintResult): boolean {
  return lint.findings.some(
    (finding) =>
      finding.code === "ATLAS_LINT_FAILED" ||
      finding.code === "ATLAS_CAPTURE_UNREADABLE",
  );
}

export function notCompletedLintOperationResult(
  input: NotCompletedLintOperationInput,
): LintOperationResult {
  const findings = Object.freeze([commandFinding(input.code, input.message)]);
  const operation = lintOperation(input.subject);
  const handoff = Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: Object.freeze({
      reason: input.baseSnapshotReason,
      state: "unknown" as const,
    }),
    degradationState: Object.freeze({
      reason: input.degradationReason ?? input.summary,
      state:
        input.code === "ATLAS_LINT_ATLAS_NOT_FOUND" || input.code === "ATLAS_LINT_USAGE"
          ? ("not-degraded" as const)
          : ("degraded" as const),
    }),
    homeAtlas: Object.freeze({
      reason: input.homeAtlasReason,
      state: "unknown" as const,
    }),
    operation,
    proposedChanges: noProposedChanges,
    recommendedNextAction: input.recommendedNextAction,
    result: Object.freeze({
      disposition: "failed" as const,
      summary: input.summary,
    }),
    reviewLink: noReviewLink,
    unresolvedHumanDecisions: noHumanDecisions,
    validationState: Object.freeze({
      findings,
      state: "not-completed" as const,
    }),
  });
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "not-completed" as const,
    disposition: "failed" as const,
    handoff,
    operation,
    payload: Object.freeze({ findings, state: "not-completed" as const }),
  });
}

function runtimeFailureResult(lint: AtlasLintResult): LintOperationResult {
  const finding = lint.findings[0] as Finding;
  return notCompletedLintOperationResult({
    baseSnapshotReason: "Lint could not complete against the captured Atlas files.",
    code: finding.code,
    degradationReason: "Lint could not complete because the program running it failed.",
    homeAtlasReason: "Lint could not complete against the captured Atlas files.",
    message: finding.message,
    recommendedNextAction:
      "Retry Lint in a healthy runtime; if it repeats, escalate the operation failure.",
    subject: "captured-home-atlas",
    summary: "Lint did not complete.",
  });
}

export function runLintOperation(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): LintOperationResult {
  const lint = lintAtlas(capturedFiles, budgets);
  if (didLintRuntimeFail(lint)) return runtimeFailureResult(lint);
  const handoff = completedLintHandoff(lint);
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "completed" as const,
    disposition: handoff.result.disposition,
    handoff,
    operation: capturedHomeAtlasLintOperation,
    payload: Object.freeze({
      [completedLintOperationPayloadBrand]: true as const,
      lint,
      state: "completed" as const,
    }),
  });
}
