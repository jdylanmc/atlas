import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import type { Finding } from "../domain/finding.ts";
import type { LintOperationResult } from "./lint_operation.ts";
import { isSafeGitBranchName as isSafeGitBranchNameShared } from "./operation_support.ts";
import { type OperationHandoff, type OperationIdentity, type OperationResult } from "./operation_result.ts";
export declare const isSafeGitBranchName: typeof isSafeGitBranchNameShared;
export type SourceAuthority = "official" | "first-party" | "community" | "opinion";
export interface AtlasIngestOperationIdentity extends OperationIdentity {
    readonly kind: "ingest";
    readonly subject: "repository-source";
}
export interface AtlasIngestScope {
    readonly "ingest-scope-schema": "1.0.0";
    readonly approvedAt: string;
    readonly approvedBy: string;
    readonly asOf: string;
    readonly authority: SourceAuthority;
    readonly entryPoint: string;
    readonly excludedPaths: readonly string[];
    readonly freshnessWindowDays: number;
    readonly includedPaths: readonly string[];
    readonly maxDepth: number;
    readonly sourceId: string;
}
export interface AtlasIngestCandidateCitation {
    readonly sourceClaim: string;
    readonly sourceId: string;
}
export interface AtlasIngestCandidateContradiction {
    readonly acceptedBy?: string;
    readonly atlasPolicyId?: string;
    readonly principleTruthId?: string;
}
export interface AtlasIngestCandidateSource {
    readonly authority: SourceAuthority;
    readonly content: string;
    readonly id: string;
    readonly locator: string;
    readonly refreshWindowDays: number;
    readonly revisionTime: string;
    readonly title: string;
}
export interface AtlasIngestCandidateConcept {
    readonly citations: readonly AtlasIngestCandidateCitation[];
    readonly claim: string;
    readonly contradiction?: AtlasIngestCandidateContradiction;
    readonly id: string;
    readonly locator: string;
    readonly title: string;
}
export interface AtlasIngestCandidateEdge {
    readonly citations: readonly AtlasIngestCandidateCitation[];
    readonly context: string;
    readonly from: string;
    readonly id: string;
    readonly semantics: readonly string[];
    readonly title: string;
    readonly to: string;
}
export interface AtlasIngestDispute {
    readonly leftConceptId: string;
    readonly rightConceptId: string;
}
export interface AtlasIngestCandidateGraph {
    readonly "candidate-graph-schema": "1.0.0";
    readonly concepts: readonly AtlasIngestCandidateConcept[];
    readonly disputes: readonly AtlasIngestDispute[];
    readonly edges: readonly AtlasIngestCandidateEdge[];
    readonly sources: readonly AtlasIngestCandidateSource[];
}
export interface AtlasIngestRequest {
    readonly "ingest-request-schema": "1.0.0";
    readonly candidateGraph: AtlasIngestCandidateGraph;
    readonly scope: AtlasIngestScope;
}
export interface AtlasIngestChange {
    readonly content: string;
    readonly path: string;
}
export interface AtlasIngestChangeSet {
    readonly baseSnapshotDigest: string;
    readonly changes: readonly AtlasIngestChange[];
    readonly targetHead: string;
}
export interface AtlasIngestEffectReceipt {
    readonly changeSetDigest?: string;
    readonly commit?: string;
    readonly effect: "create-proposal-worktree" | "write-change-set" | "commit-proposal" | "lint-proposal";
    readonly lintEvidenceCommit?: string;
    readonly receipt: string;
    readonly writtenTree?: string;
}
export interface AtlasIngestWorkflowState {
    readonly "operation-workflow-schema": "1.0.0";
    readonly baseSnapshotDigest: string;
    readonly effectReceipts: readonly AtlasIngestEffectReceipt[];
    readonly operationId: string;
    readonly proposalBranch: string;
    readonly targetBranch: string;
    readonly targetHead: string;
}
export interface AtlasIngestPayload {
    readonly changeSet?: AtlasIngestChangeSet;
    readonly lint?: LintOperationResult;
    readonly state: "completed" | "not-completed";
    readonly workflowState: AtlasIngestWorkflowState;
}
export type AtlasIngestHandoff = OperationHandoff<AtlasIngestOperationIdentity>;
export type AtlasIngestResult = OperationResult<AtlasIngestOperationIdentity, AtlasIngestHandoff, AtlasIngestPayload>;
export interface AtlasIngestRuntime {
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
    readonly persistState?: (state: AtlasIngestWorkflowState) => void;
    readonly workspaceExists?: () => boolean;
    readonly workspacePathValid?: () => boolean;
    readonly writeChangeSet: (changeSet: AtlasIngestChangeSet) => {
        readonly receipt: string;
    };
}
/** The content digest that identifies one immutable Source revision. */
export declare function sourceRevisionDigest(content: string): string;
/** The replay-protection digest of one Ingest Atlas Change Set. */
export declare function atlasIngestChangeSetDigest(changeSet: AtlasIngestChangeSet): string;
export declare function validateCandidateGraph(request: AtlasIngestRequest, existingFiles: readonly CapturedAtlasFile[]): readonly Finding[];
/**
 * The one deterministic reconciliation from a validated Candidate Graph into an
 * Atlas Change Set, reconciled against the Home Atlas it will modify: an
 * identity the Atlas already holds is recorded as a Source Refresh rather than a
 * new page. Frontmatter is emitted through the house serializer, so the same
 * validated graph always reconciles to the same bytes and no crawled value can
 * be interpolated into structured YAML.
 */
export declare function reconcileCandidateGraph(state: AtlasIngestWorkflowState, request: AtlasIngestRequest, existingFiles?: readonly CapturedAtlasFile[]): AtlasIngestChangeSet;
export declare function validateCitationCorrespondence(request: AtlasIngestRequest, changeSet: AtlasIngestChangeSet): readonly Finding[];
export declare function validateAtlasIngestChangeSet(state: AtlasIngestWorkflowState, changeSet: AtlasIngestChangeSet): readonly Finding[];
export declare function runAtlasIngestWorkflow(state: AtlasIngestWorkflowState, request: AtlasIngestRequest, runtime: AtlasIngestRuntime): AtlasIngestResult;
