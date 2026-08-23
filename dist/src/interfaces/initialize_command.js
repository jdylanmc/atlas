import { resumeLocalAtlasInitialization, runLocalAtlasInitialization, } from "../platform/local_atlas_initialization.js";
import { initialAtlasInitializationWorkflowState, } from "../operations/initialize_operation.js";
import { operationHandoffSchemaVersion, operationResultSchemaVersion, } from "../operations/operation_result.js";
export const initializeCommandUsage = "usage: atlas initialize --machine [--atlas-host-directory PATH] [--resume-proposal-branch NAME]";
export const initializeCommandExitCodes = Object.freeze({
    operationNotCompleted: 2,
    success: 0,
    usage: 64,
});
export function runInitializeCommandOperation(atlasHostDirectory, resumeProposalBranch) {
    if (resumeProposalBranch !== undefined) {
        return resumeLocalAtlasInitialization(atlasHostDirectory, resumeProposalBranch);
    }
    return runLocalAtlasInitialization(atlasHostDirectory);
}
export function usageInitializeOperationResult(message) {
    const operation = Object.freeze({
        kind: "initialization",
        subject: "atlas-host-directory",
    });
    const finding = Object.freeze({
        attribution: Object.freeze({
            checkId: "sdk-core.atlas-initialization-command",
            kind: "sdk-core",
            trusted: true,
        }),
        code: "ATLAS_INITIALIZATION_USAGE",
        "finding-schema": "1.0.0",
        message,
        path: ".atlas",
        severity: "error",
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
            state: "unknown",
        }),
        degradationState: Object.freeze({
            reason: "Initialization command arguments were invalid.",
            state: "not-degraded",
        }),
        homeAtlas: Object.freeze({
            reason: "Initialization command arguments were invalid before selecting an Atlas Host Directory.",
            state: "unknown",
        }),
        operation,
        proposedChanges: Object.freeze({
            reason: "Initialization command arguments were invalid.",
            state: "unknown",
        }),
        recommendedNextAction: initializeCommandUsage,
        result: Object.freeze({
            disposition: "failed",
            summary: "Initialization command arguments were invalid.",
        }),
        reviewLink: Object.freeze({
            reason: "Initialization did not create an Atlas Proposal.",
            state: "not-applicable",
        }),
        unresolvedHumanDecisions: Object.freeze({
            state: "none",
            summary: "No human decision is required to interpret this usage result.",
        }),
        validationState: Object.freeze({
            findings: Object.freeze([finding]),
            state: "not-completed",
        }),
    });
    return Object.freeze({
        "operation-result-schema": operationResultSchemaVersion,
        completion: "not-completed",
        disposition: "failed",
        handoff,
        operation,
        payload: Object.freeze({
            state: "not-completed",
            workflowState,
        }),
    });
}
export function exitCodeForInitializeOperationResult(result) {
    return result.completion === "completed" && result.disposition === "success"
        ? initializeCommandExitCodes.success
        : initializeCommandExitCodes.operationNotCompleted;
}
export function serializeInitializeMachineResult(result) {
    return `${JSON.stringify(result)}\n`;
}
