import type { Finding } from "../domain/finding.ts";
import {
  isSourceAuthority,
  validateApproval,
  type AtlasIngestCandidateCitation,
  type AtlasIngestCandidateConcept,
  type AtlasIngestCandidateContradiction,
  type AtlasIngestCandidateEdge,
  type AtlasIngestCandidateGraph,
  type AtlasIngestCandidateSource,
  type AtlasIngestDispute,
  type AtlasIngestHandoff,
  type AtlasIngestRequest,
  type AtlasIngestResult,
  type AtlasIngestScope,
  type AtlasIngestWorkflowState,
  type SourceAuthority,
} from "../operations/ingest_operation.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
} from "../operations/operation_result.ts";

// Atlas SDK never invokes a model (docs/adr/0001-sdk-is-a-deterministic-library.md).
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
// to the approved Source. It is a VALUE with a stable code, never an exception.
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

// The Ingest Scope is only constructible through this parser, so downstream code
// derives the scope's validity from a validator rather than trusting a caller's
// assertion. Each guard is a stable refusal, never a thrown exception.
class IngestInputError extends Error {}

function asRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IngestInputError(`${path} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new IngestInputError(`${path} must be a string`);
  return value;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new IngestInputError(`${path} must be a finite number`);
  }
  return value;
}

function asStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new IngestInputError(`${path} must be an array`);
  return Object.freeze(
    (value as readonly unknown[]).map((entry, index) =>
      asString(entry, `${path}[${String(index)}]`),
    ),
  );
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new IngestInputError(`${path} must be an array`);
  return value as readonly unknown[];
}

function asSchema<Version extends string>(
  value: unknown,
  path: string,
  version: Version,
): Version {
  if (asString(value, path) !== version) {
    throw new IngestInputError(`${path} must be ${JSON.stringify(version)}`);
  }
  return version;
}

function asAuthority(value: unknown, path: string): SourceAuthority {
  const authority = asString(value, path);
  if (!isSourceAuthority(authority)) {
    throw new IngestInputError(`${path} must name a recognized Source Authority`);
  }
  return authority;
}

function parseScopeRecord(record: Readonly<Record<string, unknown>>): AtlasIngestScope {
  return Object.freeze({
    "ingest-scope-schema": asSchema(
      record["ingest-scope-schema"],
      "scope.ingest-scope-schema",
      "1.0.0",
    ),
    approvedAt: asString(record["approvedAt"], "scope.approvedAt"),
    approvedBy: asString(record["approvedBy"], "scope.approvedBy"),
    asOf: asString(record["asOf"], "scope.asOf"),
    authority: asAuthority(record["authority"], "scope.authority"),
    entryPoint: asString(record["entryPoint"], "scope.entryPoint"),
    excludedPaths: asStringArray(record["excludedPaths"], "scope.excludedPaths"),
    freshnessWindowDays: asNumber(
      record["freshnessWindowDays"],
      "scope.freshnessWindowDays",
    ),
    includedPaths: asStringArray(record["includedPaths"], "scope.includedPaths"),
    maxDepth: asNumber(record["maxDepth"], "scope.maxDepth"),
    sourceId: asString(record["sourceId"], "scope.sourceId"),
  });
}

function parseCitation(value: unknown, path: string): AtlasIngestCandidateCitation {
  const record = asRecord(value, path);
  return Object.freeze({
    sourceClaim: asString(record["sourceClaim"], `${path}.sourceClaim`),
    sourceId: asString(record["sourceId"], `${path}.sourceId`),
  });
}

function parseCitations(
  value: unknown,
  path: string,
): readonly AtlasIngestCandidateCitation[] {
  return Object.freeze(
    asArray(value, path).map((entry, index) =>
      parseCitation(entry, `${path}[${String(index)}]`),
    ),
  );
}

function parseContradiction(
  value: unknown,
  path: string,
): AtlasIngestCandidateContradiction {
  const record = asRecord(value, path);
  const contradiction: {
    acceptedBy?: string;
    atlasPolicyId?: string;
    principleTruthId?: string;
  } = {};
  if (record["acceptedBy"] !== undefined) {
    contradiction.acceptedBy = asString(record["acceptedBy"], `${path}.acceptedBy`);
  }
  if (record["atlasPolicyId"] !== undefined) {
    contradiction.atlasPolicyId = asString(
      record["atlasPolicyId"],
      `${path}.atlasPolicyId`,
    );
  }
  if (record["principleTruthId"] !== undefined) {
    contradiction.principleTruthId = asString(
      record["principleTruthId"],
      `${path}.principleTruthId`,
    );
  }
  return Object.freeze(contradiction);
}

function parseSource(value: unknown, path: string): AtlasIngestCandidateSource {
  const record = asRecord(value, path);
  return Object.freeze({
    authority: asAuthority(record["authority"], `${path}.authority`),
    content: asString(record["content"], `${path}.content`),
    id: asString(record["id"], `${path}.id`),
    locator: asString(record["locator"], `${path}.locator`),
    refreshWindowDays: asNumber(
      record["refreshWindowDays"],
      `${path}.refreshWindowDays`,
    ),
    revisionTime: asString(record["revisionTime"], `${path}.revisionTime`),
    title: asString(record["title"], `${path}.title`),
  });
}

function parseConcept(value: unknown, path: string): AtlasIngestCandidateConcept {
  const record = asRecord(value, path);
  const concept: {
    citations: readonly AtlasIngestCandidateCitation[];
    claim: string;
    contradiction?: AtlasIngestCandidateContradiction;
    id: string;
    locator: string;
    title: string;
  } = {
    citations: parseCitations(record["citations"], `${path}.citations`),
    claim: asString(record["claim"], `${path}.claim`),
    id: asString(record["id"], `${path}.id`),
    locator: asString(record["locator"], `${path}.locator`),
    title: asString(record["title"], `${path}.title`),
  };
  if (record["contradiction"] !== undefined) {
    concept.contradiction = parseContradiction(
      record["contradiction"],
      `${path}.contradiction`,
    );
  }
  return Object.freeze(concept);
}

function parseEdge(value: unknown, path: string): AtlasIngestCandidateEdge {
  const record = asRecord(value, path);
  return Object.freeze({
    citations: parseCitations(record["citations"], `${path}.citations`),
    context: asString(record["context"], `${path}.context`),
    from: asString(record["from"], `${path}.from`),
    id: asString(record["id"], `${path}.id`),
    semantics: asStringArray(record["semantics"], `${path}.semantics`),
    title: asString(record["title"], `${path}.title`),
    to: asString(record["to"], `${path}.to`),
  });
}

function parseDispute(value: unknown, path: string): AtlasIngestDispute {
  const record = asRecord(value, path);
  return Object.freeze({
    leftConceptId: asString(record["leftConceptId"], `${path}.leftConceptId`),
    rightConceptId: asString(record["rightConceptId"], `${path}.rightConceptId`),
  });
}

function parseGraph(value: unknown, path: string): AtlasIngestCandidateGraph {
  const record = asRecord(value, path);
  return Object.freeze({
    "candidate-graph-schema": asSchema(
      record["candidate-graph-schema"],
      `${path}.candidate-graph-schema`,
      "1.0.0",
    ),
    concepts: Object.freeze(
      asArray(record["concepts"], `${path}.concepts`).map((entry, index) =>
        parseConcept(entry, `${path}.concepts[${String(index)}]`),
      ),
    ),
    disputes: Object.freeze(
      asArray(record["disputes"], `${path}.disputes`).map((entry, index) =>
        parseDispute(entry, `${path}.disputes[${String(index)}]`),
      ),
    ),
    edges: Object.freeze(
      asArray(record["edges"], `${path}.edges`).map((entry, index) =>
        parseEdge(entry, `${path}.edges[${String(index)}]`),
      ),
    ),
    sources: Object.freeze(
      asArray(record["sources"], `${path}.sources`).map((entry, index) =>
        parseSource(entry, `${path}.sources[${String(index)}]`),
      ),
    ),
  });
}

export type IngestParseOutcome<Value> =
  | { readonly ok: false; readonly result: AtlasIngestResult }
  | { readonly ok: true; readonly value: Value };

// Every guard in the parsers above throws IngestInputError, so a failed parse is
// always a determinate, message-bearing refusal rather than a thrown exception
// that escapes the command.
function invalidIngestInput(error: unknown): {
  readonly ok: false;
  readonly result: AtlasIngestResult;
} {
  return {
    ok: false,
    result: invalidInputIngestOperationResult((error as IngestInputError).message),
  };
}

export function parseIngestScope(value: unknown): IngestParseOutcome<AtlasIngestScope> {
  try {
    return { ok: true, value: parseScopeRecord(asRecord(value, "scope")) };
  } catch (error: unknown) {
    return invalidIngestInput(error);
  }
}

export function parseIngestRequest(
  value: unknown,
): IngestParseOutcome<AtlasIngestRequest> {
  try {
    const record = asRecord(value, "request");
    const request: AtlasIngestRequest = Object.freeze({
      "ingest-request-schema": asSchema(
        record["ingest-request-schema"],
        "request.ingest-request-schema",
        "1.0.0",
      ),
      candidateGraph: parseGraph(record["candidateGraph"], "request.candidateGraph"),
      scope: parseScopeRecord(asRecord(record["scope"], "request.scope")),
    });
    return { ok: true, value: request };
  } catch (error: unknown) {
    return invalidIngestInput(error);
  }
}

// The Crawl Assignment the SDK hands out. The brand is a non-exported symbol, so
// a caller cannot forge an assignment that claims human approval: the only way
// to obtain one is through planCrawlAssignment, which refuses without approval.
const crawlAssignmentBrand: unique symbol = Symbol("atlas-ingest-crawl-assignment");

export interface AtlasIngestCrawlAssignment {
  readonly [crawlAssignmentBrand]: true;
  readonly "crawl-assignment-schema": "1.0.0";
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly asOf: string;
  readonly authority: SourceAuthority;
  readonly entryPoint: string;
  readonly excludedPaths: readonly string[];
  readonly includedPaths: readonly string[];
  readonly maxDepth: number;
  readonly refreshWindowDays: number;
  readonly sourceId: string;
}

export type AtlasIngestPlanOutcome =
  | { readonly result: AtlasIngestResult; readonly state: "refused" }
  | { readonly assignment: AtlasIngestCrawlAssignment; readonly state: "assigned" };

// Approval is enforced here through the same validateApproval gate the Ingest
// operation runs before it mutates, so a blank approval refuses the Crawl
// Assignment exactly as it later refuses reconciliation. The negative branch
// blocks: no assignment is constructed when approval is missing.
export function planCrawlAssignment(scope: AtlasIngestScope): AtlasIngestPlanOutcome {
  const approvalFindings = validateApproval(scope);
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
  const assignment: AtlasIngestCrawlAssignment = Object.freeze({
    [crawlAssignmentBrand]: true as const,
    "crawl-assignment-schema": "1.0.0" as const,
    approvedAt: scope.approvedAt,
    approvedBy: scope.approvedBy,
    asOf: scope.asOf,
    authority: scope.authority,
    entryPoint: scope.entryPoint,
    excludedPaths: scope.excludedPaths,
    includedPaths: scope.includedPaths,
    maxDepth: scope.maxDepth,
    refreshWindowDays: scope.freshnessWindowDays,
    sourceId: scope.sourceId,
  });
  return { assignment, state: "assigned" };
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

export function serializeCrawlAssignmentMachineResult(
  assignment: AtlasIngestCrawlAssignment,
): string {
  return `${JSON.stringify(assignment)}\n`;
}

export function serializeIngestMachineResult(result: AtlasIngestResult): string {
  return `${JSON.stringify(result)}\n`;
}

export function exitCodeForIngestPlanOutcome(outcome: AtlasIngestPlanOutcome): number {
  return outcome.state === "assigned"
    ? ingestCommandExitCodes.success
    : ingestCommandExitCodes.approvalRequired;
}

export function exitCodeForIngestOperationResult(result: AtlasIngestResult): number {
  if (result.completion === "completed" && result.disposition === "success") {
    return ingestCommandExitCodes.success;
  }
  const codes = new Set(
    result.handoff.validationState.findings.map((finding) => finding.code),
  );
  if (codes.has("ATLAS_INGEST_USAGE") || codes.has("ATLAS_INGEST_INPUT_INVALID")) {
    return ingestCommandExitCodes.usage;
  }
  if (codes.has("ATLAS_INGEST_APPROVAL_REQUIRED")) {
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
