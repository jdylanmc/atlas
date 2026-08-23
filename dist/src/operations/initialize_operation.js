import { isSafeGitBranchName as isSafeGitBranchNameShared } from "./operation_support.js";
import { operationHandoffSchemaVersion, operationResultSchemaVersion, } from "./operation_result.js";
const lintStampBrand = Symbol("lint-stamp");
const successfulProposalLintBrand = Symbol("successful-proposal-lint");
const initializationOperation = Object.freeze({
    kind: "initialization",
    subject: "atlas-host-directory",
});
const commandAttribution = Object.freeze({
    checkId: "sdk-core.atlas-initialization",
    kind: "sdk-core",
    trusted: true,
});
const noReviewLink = Object.freeze({
    reason: "Forge publication was not requested; the Atlas Proposal remains local.",
    state: "not-applicable",
});
function finding(code, message) {
    return Object.freeze({
        attribution: commandAttribution,
        code,
        "finding-schema": "1.0.0",
        message,
        path: ".atlas",
        severity: "error",
    });
}
function receiptFor(state, effect) {
    return state.effectReceipts.find((receipt) => receipt.effect === effect);
}
function addReceipt(state, receipt) {
    return Object.freeze({
        ...state,
        effectReceipts: Object.freeze([...state.effectReceipts, receipt]),
    });
}
function handoff(state, disposition, completion, findings, summary) {
    return Object.freeze({
        "operation-handoff-schema": operationHandoffSchemaVersion,
        baseSnapshot: Object.freeze({
            reference: state.targetHead,
            state: "known",
        }),
        degradationState: Object.freeze({
            reason: findings.length === 0
                ? "Initialization completed without degraded dependencies."
                : summary,
            state: findings.length === 0 ? "not-degraded" : "degraded",
        }),
        homeAtlas: Object.freeze({
            reason: "Initialization proposes the first Home Atlas; it is not merged yet.",
            state: "not-applicable",
        }),
        operation: initializationOperation,
        proposedChanges: completion === "completed"
            ? Object.freeze({
                state: "available",
                summary: `Local Atlas Proposal branch ${state.proposalBranch} contains the minimal Atlas Change Set.`,
            })
            : Object.freeze({
                reason: summary,
                state: "unknown",
            }),
        recommendedNextAction: completion === "completed"
            ? "Review the local Atlas Proposal and publish it to the forge when ready."
            : "Refresh the base snapshot, then resume Initialization from the typed workflow state.",
        result: Object.freeze({ disposition, summary }),
        reviewLink: noReviewLink,
        unresolvedHumanDecisions: Object.freeze({
            state: "none",
            summary: "Minimal Initialization chose no Guide Persona, founding knowledge, site, or forge publication.",
        }),
        validationState: Object.freeze({
            findings,
            state: completion === "completed" ? "passed" : "not-completed",
        }),
    });
}
function result(state, completion, disposition, payload, findings, summary) {
    const operationHandoff = handoff(state, disposition, completion, findings, summary);
    return Object.freeze({
        "operation-result-schema": operationResultSchemaVersion,
        completion,
        disposition,
        handoff: operationHandoff,
        operation: initializationOperation,
        payload: Object.freeze({ ...payload, state: completion, workflowState: state }),
    });
}
function minimalAtlasChangeSet(state) {
    const rootAnchor = `---\nsdk:\n  atlas-sdk-schema: 1.0.0\n  created-at: "2026-01-01T00:00:00Z"\n  created-by:\n    kind: agent\n    name: Atlas SDK\n  id: anchor:root\n  local-atlas-schema: 1.0.0\n  originating-operation: atlas-initialization\n  tags: []\n  title: Home Atlas\n  type: anchor\n  updated-at: "2026-01-01T00:00:00Z"\n  updated-by:\n    kind: agent\n    name: Atlas SDK\natlas: {}\n---\n\n# Home Atlas\n\nThis Root Anchor starts a minimal Home Atlas with no Guide Persona, founding knowledge, or Atlas Site.\n`;
    return Object.freeze({
        baseSnapshotDigest: state.baseSnapshotDigest,
        changes: Object.freeze([
            Object.freeze({
                content: "# Changelog\n\n- Initialized minimal Home Atlas.\n",
                path: ".atlas/CHANGELOG.md",
            }),
            Object.freeze({
                content: "# Framework\n\nThis Atlas is initialized from the source Framework Bundle.\n",
                path: [".atlas", "framework", "README.md"].join("/"),
            }),
            Object.freeze({ content: rootAnchor, path: ".atlas/index.md" }),
        ]),
        targetHead: state.targetHead,
    });
}
export function initialAtlasInitializationWorkflowState(input) {
    return Object.freeze({
        "operation-workflow-schema": "1.0.0",
        baseSnapshotDigest: input.baseSnapshotDigest,
        effectReceipts: Object.freeze([]),
        proposalBranch: input.proposalBranch,
        targetBranch: input.targetBranch,
        targetHead: input.targetHead,
    });
}
export function notCompletedAtlasInitializationResult(input) {
    const workflowState = input.workflowState ??
        initialAtlasInitializationWorkflowState({
            baseSnapshotDigest: "unknown",
            proposalBranch: "unknown",
            targetBranch: "unknown",
            targetHead: "unknown",
        });
    const findings = Object.freeze([finding(input.code, input.message)]);
    const operationHandoff = handoff(workflowState, "failed", "not-completed", findings, input.summary);
    return Object.freeze({
        "operation-result-schema": operationResultSchemaVersion,
        completion: "not-completed",
        disposition: "failed",
        handoff: Object.freeze({
            ...operationHandoff,
            recommendedNextAction: input.recommendedNextAction,
        }),
        operation: initializationOperation,
        payload: Object.freeze({
            state: "not-completed",
            workflowState,
        }),
    });
}
export function validateAtlasInitializationChangeSet(state, changeSet) {
    const findings = [];
    if (changeSet.targetHead !== state.targetHead ||
        changeSet.baseSnapshotDigest !== state.baseSnapshotDigest) {
        findings.push(finding("ATLAS_INITIALIZATION_CHANGE_SET_STALE", "Atlas Change Set base does not match the current base snapshot."));
    }
    for (const change of changeSet.changes) {
        if (!change.path.startsWith(".atlas/") ||
            change.path.includes("..") ||
            change.path.startsWith("/") ||
            change.path.includes("\\")) {
            findings.push(finding("ATLAS_INITIALIZATION_CHANGE_SET_PATH_INVALID", "Atlas Change Set may write only canonical .atlas paths."));
        }
    }
    return Object.freeze(findings);
}
function isSuccessfulCompletedLint(lint) {
    return (lint.completion === "completed" &&
        lint.disposition === "success" &&
        lint.payload.state === "completed" &&
        lint.payload.lint.outcome === "valid");
}
function successfulProposalLint(input) {
    if (!isSuccessfulCompletedLint(input.lint)) {
        return finding("ATLAS_INITIALIZATION_LINT_STAMP_UNPROVEN", "Atlas Initialization refused to stamp a proposal without a successful completed Lint.");
    }
    if (input.evidenceRevision !== input.atlasCommit) {
        return finding("ATLAS_INITIALIZATION_LINT_STAMP_STALE", "Atlas Initialization refused to stamp a proposal commit different from the Lint evidence commit.");
    }
    return Object.freeze({
        [successfulProposalLintBrand]: true,
        atlasCommit: input.atlasCommit,
        evidenceRevision: input.evidenceRevision,
        lint: input.lint,
    });
}
function completedReport(evidence) {
    const lintStamp = Object.freeze({
        [lintStampBrand]: true,
        "lint-stamp-schema": "1.0.0",
        atlasCommit: evidence.atlasCommit,
        evidenceRevision: evidence.evidenceRevision,
    });
    return Object.freeze({
        boundary: "The Home Atlas boundary is the repository root Atlas Host Directory.",
        degradation: "No degraded dependency was needed for local, non-forge Initialization.",
        evidence: "No founding knowledge was imported; Lint evidence is the proposal commit snapshot.",
        foundingGraph: "None: minimal Initialization imports no founding knowledge.",
        governance: "The minimal Atlas proposes no Atlas Manifest; human-authored declaration is pending review.",
        guide: "None: minimal Initialization records no Guide Persona.",
        integration: "The Operation Workspace produced a local proposal branch and no forge publication.",
        lintStamp,
        nextAction: "Review and publish the local proposal branch, then merge through Git governance.",
        publicationHandoff: "Forge publication was not requested; push the proposal branch and open a pull request with the readiness report.",
        uninspectedAreas: "No external sources, tracked Atlases, forge remotes, Atlas Site, or governance policies were inspected.",
    });
}
export function atlasInitializationFiles(state) {
    const encoder = new TextEncoder();
    return minimalAtlasChangeSet(state).changes.map((change) => Object.freeze({ bytes: encoder.encode(change.content), path: change.path }));
}
export const isSafeGitBranchName = isSafeGitBranchNameShared;
export function runAtlasInitializationWorkflow(state, runtime) {
    let latestState = state;
    try {
        if (!isSafeGitBranchName(state.proposalBranch) ||
            !isSafeGitBranchName(state.targetBranch)) {
            const findings = Object.freeze([
                finding("ATLAS_INITIALIZATION_WORKFLOW_STATE_INVALID", "Atlas Initialization workflow state names an unsafe branch."),
            ]);
            return result(latestState, "not-completed", "failed", {}, findings, "Initialization refused unsafe workflow state before mutating.");
        }
        if (runtime.currentTargetHead() !== state.targetHead ||
            runtime.currentBaseSnapshotDigest() !== state.baseSnapshotDigest) {
            const findings = Object.freeze([
                finding("ATLAS_INITIALIZATION_BASE_SNAPSHOT_STALE", "Atlas Initialization refused stale mutation because the target branch or base snapshot digest changed."),
            ]);
            return result(latestState, "not-completed", "failed", {}, findings, "Initialization requires a refreshed base snapshot before mutating.");
        }
        let nextState = state;
        if (receiptFor(nextState, "create-proposal-worktree") === undefined &&
            runtime.workspaceExists?.() === true) {
            return notCompletedAtlasInitializationResult({
                code: "ATLAS_INITIALIZATION_WORKSPACE_EXISTS",
                message: "Atlas Initialization found an existing proposal branch or Operation Workspace before creating a new proposal.",
                recommendedNextAction: "Resume with --resume-proposal-branch for the existing proposal, or explicitly discard it after saving any review work.",
                summary: "Initialization refused to overwrite an existing Operation Workspace.",
                workflowState: nextState,
            });
        }
        if (receiptFor(nextState, "create-proposal-worktree") === undefined &&
            runtime.workspacePathValid?.() === false) {
            return notCompletedAtlasInitializationResult({
                code: "ATLAS_INITIALIZATION_WORKSPACE_PATH_INVALID",
                message: "Atlas Initialization refused an Operation Workspace path that escapes the Atlas Host Directory.",
                recommendedNextAction: "Remove symlinks from the Operation Workspace path, then retry Initialization from a clean Git worktree.",
                summary: "Initialization refused to create an Operation Workspace outside the Atlas Host Directory.",
                workflowState: nextState,
            });
        }
        if (receiptFor(nextState, "create-proposal-worktree") === undefined) {
            const created = runtime.createProposalWorktree();
            nextState = addReceipt(nextState, {
                effect: "create-proposal-worktree",
                receipt: created.receipt,
            });
            latestState = nextState;
            runtime.persistState?.(nextState);
        }
        const changeSet = runtime.changeSet?.(nextState) ?? minimalAtlasChangeSet(nextState);
        const changeSetFindings = validateAtlasInitializationChangeSet(nextState, changeSet);
        if (changeSetFindings.length > 0) {
            return result(nextState, "not-completed", "failed", { changeSet }, changeSetFindings, "Initialization refused an invalid Atlas Change Set.");
        }
        if (receiptFor(nextState, "write-change-set") === undefined) {
            const written = runtime.writeChangeSet(changeSet);
            nextState = addReceipt(nextState, {
                effect: "write-change-set",
                receipt: written.receipt,
            });
            latestState = nextState;
            runtime.persistState?.(nextState);
        }
        let commit = receiptFor(nextState, "commit-proposal")?.receipt;
        if (commit === undefined) {
            const committed = runtime.commitProposal();
            commit = committed.commit;
            nextState = addReceipt(nextState, {
                effect: "commit-proposal",
                receipt: committed.receipt,
            });
            latestState = nextState;
            runtime.persistState?.(nextState);
        }
        let lint;
        let lintReceipt = receiptFor(nextState, "lint-proposal")?.receipt;
        if (receiptFor(nextState, "lint-proposal") === undefined) {
            const linted = runtime.lintProposal();
            lint = linted.lint;
            lintReceipt = linted.receipt;
            nextState = addReceipt(nextState, {
                effect: "lint-proposal",
                receipt: linted.receipt,
            });
            latestState = nextState;
            runtime.persistState?.(nextState);
        }
        else {
            const linted = runtime.lintProposal();
            lint = linted.lint;
            lintReceipt = linted.receipt;
        }
        const stampEvidence = successfulProposalLint({
            atlasCommit: commit,
            evidenceRevision: lintReceipt,
            lint,
        });
        if ("code" in stampEvidence) {
            return result(nextState, "not-completed", "failed", { changeSet, lint }, stampEvidence.code === "ATLAS_INITIALIZATION_LINT_STAMP_UNPROVEN"
                ? lint.handoff.validationState.findings
                : Object.freeze([stampEvidence]), stampEvidence.code === "ATLAS_INITIALIZATION_LINT_STAMP_UNPROVEN"
                ? "Initialization proposal did not pass trusted Lint."
                : "Initialization refused a stale Lint Stamp.");
        }
        return result(nextState, "completed", "success", { atlasReadinessReport: completedReport(stampEvidence), changeSet, lint }, Object.freeze([]), "Initialization produced a Linted local Atlas Proposal.");
    }
    catch {
        const findings = Object.freeze([
            finding("ATLAS_INITIALIZATION_RUNTIME_FAILED", "Atlas Initialization runtime failed before the operation completed."),
        ]);
        return result(latestState, "not-completed", "failed", {}, findings, "Initialization did not complete.");
    }
}
