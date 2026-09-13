import type { Finding } from "../domain/finding.ts";
import { governanceInput } from "./command_input_contracts.ts";
import { readInput } from "./input_contract.ts";
export { governCommandInputBudgets } from "./command_input_contracts.ts";
import type {
  AtlasGovernanceRequest,
  AtlasGovernanceResult,
  AtlasGovernanceSubject,
  AtlasGovernanceWorkflowState,
} from "../operations/governance_operation.ts";
import { governanceApprovalRequiredFindings } from "../operations/governance_operation.ts";
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
  subject: AtlasGovernanceSubject = "principle",
): AtlasGovernanceResult {
  const governOperationIdentity = Object.freeze({
    kind: "governance" as const,
    subject,
  });
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

export type GovernParseOutcome =
  | { readonly ok: false; readonly result: AtlasGovernanceResult }
  | { readonly ok: true; readonly value: AtlasGovernanceRequest };

export function parseGovernRequest(value: unknown): GovernParseOutcome {
  const parsed = readInput(governanceInput, value, "request");
  if (parsed.ok) return parsed;
  const missingApproval = (issue: (typeof parsed.issues)[number]) =>
    issue.rule === "required" && issue.path === "request.attestation";
  const shapeIssues = parsed.issues.filter((issue) => !missingApproval(issue));
  const findings: Finding[] = [];
  if (shapeIssues.length > 0) {
    findings.push(
      governFinding(
        "ATLAS_GOVERNANCE_INPUT_INVALID",
        shapeIssues.map((issue) => issue.message).join("\n"),
      ),
    );
  }
  if (parsed.issues.some(missingApproval)) {
    findings.push(...governanceApprovalRequiredFindings());
  }
  const subject =
    typeof value === "object" &&
    value !== null &&
    "subject" in value &&
    value.subject === "atlas-policy"
      ? "atlas-policy"
      : "principle";
  return {
    ok: false,
    result: notCompletedGovernResult(
      findings,
      "Governance input was refused before reading a base snapshot.",
      "Correct the reported fields and obtain any required Maintainer Approval Attestation, then retry.",
      subject,
    ),
  };
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
