import { lexicalSearchProvider } from "../graph/lexical_search_provider.js";
import { exploreAtlas, } from "../graph/explore_atlas.js";
import { buildAtlasView } from "../atlas/atlas_view.js";
import { loadAndValidateAtlasInput } from "../lint/validate_atlas_input.js";
import { operationHandoffSchemaVersion, operationResultSchemaVersion, } from "./operation_result.js";
const exploreOperation = Object.freeze({
    kind: "explore",
    subject: "local-home-atlas",
});
const noProposedChanges = Object.freeze({
    reason: "Explore is read-only and proposes no Atlas Change Set.",
    state: "not-applicable",
});
const noReviewLink = Object.freeze({
    reason: "Explore did not create an Atlas Proposal.",
    state: "not-applicable",
});
const defaultBudgetValues = Object.freeze({
    maxContextCharacters: 4096,
    maxEdges: 2048,
    maxFileBytes: 1024 * 1024,
    maxObjects: 2048,
    maxQueryCharacters: 1024,
    maxResults: 5,
    maxRouteEdges: 32,
    maxTerms: 128,
    maxTotalBytes: 16 * 1024 * 1024,
});
function budgetsOf(request) {
    return Object.freeze({
        ...defaultBudgetValues,
        ...request.budgets,
    });
}
function handoff(request, payload) {
    const blocked = payload.degradation.level === "blocked";
    const degraded = payload.degradation.level !== "valid-structured";
    const validationFailed = payload.degradation.diagnostics.some((finding) => finding.severity === "error");
    const succeeded = !blocked && !validationFailed && payload.results.length > 0;
    return Object.freeze({
        "operation-handoff-schema": operationHandoffSchemaVersion,
        baseSnapshot: request.baseSnapshot,
        degradationState: degraded
            ? Object.freeze({
                reason: `Explore completed at degradation level ${payload.degradation.level}.`,
                state: "degraded",
            })
            : Object.freeze({
                reason: "Explore used valid structured Atlas objects.",
                state: "not-degraded",
            }),
        homeAtlas: request.homeAtlas,
        operation: exploreOperation,
        proposedChanges: noProposedChanges,
        recommendedNextAction: payload.degradation.remediation ??
            (succeeded
                ? "Use the returned route, Re-anchoring record, and cited context."
                : "Refine the Explore request or add reachable Atlas knowledge."),
        result: Object.freeze({
            disposition: succeeded ? "success" : "failed",
            summary: succeeded
                ? "Explore returned reachable Atlas context."
                : blocked
                    ? "Explore could not load usable Atlas material."
                    : "Explore found no reachable result.",
        }),
        reviewLink: noReviewLink,
        unresolvedHumanDecisions: Object.freeze({
            state: "none",
            summary: "No human decision is required to interpret this Explore result.",
        }),
        validationState: Object.freeze({
            findings: payload.degradation.diagnostics,
            state: blocked
                ? "not-completed"
                : payload.degradation.diagnostics.length === 0
                    ? "passed"
                    : "failed",
        }),
    });
}
function captureFailureFinding(reason) {
    return Object.freeze({
        attribution: Object.freeze({
            checkId: "sdk-core.explore-snapshot-capture",
            kind: "sdk-core",
            trusted: true,
        }),
        code: "ATLAS_EXPLORE_SNAPSHOT_CAPTURE_FAILED",
        "finding-schema": "1.0.0",
        message: reason,
        path: ".atlas",
        severity: "error",
    });
}
function blockedCapturePayload(reason) {
    return Object.freeze({
        degradation: Object.freeze({
            diagnostics: Object.freeze([captureFailureFinding(reason)]),
            level: "blocked",
            remediation: "Capture a readable Git-backed Home Atlas Snapshot, then run Explore again.",
        }),
        reanchors: Object.freeze([]),
        results: Object.freeze([]),
    });
}
export function runExploreOperation(request) {
    const budgets = budgetsOf(request);
    const validated = loadAndValidateAtlasInput(request.capturedFiles, budgets);
    const atlasView = buildAtlasView({
        identity: Object.freeze({
            atlas: request.homeAtlas,
            role: "home",
            slug: "local-home-atlas",
            snapshot: request.baseSnapshot,
        }),
        validation: validated,
    });
    const payload = exploreAtlas(atlasView, request.query, request.provider ?? lexicalSearchProvider, budgets);
    const operationHandoff = handoff(request, payload);
    return Object.freeze({
        "operation-result-schema": operationResultSchemaVersion,
        completion: operationHandoff.validationState.state === "not-completed"
            ? "not-completed"
            : "completed",
        disposition: operationHandoff.result.disposition,
        handoff: operationHandoff,
        operation: exploreOperation,
        payload,
    });
}
export function runExploreOperationFromSnapshotCapture(capture, options) {
    if (capture.state === "failed") {
        const payload = blockedCapturePayload(capture.reason);
        const operationHandoff = handoff({
            baseSnapshot: Object.freeze({
                reason: "Explore could not capture an Atlas Snapshot.",
                state: "unknown",
            }),
            capturedFiles: Object.freeze([]),
            homeAtlas: Object.freeze({
                reason: "Explore could not capture the Home Atlas.",
                state: "unknown",
            }),
            query: options.query,
        }, payload);
        return Object.freeze({
            "operation-result-schema": operationResultSchemaVersion,
            completion: "not-completed",
            disposition: operationHandoff.result.disposition,
            handoff: operationHandoff,
            operation: exploreOperation,
            payload,
        });
    }
    return runExploreOperation({
        ...capture.snapshot,
        ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        query: options.query,
    });
}
