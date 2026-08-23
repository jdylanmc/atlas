import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import type { Finding } from "../domain/finding.ts";
import type { LintOperationResult } from "./lint_operation.ts";
import { type OperationHandoff, type OperationIdentity, type OperationResult } from "./operation_result.ts";
export type AtlasGovernanceSubject = "principle" | "atlas-policy";
export interface AtlasGovernanceOperationIdentity extends OperationIdentity {
    readonly kind: "governance";
    readonly subject: AtlasGovernanceSubject;
}
export interface AtlasGovernanceEffectReceipt {
    readonly changeSetDigest?: string;
    readonly commit?: string;
    readonly effect: "create-proposal-worktree" | "write-change-set" | "commit-proposal" | "lint-proposal";
    readonly lintEvidenceCommit?: string;
    readonly receipt: string;
    readonly writtenTree?: string;
}
export interface AtlasGovernanceWorkflowState {
    readonly "operation-workflow-schema": "1.0.0";
    readonly baseSnapshotDigest: string;
    readonly effectReceipts: readonly AtlasGovernanceEffectReceipt[];
    readonly operationId: string;
    readonly proposalBranch: string;
    readonly targetBranch: string;
    readonly targetHead: string;
}
export interface AtlasGovernanceChange {
    readonly content: string;
    readonly path: string;
}
export interface AtlasGovernanceChangeSet {
    readonly baseSnapshotDigest: string;
    readonly changes: readonly AtlasGovernanceChange[];
    readonly targetHead: string;
}
export interface AtlasGovernanceSemanticVerdict {
    readonly challenge: {
        readonly argument: string;
        readonly evidence: readonly string[];
        readonly position: "agree" | "disagree";
    };
    readonly evidence: readonly string[];
    readonly policyId: string;
    readonly verdict: "pass" | "fail";
}
export interface AtlasGovernanceRequest {
    readonly "governance-request-schema": "1.0.0";
    readonly action: "create" | "amend" | "retire" | "delete" | "verify";
    readonly approvedAt?: string;
    readonly approvedBy?: string;
    readonly changeSet?: AtlasGovernanceChangeSet;
    readonly semanticVerdicts?: readonly AtlasGovernanceSemanticVerdict[];
    readonly subject: AtlasGovernanceSubject;
}
export interface AtlasGovernancePayload {
    readonly changeSet?: AtlasGovernanceChangeSet;
    readonly lint?: LintOperationResult;
    readonly state: "completed" | "not-completed";
    readonly workflowState: AtlasGovernanceWorkflowState;
}
export type AtlasGovernanceHandoff = OperationHandoff<AtlasGovernanceOperationIdentity>;
export type AtlasGovernanceResult = OperationResult<AtlasGovernanceOperationIdentity, AtlasGovernanceHandoff, AtlasGovernancePayload>;
export interface AtlasGovernanceRuntime {
    readonly commitProposal: () => {
        readonly commit: string;
        readonly receipt: string;
    };
    readonly createProposalWorktree: () => {
        readonly receipt: string;
    };
    readonly currentBaseSnapshotDigest: () => string;
    readonly currentTargetHead: () => string;
    readonly existingAtlasFiles: () => readonly CapturedAtlasFile[];
    readonly lintProposal: () => {
        readonly lint: LintOperationResult;
        readonly receipt: string;
    };
    readonly persistState?: (state: AtlasGovernanceWorkflowState) => void;
    readonly workspaceExists?: () => boolean;
    readonly workspacePathValid?: () => boolean;
    readonly writeChangeSet: (changeSet: AtlasGovernanceChangeSet) => {
        readonly receipt: string;
    };
}
export declare function validateAtlasGovernanceChangeSet(state: AtlasGovernanceWorkflowState, request: AtlasGovernanceRequest): readonly Finding[];
export declare function mergeGovernanceFindings(trustedFindings: readonly Finding[], suppliedFindings: readonly Finding[]): readonly Finding[];
export declare function runAtlasGovernanceWorkflow(state: AtlasGovernanceWorkflowState, request: AtlasGovernanceRequest, runtime: AtlasGovernanceRuntime): AtlasGovernanceResult;
