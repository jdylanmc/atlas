import {
  resumeLocalAtlasInitialization,
  runLocalAtlasInitialization,
} from "../platform/local_atlas_initialization.ts";
import {
  initialAtlasInitializationWorkflowState,
  type AtlasInitializationResult,
} from "../operations/initialize_operation.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
} from "../operations/operation_result.ts";

export const initializeCommandUsage =
  "usage: atlas initialize --machine [--atlas-host-directory PATH] [--resume-proposal-branch NAME]";

export const initializeCommandExitCodes = Object.freeze({
  operationNotCompleted: 2,
  success: 0,
  usage: 64,
} as const);

export function runInitializeCommandOperation(
  atlasHostDirectory: string,
  resumeProposalBranch?: string,
): AtlasInitializationResult {
  if (resumeProposalBranch !== undefined) {
    return resumeLocalAtlasInitialization(atlasHostDirectory, resumeProposalBranch);
  }
  return runLocalAtlasInitialization(atlasHostDirectory);
}

export function usageInitializeOperationResult(
  message: string,
): AtlasInitializationResult {
  const operation = Object.freeze({
    kind: "initialization" as const,
    subject: "atlas-host-directory" as const,
  });
  const finding = Object.freeze({
    attribution: Object.freeze({
      checkId: "sdk-core.atlas-initialization-command",
      kind: "sdk-core" as const,
      trusted: true as const,
    }),
    code: "ATLAS_INITIALIZATION_USAGE",
    "finding-schema": "1.0.0" as const,
    message,
    path: ".atlas",
    severity: "error" as const,
  });
  const workflowState = initialAtlasInitializationWorkflowState({
    baseSnapshotDigest: "unknown",
    proposalBranch: "unknown",
    targetBranch: "unknown",
    targetHead: "unknown",
  });
  const handoff = Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: Object.freeze({
      reason: "Initialization command arguments were invalid before reading Git.",
      state: "unknown" as const,
    }),
    degradationState: Object.freeze({
      reason: "Initialization command arguments were invalid.",
      state: "not-degraded" as const,
    }),
    homeAtlas: Object.freeze({
      reason:
        "Initialization command arguments were invalid before selecting an Atlas Host Directory.",
      state: "unknown" as const,
    }),
    operation,
    proposedChanges: Object.freeze({
      reason: "Initialization command arguments were invalid.",
      state: "unknown" as const,
    }),
    recommendedNextAction: initializeCommandUsage,
    result: Object.freeze({
      disposition: "failed" as const,
      summary: "Initialization command arguments were invalid.",
    }),
    reviewLink: Object.freeze({
      reason: "Initialization did not create an Atlas Proposal.",
      state: "not-applicable" as const,
    }),
    unresolvedHumanDecisions: Object.freeze({
      state: "none" as const,
      summary: "No human decision is required to interpret this usage result.",
    }),
    validationState: Object.freeze({
      findings: Object.freeze([finding]),
      state: "not-completed" as const,
    }),
  });
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "not-completed" as const,
    disposition: "failed" as const,
    handoff,
    operation,
    payload: Object.freeze({
      state: "not-completed" as const,
      workflowState,
    }),
  });
}

export function exitCodeForInitializeOperationResult(
  result: AtlasInitializationResult,
): number {
  return result.completion === "completed" && result.disposition === "success"
    ? initializeCommandExitCodes.success
    : initializeCommandExitCodes.operationNotCompleted;
}

export function serializeInitializeMachineResult(
  result: AtlasInitializationResult,
): string {
  return `${JSON.stringify(result)}\n`;
}
