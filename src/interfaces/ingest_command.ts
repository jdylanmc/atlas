import type { Finding } from "../domain/finding.ts";
import { ingestRequestInput, ingestScopeInput } from "./command_input_contracts.ts";
import { readInput } from "./input_contract.ts";
export { ingestCommandInputBudgets } from "./command_input_contracts.ts";
import {
  validateApproval,
  validateIngestScopeTime,
  type AtlasIngestHandoff,
  type AtlasIngestRequest,
  type AtlasIngestResult,
  type AtlasIngestScope,
  type AtlasIngestWorkflowState,
  type SourceAuthority,
} from "../operations/ingest_operation.ts";
import type { AtlasApprovalAttestation } from "../operations/operation_support.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationResult,
} from "../operations/operation_result.ts";

// Atlas SDK does not invoke a model (docs/adr/0001-sdk-is-a-deterministic-library.md).
// This command is the deterministic half of the Ingest seam. It hands out a
// Crawl Assignment derived from a human-approved Ingest Scope, accepts one
// Candidate Graph back as validated input, and delegates the single
// deterministic reconciliation to the Ingest operation. No crawl, network,
// model, subagent dispatch, or API key lives here or anywhere it imports.

export const ingestPlanCommandUsage =
  "usage: atlas ingest plan --machine --ingest-scope PATH";

export const ingestReconcileCommandUsage =
  "usage: atlas ingest reconcile --machine --ingest-request PATH [--atlas-host-directory PATH]";

export const ingestCommandUsage = `${ingestPlanCommandUsage}\n${ingestReconcileCommandUsage}`;

export const ingestCommandExitCodes = Object.freeze({
  approvalRequired: 4,
  operationFailed: 1,
  operationNotCompleted: 2,
  scopeAwaitingApproval: 3,
  success: 0,
  usage: 64,
} as const);

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.atlas-ingest-command",
  kind: "sdk-core" as const,
  trusted: true as const,
});

function ingestFinding(code: string, message: string, path = ".atlas"): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "error" as const,
  });
}

const placeholderWorkflowState: AtlasIngestWorkflowState = Object.freeze({
  "operation-workflow-schema": "1.0.0" as const,
  baseSnapshotDigest: "unknown",
  effectReceipts: Object.freeze([]),
  operationId: "unknown",
  proposalBranch: "unknown",
  targetBranch: "unknown",
  targetHead: "unknown",
});

const ingestOperationIdentity = Object.freeze({
  kind: "ingest" as const,
  subject: "repository-source" as const,
});

// A determinate refusal the command reaches before any mutation: bad arguments,
// input that does not type-check, or a Candidate Graph that does not correspond
// to the approved Source. It is a VALUE with a stable code, rather than an exception.
function notCompletedIngestResult(
  findings: readonly Finding[],
  summary: string,
  recommendedNextAction: string,
): AtlasIngestResult {
  const handoff: AtlasIngestHandoff = Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: Object.freeze({
      reason: "Ingest command refused before reading a base snapshot.",
      state: "unknown" as const,
    }),
    degradationState: Object.freeze({
      reason: summary,
      state: "not-degraded" as const,
    }),
    homeAtlas: Object.freeze({
      reason: "Ingest command refused before selecting an Atlas Host Directory.",
      state: "unknown" as const,
    }),
    operation: ingestOperationIdentity,
    proposedChanges: Object.freeze({ reason: summary, state: "unknown" as const }),
    recommendedNextAction,
    result: Object.freeze({ disposition: "failed" as const, summary }),
    reviewLink: Object.freeze({
      reason: "Ingest did not create an Atlas Proposal.",
      state: "not-applicable" as const,
    }),
    unresolvedHumanDecisions: Object.freeze({
      state: "none" as const,
      summary: "No unresolved human decision is encoded in this refusal.",
    }),
    validationState: Object.freeze({
      findings: Object.freeze([...findings]),
      state: "not-completed" as const,
    }),
  });
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "not-completed" as const,
    disposition: "failed" as const,
    handoff,
    operation: ingestOperationIdentity,
    payload: Object.freeze({
      state: "not-completed" as const,
      workflowState: placeholderWorkflowState,
    }),
  });
}

export function usageIngestOperationResult(message: string): AtlasIngestResult {
  return notCompletedIngestResult(
    [ingestFinding("ATLAS_INGEST_USAGE", message)],
    "Ingest command arguments were invalid.",
    ingestCommandUsage,
  );
}

export function invalidInputIngestOperationResult(message: string): AtlasIngestResult {
  return notCompletedIngestResult(
    [ingestFinding("ATLAS_INGEST_INPUT_INVALID", message)],
    "Ingest command input did not type-check as an Ingest Scope or Candidate Graph.",
    "Correct the typed Ingest input so every field matches the accepted shape, then retry.",
  );
}

export function oversizedInputIngestOperationResult(
  message: string,
): AtlasIngestResult {
  return notCompletedIngestResult(
    [ingestFinding("ATLAS_INGEST_INPUT_TOO_LARGE", message)],
    "Ingest command input exceeded the JSON byte budget before it could be read.",
    "Reduce the Ingest input JSON to the supported byte budget, then retry.",
  );
}

export type IngestParseOutcome<Value> =
  | { readonly ok: false; readonly result: AtlasIngestResult }
  | { readonly ok: true; readonly value: Value };

export function parseIngestScope(value: unknown): IngestParseOutcome<AtlasIngestScope> {
  const parsed = readInput(ingestScopeInput, value, "scope");
  return parsed.ok
    ? parsed
    : {
        ok: false,
        result: invalidInputIngestOperationResult(
          parsed.issues.map((issue) => issue.message).join("\n"),
        ),
      };
}

export function parseIngestRequest(
  value: unknown,
): IngestParseOutcome<AtlasIngestRequest> {
  const parsed = readInput(ingestRequestInput, value, "request");
  return parsed.ok
    ? parsed
    : {
        ok: false,
        result: invalidInputIngestOperationResult(
          parsed.issues.map((issue) => issue.message).join("\n"),
        ),
      };
}

// The Crawl Assignment the SDK hands out. The brand is a non-exported symbol, so
// a caller does not forge an assignment that claims human approval: obtaining
// one goes through planCrawlAssignment, which refuses without approval.
const crawlAssignmentBrand: unique symbol = Symbol("atlas-ingest-crawl-assignment");

export interface AtlasIngestCrawlAssignment {
  readonly [crawlAssignmentBrand]: true;
  readonly "crawl-assignment-schema": "1.0.0";
  readonly asOf: string;
  readonly attestation: AtlasApprovalAttestation;
  readonly authority: SourceAuthority;
  readonly entryPoint: string;
  readonly excludedPaths: readonly string[];
  readonly includedPaths: readonly string[];
  readonly maxDepth: number;
  readonly refreshWindowDays: number;
  readonly sourceId: string;
}

export interface AtlasIngestPlanResult extends OperationResult<
  AtlasIngestResult["operation"],
  AtlasIngestHandoff,
  { readonly crawlAssignment: AtlasIngestCrawlAssignment }
> {
  readonly completion: "completed";
  readonly disposition: "success";
}

export type AtlasIngestPlanOutcome =
  | { readonly result: AtlasIngestResult; readonly state: "refused" }
  | { readonly result: AtlasIngestPlanResult; readonly state: "assigned" };

// Approval is enforced here through the same validateApproval gate the Ingest
// operation runs before it mutates, so a blank approval refuses the Crawl
// Assignment exactly as it later refuses reconciliation. The negative branch
// blocks: no assignment is constructed when approval is missing. `now`, when
// supplied by the caller, is the only clock reading in this check; the Scope's
// own Approval Attestation is re-verified again at reconcile time against
// whatever Scope is actually submitted then, so a Scope mutated between plan
// and reconcile reproduces a different digest and is refused there even if a
// crawler skips planning or replays a stale assignment.
export function planCrawlAssignment(
  scope: AtlasIngestScope,
  now?: string,
): AtlasIngestPlanOutcome {
  const approvalFindings = validateApproval(scope, now);
  if (approvalFindings.length > 0) {
    return {
      result: notCompletedIngestResult(
        approvalFindings,
        "Ingest refused to hand out a Crawl Assignment without Maintainer approval.",
        "Record the approving Maintainer identity and time on the Ingest Scope, then plan again.",
      ),
      state: "refused",
    };
  }
  const timestampFindings = validateIngestScopeTime(scope);
  if (timestampFindings.length > 0) {
    return {
      result: notCompletedIngestResult(
        timestampFindings,
        "Ingest refused to hand out a Crawl Assignment with an invalid Ingest Scope time.",
        "Record a date-time as the Ingest Scope asOf value, then plan again.",
      ),
      state: "refused",
    };
  }
  const assignment: AtlasIngestCrawlAssignment = Object.freeze({
    [crawlAssignmentBrand]: true as const,
    "crawl-assignment-schema": "1.0.0" as const,
    asOf: scope.asOf,
    attestation: scope.attestation,
    authority: scope.authority,
    entryPoint: scope.entryPoint,
    excludedPaths: scope.excludedPaths,
    includedPaths: scope.includedPaths,
    maxDepth: scope.maxDepth,
    refreshWindowDays: scope.freshnessWindowDays,
    sourceId: scope.sourceId,
  });
  const summary =
    "Crawl Assignment prepared; crawling and reconciliation have not run.";
  const result: AtlasIngestPlanResult = Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "completed",
    disposition: "success",
    operation: ingestOperationIdentity,
    payload: Object.freeze({ crawlAssignment: assignment }),
    handoff: Object.freeze({
      "operation-handoff-schema": operationHandoffSchemaVersion,
      baseSnapshot: Object.freeze({
        reason: "Planning does not read an Atlas snapshot.",
        state: "not-applicable",
      }),
      degradationState: Object.freeze({
        reason: "Planning requires no Atlas or connected Source access.",
        state: "not-degraded",
      }),
      homeAtlas: Object.freeze({
        reason: "Planning does not select an Atlas Host Directory.",
        state: "not-applicable",
      }),
      operation: ingestOperationIdentity,
      proposedChanges: Object.freeze({
        reason: "Planning produces a Crawl Assignment, not knowledge changes.",
        state: "not-applicable",
      }),
      recommendedNextAction:
        "Give payload.crawlAssignment to a read-only Crawler, then submit the returned Candidate Graph through atlas ingest reconcile.",
      result: Object.freeze({ disposition: "success", summary }),
      reviewLink: Object.freeze({
        reason: "Planning does not create an Atlas Proposal.",
        state: "not-applicable",
      }),
      unresolvedHumanDecisions: Object.freeze({
        state: "none",
        summary: "The supplied Ingest Scope Approval Attestation passed validation.",
      }),
      validationState: Object.freeze({
        findings: Object.freeze([]),
        state: "passed",
      }),
    }),
  });
  return { result, state: "assigned" };
}

// The Candidate Graph must correspond to the approved Source, not merely parse.
// A crawler that returns a graph whose Sources omit the approved sourceId is
// ingesting something other than what the human approved; that content mismatch
// is refused before any mutation. This is shape-independent correspondence.
export function validateRequestCorrespondence(
  request: AtlasIngestRequest,
): readonly Finding[] {
  const approvedPresent = request.candidateGraph.sources.some(
    (source) => source.id === request.scope.sourceId,
  );
  if (approvedPresent) return Object.freeze([]);
  return Object.freeze([
    ingestFinding(
      "ATLAS_INGEST_SOURCE_CORRESPONDENCE",
      "The returned Candidate Graph does not carry the approved Ingest Scope Source, so its content does not correspond to what a Maintainer approved.",
    ),
  ]);
}

export function correspondenceRefusalResult(
  findings: readonly Finding[],
): AtlasIngestResult {
  return notCompletedIngestResult(
    findings,
    "Ingest refused a Candidate Graph that does not correspond to the approved Source.",
    "Re-crawl the approved Source so the Candidate Graph carries it, then reconcile again.",
  );
}

export function serializeIngestMachineResult(
  result: AtlasIngestResult | AtlasIngestPlanResult,
): string {
  return `${JSON.stringify(result)}\n`;
}

export function exitCodeForIngestPlanOutcome(outcome: AtlasIngestPlanOutcome): number {
  return outcome.state === "assigned"
    ? ingestCommandExitCodes.success
    : exitCodeForIngestOperationResult(outcome.result);
}

export function exitCodeForIngestOperationResult(result: AtlasIngestResult): number {
  if (result.completion === "completed" && result.disposition === "success") {
    return ingestCommandExitCodes.success;
  }
  const codes = new Set(
    result.handoff.validationState.findings.map((finding) => finding.code),
  );
  if (
    codes.has("ATLAS_INGEST_USAGE") ||
    codes.has("ATLAS_INGEST_INPUT_INVALID") ||
    codes.has("ATLAS_INGEST_INPUT_TOO_LARGE")
  ) {
    return ingestCommandExitCodes.usage;
  }
  if (
    codes.has("ATLAS_INGEST_APPROVAL_REQUIRED") ||
    codes.has("ATLAS_INGEST_APPROVAL_EXPIRED") ||
    codes.has("ATLAS_INGEST_APPROVAL_OPERATION_MISMATCH") ||
    codes.has("ATLAS_INGEST_APPROVAL_PAYLOAD_MISMATCH")
  ) {
    return ingestCommandExitCodes.approvalRequired;
  }
  if (result.handoff.unresolvedHumanDecisions.state === "pending") {
    return ingestCommandExitCodes.scopeAwaitingApproval;
  }
  if (
    codes.has("ATLAS_INGEST_RUNTIME_FAILED") ||
    codes.has("ATLAS_INGEST_CAPTURE_FAILED")
  ) {
    return ingestCommandExitCodes.operationNotCompleted;
  }
  return ingestCommandExitCodes.operationFailed;
}
