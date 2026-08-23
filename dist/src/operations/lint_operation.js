import { lintAtlas } from "../lint/lint_atlas.js";
import { operationHandoffSchemaVersion, operationResultSchemaVersion, } from "./operation_result.js";
const completedLintOperationPayloadBrand = Symbol("completed-lint-operation-payload");
const capturedHomeAtlasLintOperation = Object.freeze({
    kind: "lint",
    subject: "captured-home-atlas",
});
const noProposedChanges = Object.freeze({
    reason: "Lint is read-only and proposes no Atlas Change Set.",
    state: "not-applicable",
});
const noReviewLink = Object.freeze({
    reason: "Lint did not create an Atlas Proposal.",
    state: "not-applicable",
});
const noHumanDecisions = Object.freeze({
    state: "none",
    summary: "No human decision is required to interpret this Lint result.",
});
const commandAttribution = Object.freeze({
    checkId: "sdk-core.atlas-lint-command",
    kind: "sdk-core",
    trusted: true,
});
const unknownHomeAtlas = Object.freeze({
    reason: "Lint received captured Atlas files without a resolved Atlas Locator.",
    state: "unknown",
});
const unknownBaseSnapshot = Object.freeze({
    reason: "Lint received captured Atlas files without a Git-backed Atlas Snapshot.",
    state: "unknown",
});
function lintOperation(subject) {
    return Object.freeze({ kind: "lint", subject });
}
function commandFinding(code, message) {
    return Object.freeze({
        attribution: commandAttribution,
        code,
        "finding-schema": "1.0.0",
        message,
        path: ".atlas",
        severity: "error",
    });
}
function completedLintHandoff(lint) {
    const success = lint.outcome === "valid";
    return Object.freeze({
        "operation-handoff-schema": operationHandoffSchemaVersion,
        baseSnapshot: unknownBaseSnapshot,
        degradationState: Object.freeze({
            reason: "The operation completed through deterministic Lint.",
            state: "not-degraded",
        }),
        homeAtlas: unknownHomeAtlas,
        operation: capturedHomeAtlasLintOperation,
        proposedChanges: noProposedChanges,
        recommendedNextAction: success
            ? "Use the validated Atlas records returned by Lint."
            : "Resolve the reported Findings, then run Lint again.",
        result: Object.freeze({
            disposition: success ? "success" : "failed",
            summary: success ? "Lint passed." : "Lint reported error Findings.",
        }),
        reviewLink: noReviewLink,
        unresolvedHumanDecisions: noHumanDecisions,
        validationState: Object.freeze({
            findings: lint.findings,
            state: success ? "passed" : "failed",
        }),
    });
}
function didLintRuntimeFail(lint) {
    return lint.findings.some((finding) => finding.code === "ATLAS_LINT_FAILED" ||
        finding.code === "ATLAS_CAPTURE_UNREADABLE");
}
export function notCompletedLintOperationResult(input) {
    const findings = Object.freeze([commandFinding(input.code, input.message)]);
    const operation = lintOperation(input.subject);
    const handoff = Object.freeze({
        "operation-handoff-schema": operationHandoffSchemaVersion,
        baseSnapshot: Object.freeze({
            reason: input.baseSnapshotReason,
            state: "unknown",
        }),
        degradationState: Object.freeze({
            reason: input.degradationReason ?? input.summary,
            state: input.code === "ATLAS_LINT_ATLAS_NOT_FOUND" || input.code === "ATLAS_LINT_USAGE"
                ? "not-degraded"
                : "degraded",
        }),
        homeAtlas: Object.freeze({
            reason: input.homeAtlasReason,
            state: "unknown",
        }),
        operation,
        proposedChanges: noProposedChanges,
        recommendedNextAction: input.recommendedNextAction,
        result: Object.freeze({
            disposition: "failed",
            summary: input.summary,
        }),
        reviewLink: noReviewLink,
        unresolvedHumanDecisions: noHumanDecisions,
        validationState: Object.freeze({
            findings,
            state: "not-completed",
        }),
    });
    return Object.freeze({
        "operation-result-schema": operationResultSchemaVersion,
        completion: "not-completed",
        disposition: "failed",
        handoff,
        operation,
        payload: Object.freeze({ findings, state: "not-completed" }),
    });
}
function runtimeFailureResult(lint) {
    const finding = lint.findings[0];
    return notCompletedLintOperationResult({
        baseSnapshotReason: "Lint could not complete against the captured Atlas files.",
        code: finding.code,
        degradationReason: "Lint could not complete because the program running it failed.",
        homeAtlasReason: "Lint could not complete against the captured Atlas files.",
        message: finding.message,
        recommendedNextAction: "Retry Lint in a healthy runtime; if it repeats, escalate the operation failure.",
        subject: "captured-home-atlas",
        summary: "Lint did not complete.",
    });
}
export function runLintOperation(capturedFiles, budgets) {
    const lint = lintAtlas(capturedFiles, budgets);
    if (didLintRuntimeFail(lint))
        return runtimeFailureResult(lint);
    const handoff = completedLintHandoff(lint);
    return Object.freeze({
        "operation-result-schema": operationResultSchemaVersion,
        completion: "completed",
        disposition: handoff.result.disposition,
        handoff,
        operation: capturedHomeAtlasLintOperation,
        payload: Object.freeze({
            [completedLintOperationPayloadBrand]: true,
            lint,
            state: "completed",
        }),
    });
}
