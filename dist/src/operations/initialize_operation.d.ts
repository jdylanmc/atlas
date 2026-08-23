import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { isSafeGitBranchName as isSafeGitBranchNameShared } from "./operation_support.ts";
import type { Finding } from "../domain/finding.ts";
import { type OperationHandoff, type OperationIdentity, type OperationResult } from "./operation_result.ts";
import type { CompletedLintOperationPayload, LintOperationResult } from "./lint_operation.ts";
export interface AtlasInitializationOperationIdentity extends OperationIdentity {
    readonly kind: "initialization";
    readonly subject: "atlas-host-directory";
}
export interface AtlasInitializationWorkflowState {
    readonly "operation-workflow-schema": "1.0.0";
    readonly baseSnapshotDigest: string;
    readonly effectReceipts: readonly AtlasInitializationEffectReceipt[];
    readonly proposalBranch: string;
    readonly targetBranch: string;
    readonly targetHead: string;
}
export interface AtlasInitializationEffectReceipt {
    readonly effect: "create-proposal-worktree" | "write-change-set" | "commit-proposal" | "lint-proposal";
    readonly receipt: string;
}
export interface AtlasInitializationChange {
    readonly content: string;
    readonly path: string;
}
export interface AtlasInitializationChangeSet {
    readonly baseSnapshotDigest: string;
    readonly changes: readonly AtlasInitializationChange[];
    readonly targetHead: string;
}
declare const lintStampBrand: unique symbol;
declare const successfulProposalLintBrand: unique symbol;
export interface LintStamp {
    readonly [lintStampBrand]: true;
    readonly "lint-stamp-schema": "1.0.0";
    readonly atlasCommit: string;
    readonly evidenceRevision: string;
}
export interface SuccessfulProposalLint {
    readonly [successfulProposalLintBrand]: true;
    readonly atlasCommit: string;
    readonly evidenceRevision: string;
    readonly lint: LintOperationResult & {
        readonly completion: "completed";
        readonly disposition: "success";
        readonly payload: CompletedLintOperationPayload & {
            readonly lint: CompletedLintOperationPayload["lint"] & {
                readonly outcome: "valid";
            };
            readonly state: "completed";
        };
    };
}
export interface AtlasReadinessReport {
    readonly boundary: string;
    readonly degradation: string;
    readonly evidence: string;
    readonly foundingGraph: string;
    readonly governance: string;
    readonly guide: string;
    readonly integration: string;
    readonly lintStamp: LintStamp;
    readonly nextAction: string;
    readonly publicationHandoff: string;
    readonly uninspectedAreas: string;
}
export interface AtlasInitializationPayload {
    readonly atlasReadinessReport?: AtlasReadinessReport;
    readonly changeSet?: AtlasInitializationChangeSet;
    readonly lint?: LintOperationResult;
    readonly state: "completed" | "not-completed";
    readonly workflowState: AtlasInitializationWorkflowState;
}
export type AtlasInitializationHandoff = OperationHandoff<AtlasInitializationOperationIdentity>;
export type AtlasInitializationResult = OperationResult<AtlasInitializationOperationIdentity, AtlasInitializationHandoff, AtlasInitializationPayload>;
export interface AtlasInitializationRuntime {
    readonly changeSet?: (state: AtlasInitializationWorkflowState) => AtlasInitializationChangeSet;
    readonly commitProposal: () => {
        readonly commit: string;
        readonly receipt: string;
    };
    readonly createProposalWorktree: () => {
        readonly receipt: string;
    };
    readonly currentTargetHead: () => string;
    readonly currentBaseSnapshotDigest: () => string;
    readonly lintProposal: () => {
        readonly lint: LintOperationResult;
        readonly receipt: string;
    };
    readonly persistState?: (state: AtlasInitializationWorkflowState) => void;
    readonly workspaceExists?: () => boolean;
    readonly workspacePathValid?: () => boolean;
    readonly writeChangeSet: (changeSet: AtlasInitializationChangeSet) => {
        readonly receipt: string;
    };
}
export declare function initialAtlasInitializationWorkflowState(input: {
    readonly baseSnapshotDigest: string;
    readonly proposalBranch: string;
    readonly targetBranch: string;
    readonly targetHead: string;
}): AtlasInitializationWorkflowState;
export declare function notCompletedAtlasInitializationResult(input: {
    readonly code: string;
    readonly message: string;
    readonly recommendedNextAction: string;
    readonly summary: string;
    readonly workflowState?: AtlasInitializationWorkflowState;
}): AtlasInitializationResult;
export declare function validateAtlasInitializationChangeSet(state: AtlasInitializationWorkflowState, changeSet: AtlasInitializationChangeSet): readonly Finding[];
export declare function atlasInitializationFiles(state: AtlasInitializationWorkflowState): readonly CapturedAtlasFile[];
export declare const isSafeGitBranchName: typeof isSafeGitBranchNameShared;
export declare function runAtlasInitializationWorkflow(state: AtlasInitializationWorkflowState, runtime: AtlasInitializationRuntime): AtlasInitializationResult;
export {};
