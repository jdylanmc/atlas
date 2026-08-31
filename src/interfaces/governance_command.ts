import type { Finding } from "../domain/finding.ts";
import { containsLineBreak } from "../domain/atlas_changelog.ts";
import type {
  AtlasGovernanceChange,
  AtlasGovernanceRequest,
  AtlasGovernanceResult,
  AtlasGovernanceSemanticVerdict,
  AtlasGovernanceSubject,
  AtlasGovernanceWorkflowState,
} from "../operations/governance_operation.ts";
import {
  parseApprovalAttestationRecord,
  type AtlasApprovalAttestation,
} from "../operations/operation_support.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
} from "../operations/operation_result.ts";

// Atlas SDK does not invoke a model (docs/adr/0001-sdk-is-a-deterministic-library.md).
// This command is the deterministic half of the governance seam. It accepts one
// human-authored Atlas Governance request as validated input, bounds it on every
// axis, and delegates the single deterministic maintenance workflow to the
// governance operation. No model, network, subagent dispatch, semantic judgment,
// or self-approval lives here: a Maintainer's approval and every semantic Policy
// verdict re-enter only through the request the human authored, rather than through a
// flag, default, or environment value this seam could supply on its own.

export const governCommandUsage =
  "usage: atlas govern --machine --request PATH [--atlas-host-directory PATH]";

export const governCommandExitCodes = Object.freeze({
  approvalRequired: 4,
  escalationRequired: 3,
  operationFailed: 1,
  operationNotCompleted: 2,
  semanticVerdictFailed: 5,
  success: 0,
  usage: 64,
} as const);

// Every axis a caller controls is bounded. The axis the 32-change cap controls
// is the authored governance change: the platform adapter spends two Git
// subprocesses (one `git hash-object -w`, one `git update-index`) per change,
// ~38ms per change measured on the development host. Atlas SDK derives one
// additional change — the stamped Atlas Changelog entry — so a worst-case
// proposal writes 33 changes. That derived entry is bounded too: its authored
// input is the `changelog` prose, a single line capped at maxChangelogBytes. A
// full
// worst-case proposal at this cap — 32 authored changes totaling ~790 KiB plus
// the derived Changelog, driven end to end through the command (base-snapshot
// capture, the Git subprocesses, one commit, and one whole-Atlas Lint) —
// measured ~3.3-4.0s of wall time across repeated runs; a real Principle or
// Atlas Policy proposal touches a handful of pages plus the drafted prose. Byte,
// element, and string caps below keep validation and the JSON read linear, and
// the accepted request shape is non-recursive, so nesting depth is fixed by the
// parser rather than by caller input. One caveat the caller must size for: the
// machine Operation Result echoes the derived Atlas Change Set, so worst-case
// stdout (~1.6 MiB measured) exceeds the 1 MiB input budget; a consumer reading
// the result must allow a read buffer larger than the input.
export const governCommandInputBudgets = Object.freeze({
  maxChangeContentBytes: 256 * 1024,
  maxChangelogBytes: 8192,
  maxChanges: 32,
  maxEvidencePerList: 64,
  maxFileBytes: 1024 * 1024,
  maxPathBytes: 1024,
  maxSemanticVerdicts: 32,
  maxStringBytes: 8192,
});

const governOperationIdentity = Object.freeze({
  kind: "governance" as const,
  subject: "principle" as const,
});

const placeholderWorkflowState: AtlasGovernanceWorkflowState = Object.freeze({
  "operation-workflow-schema": "1.0.0" as const,
  baseSnapshotDigest: "unknown",
  effectReceipts: Object.freeze([]),
  operationId: "unknown",
  proposalBranch: "unknown",
  targetBranch: "unknown",
  targetHead: "unknown",
});

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.atlas-governance-command",
  kind: "sdk-core" as const,
  trusted: true as const,
});

function governFinding(code: string, message: string, path = ".atlas"): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "error" as const,
  });
}

// A determinate refusal the command reaches before any mutation: bad arguments,
// input that does not type-check, or input past a declared budget. It is a
// VALUE carrying a stable code and a full versioned Operation Result, rather than a
// thrown exception or empty stdout.
function notCompletedGovernResult(
  findings: readonly Finding[],
  summary: string,
  recommendedNextAction: string,
): AtlasGovernanceResult {
  const handoff = Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: Object.freeze({
      reason: "Governance command refused before reading a base snapshot.",
      state: "unknown" as const,
    }),
    degradationState: Object.freeze({
      reason: summary,
      state: "not-degraded" as const,
    }),
    homeAtlas: Object.freeze({
      reason: "Governance command refused before selecting an Atlas Host Directory.",
      state: "unknown" as const,
    }),
    operation: governOperationIdentity,
    proposedChanges: Object.freeze({ reason: summary, state: "unknown" as const }),
    recommendedNextAction,
    result: Object.freeze({ disposition: "failed" as const, summary }),
    reviewLink: Object.freeze({
      reason: "Governance did not create an Atlas Proposal.",
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
    operation: governOperationIdentity,
    payload: Object.freeze({
      state: "not-completed" as const,
      workflowState: placeholderWorkflowState,
    }),
  });
}

export function usageGovernOperationResult(message: string): AtlasGovernanceResult {
  return notCompletedGovernResult(
    [governFinding("ATLAS_GOVERNANCE_USAGE", message)],
    "Governance command arguments were invalid.",
    governCommandUsage,
  );
}

export function invalidInputGovernOperationResult(
  message: string,
): AtlasGovernanceResult {
  return notCompletedGovernResult(
    [governFinding("ATLAS_GOVERNANCE_INPUT_INVALID", message)],
    "Governance command input did not type-check as an Atlas Governance request.",
    "Correct the typed governance request so every field matches the accepted shape, then retry.",
  );
}

export function oversizedInputGovernOperationResult(
  message: string,
): AtlasGovernanceResult {
  return notCompletedGovernResult(
    [governFinding("ATLAS_GOVERNANCE_INPUT_TOO_LARGE", message)],
    "Governance command input exceeded a declared budget before it could be read.",
    "Reduce the governance request to the supported budgets, then retry.",
  );
}

// The Atlas Governance request is only constructible through this parser, so
// downstream code derives the request's validity from a validator rather than
// trusting a caller's assertion. Each guard is a determinate refusal, rather than a
// thrown exception that escapes the command.
class GovernInputError extends Error {}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function asRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GovernInputError(`${path} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function asBoundedString(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== "string") throw new GovernInputError(`${path} must be a string`);
  if (byteLength(value) > maxBytes) {
    throw new GovernInputError(`${path} exceeds the ${String(maxBytes)} byte budget`);
  }
  return value;
}

// A single-line string: one whose bytes do not begin a new line. The drafted
// Atlas Changelog prose is rendered mid-bullet, so bounding it to one line here
// makes a forged extra Changelog heading or bullet — and thus a forged operation
// ID — unrepresentable rather than something a downstream check must strip.
function asSingleLineBoundedString(
  value: unknown,
  path: string,
  maxBytes: number,
): string {
  const text = asBoundedString(value, path, maxBytes);
  if (containsLineBreak(text)) {
    throw new GovernInputError(`${path} must be a single line`);
  }
  return text;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new GovernInputError(`${path} must be an array`);
  return value as readonly unknown[];
}

function asBoundedStringArray(
  value: unknown,
  path: string,
  maxItems: number,
): readonly string[] {
  const entries = asArray(value, path);
  if (entries.length > maxItems) {
    throw new GovernInputError(
      `${path} exceeds the ${String(maxItems)} element budget`,
    );
  }
  return Object.freeze(
    entries.map((entry, index) =>
      asBoundedString(
        entry,
        `${path}[${String(index)}]`,
        governCommandInputBudgets.maxStringBytes,
      ),
    ),
  );
}

function asSchema<Version extends string>(
  value: unknown,
  path: string,
  version: Version,
): Version {
  if (
    asBoundedString(value, path, governCommandInputBudgets.maxStringBytes) !== version
  ) {
    throw new GovernInputError(`${path} must be ${JSON.stringify(version)}`);
  }
  return version;
}

// `satisfies Record<…, true>` forces this map to list every governance action
// the operation accepts. If that union grows, this stops compiling until the new
// member is added here, so the parser does not silently reject a valid action —
// the drift a hand-copied string list would hide.
const governanceActionSet = {
  amend: true,
  create: true,
  delete: true,
  retire: true,
  verify: true,
} as const satisfies Record<AtlasGovernanceRequest["action"], true>;

function asAction(value: unknown, path: string): AtlasGovernanceRequest["action"] {
  const action = asBoundedString(value, path, governCommandInputBudgets.maxStringBytes);
  if (Object.hasOwn(governanceActionSet, action)) {
    return action as AtlasGovernanceRequest["action"];
  }
  throw new GovernInputError(`${path} must name a governance action`);
}

const governanceSubjectSet = {
  "atlas-policy": true,
  principle: true,
} as const satisfies Record<AtlasGovernanceSubject, true>;

function asSubject(value: unknown, path: string): AtlasGovernanceSubject {
  const subject = asBoundedString(
    value,
    path,
    governCommandInputBudgets.maxStringBytes,
  );
  if (Object.hasOwn(governanceSubjectSet, subject)) {
    return subject as AtlasGovernanceSubject;
  }
  throw new GovernInputError(`${path} must name a governance subject`);
}

function asVerdictOutcome(
  value: unknown,
  path: string,
): AtlasGovernanceSemanticVerdict["verdict"] {
  const verdict = asBoundedString(
    value,
    path,
    governCommandInputBudgets.maxStringBytes,
  );
  if (verdict !== "pass" && verdict !== "fail") {
    throw new GovernInputError(`${path} must be "pass" or "fail"`);
  }
  return verdict;
}

function asChallengePosition(
  value: unknown,
  path: string,
): AtlasGovernanceSemanticVerdict["challenge"]["position"] {
  const position = asBoundedString(
    value,
    path,
    governCommandInputBudgets.maxStringBytes,
  );
  if (position !== "agree" && position !== "disagree") {
    throw new GovernInputError(`${path} must be "agree" or "disagree"`);
  }
  return position;
}

function parseChange(value: unknown, path: string): AtlasGovernanceChange {
  const record = asRecord(value, path);
  return Object.freeze({
    content: asBoundedString(
      record["content"],
      `${path}.content`,
      governCommandInputBudgets.maxChangeContentBytes,
    ),
    path: asBoundedString(
      record["path"],
      `${path}.path`,
      governCommandInputBudgets.maxPathBytes,
    ),
  });
}

function parseChanges(value: unknown, path: string): readonly AtlasGovernanceChange[] {
  const changes = asArray(value, path);
  if (changes.length > governCommandInputBudgets.maxChanges) {
    throw new GovernInputError(
      `${path} exceeds the ${String(
        governCommandInputBudgets.maxChanges,
      )} change budget`,
    );
  }
  return Object.freeze(
    changes.map((entry, index) => parseChange(entry, `${path}[${String(index)}]`)),
  );
}

function parseSemanticVerdict(
  value: unknown,
  path: string,
): AtlasGovernanceSemanticVerdict {
  const record = asRecord(value, path);
  const challenge = asRecord(record["challenge"], `${path}.challenge`);
  return Object.freeze({
    challenge: Object.freeze({
      argument: asBoundedString(
        challenge["argument"],
        `${path}.challenge.argument`,
        governCommandInputBudgets.maxStringBytes,
      ),
      evidence: asBoundedStringArray(
        challenge["evidence"],
        `${path}.challenge.evidence`,
        governCommandInputBudgets.maxEvidencePerList,
      ),
      position: asChallengePosition(
        challenge["position"],
        `${path}.challenge.position`,
      ),
    }),
    evidence: asBoundedStringArray(
      record["evidence"],
      `${path}.evidence`,
      governCommandInputBudgets.maxEvidencePerList,
    ),
    policyId: asBoundedString(
      record["policyId"],
      `${path}.policyId`,
      governCommandInputBudgets.maxStringBytes,
    ),
    verdict: asVerdictOutcome(record["verdict"], `${path}.verdict`),
  });
}

interface MutableGovernanceRequest {
  "governance-request-schema": "1.0.0";
  action: AtlasGovernanceRequest["action"];
  attestation?: AtlasApprovalAttestation;
  changelog?: string;
  changes?: readonly AtlasGovernanceChange[];
  semanticVerdicts?: readonly AtlasGovernanceSemanticVerdict[];
  subject: AtlasGovernanceSubject;
}

function asAttestation(value: unknown, path: string): AtlasApprovalAttestation {
  const budget = governCommandInputBudgets.maxStringBytes;
  return parseApprovalAttestationRecord(
    asRecord(value, path),
    path,
    (fieldValue, fieldPath) => asBoundedString(fieldValue, fieldPath, budget),
  );
}

function parseRequestRecord(
  record: Readonly<Record<string, unknown>>,
): AtlasGovernanceRequest {
  const request: MutableGovernanceRequest = {
    "governance-request-schema": asSchema(
      record["governance-request-schema"],
      "request.governance-request-schema",
      "1.0.0",
    ),
    action: asAction(record["action"], "request.action"),
    subject: asSubject(record["subject"], "request.subject"),
  };
  // Approval is read ONLY from the human-authored request. There is no flag,
  // default, or environment value that supplies it, so the seam does not
  // self-approve a Principle or Atlas Policy on an agent's behalf.
  if (record["attestation"] !== undefined) {
    request.attestation = asAttestation(record["attestation"], "request.attestation");
  }
  if (record["changelog"] !== undefined) {
    request.changelog = asSingleLineBoundedString(
      record["changelog"],
      "request.changelog",
      governCommandInputBudgets.maxChangelogBytes,
    );
  }
  if (record["changes"] !== undefined) {
    request.changes = parseChanges(record["changes"], "request.changes");
  }
  if (record["semanticVerdicts"] !== undefined) {
    const verdicts = asArray(record["semanticVerdicts"], "request.semanticVerdicts");
    if (verdicts.length > governCommandInputBudgets.maxSemanticVerdicts) {
      throw new GovernInputError(
        `request.semanticVerdicts exceeds the ${String(
          governCommandInputBudgets.maxSemanticVerdicts,
        )} verdict budget`,
      );
    }
    request.semanticVerdicts = Object.freeze(
      verdicts.map((entry, index) =>
        parseSemanticVerdict(entry, `request.semanticVerdicts[${String(index)}]`),
      ),
    );
  }
  return Object.freeze(request);
}

export type GovernParseOutcome =
  | { readonly ok: false; readonly result: AtlasGovernanceResult }
  | { readonly ok: true; readonly value: AtlasGovernanceRequest };

// Every guard above throws GovernInputError, so a failed parse yields a
// determinate, message-bearing refusal rather than an exception that escapes.
export function parseGovernRequest(value: unknown): GovernParseOutcome {
  try {
    return { ok: true, value: parseRequestRecord(asRecord(value, "request")) };
  } catch (error: unknown) {
    return {
      ok: false,
      result: invalidInputGovernOperationResult((error as GovernInputError).message),
    };
  }
}

export function serializeGovernMachineResult(result: AtlasGovernanceResult): string {
  return `${JSON.stringify(result)}\n`;
}

export function exitCodeForGovernOperationResult(
  result: AtlasGovernanceResult,
): number {
  if (result.completion === "completed" && result.disposition === "success") {
    return governCommandExitCodes.success;
  }
  const codes = new Set(
    result.handoff.validationState.findings.map((entry) => entry.code),
  );
  if (
    codes.has("ATLAS_GOVERNANCE_USAGE") ||
    codes.has("ATLAS_GOVERNANCE_INPUT_INVALID") ||
    codes.has("ATLAS_GOVERNANCE_INPUT_TOO_LARGE")
  ) {
    return governCommandExitCodes.usage;
  }
  if (
    codes.has("ATLAS_GOVERNANCE_APPROVAL_REQUIRED") ||
    codes.has("ATLAS_GOVERNANCE_APPROVAL_EXPIRED") ||
    codes.has("ATLAS_GOVERNANCE_APPROVAL_OPERATION_MISMATCH") ||
    codes.has("ATLAS_GOVERNANCE_APPROVAL_PAYLOAD_MISMATCH")
  ) {
    return governCommandExitCodes.approvalRequired;
  }
  if (codes.has("ATLAS_GOVERNANCE_SEMANTIC_VERDICT_FAILED")) {
    return governCommandExitCodes.semanticVerdictFailed;
  }
  if (result.handoff.unresolvedHumanDecisions.state === "pending") {
    return governCommandExitCodes.escalationRequired;
  }
  if (
    codes.has("ATLAS_GOVERNANCE_RUNTIME_FAILED") ||
    codes.has("ATLAS_GOVERNANCE_CAPTURE_FAILED")
  ) {
    return governCommandExitCodes.operationNotCompleted;
  }
  return governCommandExitCodes.operationFailed;
}
