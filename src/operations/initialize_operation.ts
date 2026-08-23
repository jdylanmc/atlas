import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { isSafeGitBranchName as isSafeGitBranchNameShared } from "./operation_support.ts";
import type { Finding } from "../domain/finding.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationHandoff,
  type OperationIdentity,
  type OperationReference,
  type OperationResult,
  type OperationReviewLink,
} from "./operation_result.ts";
import type {
  CompletedLintOperationPayload,
  LintOperationResult,
} from "./lint_operation.ts";

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
  readonly effect:
    | "create-proposal-worktree"
    | "write-change-set"
    | "commit-proposal"
    | "lint-proposal";
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

export type FrameworkBundleState = "absent" | "installed";

export interface FrameworkBundleStateEvidence {
  readonly frameworkFilePaths: readonly string[];
  readonly inventoryPaths: readonly string[];
  readonly manifestDigestVerified: boolean;
  readonly manifestPresent: boolean;
}

export const atlasFrameworkDirectory = ".atlas/framework";
export const frameworkReleaseManifestAtlasPath = `${atlasFrameworkDirectory}/framework-release-manifest.json`;
export const frameworkReleaseManifestDigestAtlasPath = `${atlasFrameworkDirectory}/framework-release-manifest.sha256`;

export const canonicalFrameworkPageByBundleState = Object.freeze({
  absent:
    "# Framework\n\nNo Framework Bundle is installed in this Atlas yet.\nFramework Bundle files, once installed, are opaque to Atlas page parsing.\n",
  installed:
    "# Framework\n\nFramework Bundle is installed in this Atlas.\nThe Framework Release Manifest and its complete inventory of SDK-owned files are present in the Framework Bundle directory.\nFramework Bundle files are opaque to Atlas page parsing.\n",
}) satisfies Readonly<Record<FrameworkBundleState, string>>;

export function frameworkBundleStateFromEvidence(
  evidence: FrameworkBundleStateEvidence,
): FrameworkBundleState {
  const frameworkFiles = new Set(evidence.frameworkFilePaths);
  const inventoryComplete = evidence.inventoryPaths.every((path) =>
    frameworkFiles.has(`${atlasFrameworkDirectory}/${path}`),
  );
  if (
    evidence.manifestPresent &&
    evidence.manifestDigestVerified &&
    inventoryComplete
  ) {
    return "installed";
  }
  return "absent";
}

const lintStampBrand: unique symbol = Symbol("lint-stamp");
const successfulProposalLintBrand: unique symbol = Symbol("successful-proposal-lint");

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

export type AtlasInitializationHandoff =
  OperationHandoff<AtlasInitializationOperationIdentity>;

export type AtlasInitializationResult = OperationResult<
  AtlasInitializationOperationIdentity,
  AtlasInitializationHandoff,
  AtlasInitializationPayload
>;

export interface AtlasInitializationRuntime {
  readonly changeSet?: (
    state: AtlasInitializationWorkflowState,
  ) => AtlasInitializationChangeSet;
  readonly commitProposal: () => { readonly commit: string; readonly receipt: string };
  readonly createProposalWorktree: () => { readonly receipt: string };
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

const initializationOperation: AtlasInitializationOperationIdentity = Object.freeze({
  kind: "initialization",
  subject: "atlas-host-directory",
});

const commandAttribution = Object.freeze({
  checkId: "sdk-core.atlas-initialization",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const noReviewLink: OperationReviewLink = Object.freeze({
  reason: "Forge publication was not requested; the Atlas Proposal remains local.",
  state: "not-applicable",
});

function finding(code: string, message: string): Finding {
  return Object.freeze({
    attribution: commandAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path: ".atlas",
    severity: "error" as const,
  });
}

function receiptFor(
  state: AtlasInitializationWorkflowState,
  effect: AtlasInitializationEffectReceipt["effect"],
): AtlasInitializationEffectReceipt | undefined {
  return state.effectReceipts.find((receipt) => receipt.effect === effect);
}

function addReceipt(
  state: AtlasInitializationWorkflowState,
  receipt: AtlasInitializationEffectReceipt,
): AtlasInitializationWorkflowState {
  return Object.freeze({
    ...state,
    effectReceipts: Object.freeze([...state.effectReceipts, receipt]),
  });
}

function handoff(
  state: AtlasInitializationWorkflowState,
  disposition: "failed" | "success",
  completion: "completed" | "not-completed",
  findings: readonly Finding[],
  summary: string,
): AtlasInitializationHandoff {
  return Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: Object.freeze({
      reference: state.targetHead,
      state: "known" as const,
    }),
    degradationState: Object.freeze({
      reason:
        findings.length === 0
          ? "Initialization completed without degraded dependencies."
          : summary,
      state: findings.length === 0 ? ("not-degraded" as const) : ("degraded" as const),
    }),
    homeAtlas: Object.freeze({
      reason: "Initialization proposes the first Home Atlas; it is not merged yet.",
      state: "not-applicable" as const,
    }) satisfies OperationReference,
    operation: initializationOperation,
    proposedChanges:
      completion === "completed"
        ? Object.freeze({
            state: "available" as const,
            summary: `Local Atlas Proposal branch ${state.proposalBranch} contains the minimal Atlas Change Set.`,
          })
        : Object.freeze({
            reason: summary,
            state: "unknown" as const,
          }),
    recommendedNextAction:
      completion === "completed"
        ? "Review the local Atlas Proposal and publish it to the forge when ready."
        : "Refresh the base snapshot, then resume Initialization from the typed workflow state.",
    result: Object.freeze({ disposition, summary }),
    reviewLink: noReviewLink,
    unresolvedHumanDecisions: Object.freeze({
      state: "none" as const,
      summary:
        "Minimal Initialization chose no Guide Persona, founding knowledge, site, or forge publication.",
    }),
    validationState: Object.freeze({
      findings,
      state:
        completion === "completed" ? ("passed" as const) : ("not-completed" as const),
    }),
  });
}

function result(
  state: AtlasInitializationWorkflowState,
  completion: "completed" | "not-completed",
  disposition: "failed" | "success",
  payload: Omit<AtlasInitializationPayload, "state" | "workflowState">,
  findings: readonly Finding[],
  summary: string,
): AtlasInitializationResult {
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

function minimalAtlasChangeSet(
  state: AtlasInitializationWorkflowState,
): AtlasInitializationChangeSet {
  const rootAnchor = `---\nsdk:\n  atlas-sdk-schema: 1.0.0\n  created-at: "2026-01-01T00:00:00Z"\n  created-by:\n    kind: agent\n    name: Atlas SDK\n  id: anchor:root\n  local-atlas-schema: 1.0.0\n  originating-operation: atlas-initialization\n  tags: []\n  title: Home Atlas\n  type: anchor\n  updated-at: "2026-01-01T00:00:00Z"\n  updated-by:\n    kind: agent\n    name: Atlas SDK\natlas: {}\n---\n\n# Home Atlas\n\nThis Root Anchor starts a minimal Home Atlas with no Guide Persona, founding knowledge, or Atlas Site.\n`;
  const changelog = Object.freeze({
    content: "# Changelog\n\n- Initialized minimal Home Atlas.\n",
    path: ".atlas/CHANGELOG.md",
  });
  const root = Object.freeze({ content: rootAnchor, path: ".atlas/index.md" });
  const frameworkBundleState = frameworkBundleStateFromEvidence({
    frameworkFilePaths: [changelog.path, root.path],
    inventoryPaths: Object.freeze([]),
    manifestDigestVerified: false,
    manifestPresent: false,
  });
  return Object.freeze({
    baseSnapshotDigest: state.baseSnapshotDigest,
    changes: Object.freeze([
      changelog,
      Object.freeze({
        content: canonicalFrameworkPageByBundleState[frameworkBundleState],
        path: `${atlasFrameworkDirectory}/README.md`,
      }),
      root,
    ]),
    targetHead: state.targetHead,
  });
}

export function initialAtlasInitializationWorkflowState(input: {
  readonly baseSnapshotDigest: string;
  readonly proposalBranch: string;
  readonly targetBranch: string;
  readonly targetHead: string;
}): AtlasInitializationWorkflowState {
  return Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    baseSnapshotDigest: input.baseSnapshotDigest,
    effectReceipts: Object.freeze([]),
    proposalBranch: input.proposalBranch,
    targetBranch: input.targetBranch,
    targetHead: input.targetHead,
  });
}

export function notCompletedAtlasInitializationResult(input: {
  readonly code: string;
  readonly message: string;
  readonly recommendedNextAction: string;
  readonly summary: string;
  readonly workflowState?: AtlasInitializationWorkflowState;
}): AtlasInitializationResult {
  const workflowState =
    input.workflowState ??
    initialAtlasInitializationWorkflowState({
      baseSnapshotDigest: "unknown",
      proposalBranch: "unknown",
      targetBranch: "unknown",
      targetHead: "unknown",
    });
  const findings = Object.freeze([finding(input.code, input.message)]);
  const operationHandoff = handoff(
    workflowState,
    "failed",
    "not-completed",
    findings,
    input.summary,
  );
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "not-completed" as const,
    disposition: "failed" as const,
    handoff: Object.freeze({
      ...operationHandoff,
      recommendedNextAction: input.recommendedNextAction,
    }),
    operation: initializationOperation,
    payload: Object.freeze({
      state: "not-completed" as const,
      workflowState,
    }),
  });
}

export function validateAtlasInitializationChangeSet(
  state: AtlasInitializationWorkflowState,
  changeSet: AtlasInitializationChangeSet,
): readonly Finding[] {
  const findings: Finding[] = [];
  if (
    changeSet.targetHead !== state.targetHead ||
    changeSet.baseSnapshotDigest !== state.baseSnapshotDigest
  ) {
    findings.push(
      finding(
        "ATLAS_INITIALIZATION_CHANGE_SET_STALE",
        "Atlas Change Set base does not match the current base snapshot.",
      ),
    );
  }
  for (const change of changeSet.changes) {
    if (
      !change.path.startsWith(".atlas/") ||
      change.path.includes("..") ||
      change.path.startsWith("/") ||
      change.path.includes("\\")
    ) {
      findings.push(
        finding(
          "ATLAS_INITIALIZATION_CHANGE_SET_PATH_INVALID",
          "Atlas Change Set may write only canonical .atlas paths.",
        ),
      );
    }
  }
  return Object.freeze(findings);
}

function isSuccessfulCompletedLint(
  lint: LintOperationResult,
): lint is SuccessfulProposalLint["lint"] {
  return (
    lint.completion === "completed" &&
    lint.disposition === "success" &&
    lint.payload.state === "completed" &&
    lint.payload.lint.outcome === "valid"
  );
}

function successfulProposalLint(input: {
  readonly atlasCommit: string;
  readonly evidenceRevision: string;
  readonly lint: LintOperationResult;
}): SuccessfulProposalLint | Finding {
  if (!isSuccessfulCompletedLint(input.lint)) {
    return finding(
      "ATLAS_INITIALIZATION_LINT_STAMP_UNPROVEN",
      "Atlas Initialization refused to stamp a proposal without a successful completed Lint.",
    );
  }
  if (input.evidenceRevision !== input.atlasCommit) {
    return finding(
      "ATLAS_INITIALIZATION_LINT_STAMP_STALE",
      "Atlas Initialization refused to stamp a proposal commit different from the Lint evidence commit.",
    );
  }
  return Object.freeze({
    [successfulProposalLintBrand]: true as const,
    atlasCommit: input.atlasCommit,
    evidenceRevision: input.evidenceRevision,
    lint: input.lint,
  });
}

function completedReport(evidence: SuccessfulProposalLint): AtlasReadinessReport {
  const lintStamp: LintStamp = Object.freeze({
    [lintStampBrand]: true as const,
    "lint-stamp-schema": "1.0.0",
    atlasCommit: evidence.atlasCommit,
    evidenceRevision: evidence.evidenceRevision,
  });
  return Object.freeze({
    boundary: "The Home Atlas boundary is the repository root Atlas Host Directory.",
    degradation:
      "No degraded dependency was needed for local, non-forge Initialization.",
    evidence:
      "No founding knowledge was imported; Lint evidence is the proposal commit snapshot.",
    foundingGraph: "None: minimal Initialization imports no founding knowledge.",
    governance:
      "The minimal Atlas proposes no Atlas Manifest; human-authored declaration is pending review.",
    guide: "None: minimal Initialization records no Guide Persona.",
    integration:
      "The Operation Workspace produced a local proposal branch and no forge publication.",
    lintStamp,
    nextAction:
      "Review and publish the local proposal branch, then merge through Git governance.",
    publicationHandoff:
      "Forge publication was not requested; push the proposal branch and open a pull request with the readiness report.",
    uninspectedAreas:
      "No external sources, tracked Atlases, forge remotes, Atlas Site, or governance policies were inspected.",
  });
}

export function atlasInitializationFiles(
  state: AtlasInitializationWorkflowState,
): readonly CapturedAtlasFile[] {
  const encoder = new TextEncoder();
  return minimalAtlasChangeSet(state).changes.map((change) =>
    Object.freeze({ bytes: encoder.encode(change.content), path: change.path }),
  );
}

export const isSafeGitBranchName = isSafeGitBranchNameShared;

export function runAtlasInitializationWorkflow(
  state: AtlasInitializationWorkflowState,
  runtime: AtlasInitializationRuntime,
): AtlasInitializationResult {
  let latestState = state;
  try {
    if (
      !isSafeGitBranchName(state.proposalBranch) ||
      !isSafeGitBranchName(state.targetBranch)
    ) {
      const findings = Object.freeze([
        finding(
          "ATLAS_INITIALIZATION_WORKFLOW_STATE_INVALID",
          "Atlas Initialization workflow state names an unsafe branch.",
        ),
      ]);
      return result(
        latestState,
        "not-completed",
        "failed",
        {},
        findings,
        "Initialization refused unsafe workflow state before mutating.",
      );
    }

    if (
      runtime.currentTargetHead() !== state.targetHead ||
      runtime.currentBaseSnapshotDigest() !== state.baseSnapshotDigest
    ) {
      const findings = Object.freeze([
        finding(
          "ATLAS_INITIALIZATION_BASE_SNAPSHOT_STALE",
          "Atlas Initialization refused stale mutation because the target branch or base snapshot digest changed.",
        ),
      ]);
      return result(
        latestState,
        "not-completed",
        "failed",
        {},
        findings,
        "Initialization requires a refreshed base snapshot before mutating.",
      );
    }

    let nextState = state;
    if (
      receiptFor(nextState, "create-proposal-worktree") === undefined &&
      runtime.workspaceExists?.() === true
    ) {
      return notCompletedAtlasInitializationResult({
        code: "ATLAS_INITIALIZATION_WORKSPACE_EXISTS",
        message:
          "Atlas Initialization found an existing proposal branch or Operation Workspace before creating a new proposal.",
        recommendedNextAction:
          "Resume with --resume-proposal-branch for the existing proposal, or explicitly discard it after saving any review work.",
        summary: "Initialization refused to overwrite an existing Operation Workspace.",
        workflowState: nextState,
      });
    }
    if (
      receiptFor(nextState, "create-proposal-worktree") === undefined &&
      runtime.workspacePathValid?.() === false
    ) {
      return notCompletedAtlasInitializationResult({
        code: "ATLAS_INITIALIZATION_WORKSPACE_PATH_INVALID",
        message:
          "Atlas Initialization refused an Operation Workspace path that escapes the Atlas Host Directory.",
        recommendedNextAction:
          "Remove symlinks from the Operation Workspace path, then retry Initialization from a clean Git worktree.",
        summary:
          "Initialization refused to create an Operation Workspace outside the Atlas Host Directory.",
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

    const changeSet =
      runtime.changeSet?.(nextState) ?? minimalAtlasChangeSet(nextState);
    const changeSetFindings = validateAtlasInitializationChangeSet(
      nextState,
      changeSet,
    );
    if (changeSetFindings.length > 0) {
      return result(
        nextState,
        "not-completed",
        "failed",
        { changeSet },
        changeSetFindings,
        "Initialization refused an invalid Atlas Change Set.",
      );
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

    let lint: LintOperationResult | undefined;
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
    } else {
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
      return result(
        nextState,
        "not-completed",
        "failed",
        { changeSet, lint },
        stampEvidence.code === "ATLAS_INITIALIZATION_LINT_STAMP_UNPROVEN"
          ? lint.handoff.validationState.findings
          : Object.freeze([stampEvidence]),
        stampEvidence.code === "ATLAS_INITIALIZATION_LINT_STAMP_UNPROVEN"
          ? "Initialization proposal did not pass trusted Lint."
          : "Initialization refused a stale Lint Stamp.",
      );
    }

    return result(
      nextState,
      "completed",
      "success",
      { atlasReadinessReport: completedReport(stampEvidence), changeSet, lint },
      Object.freeze([]),
      "Initialization produced a Linted local Atlas Proposal.",
    );
  } catch {
    const findings = Object.freeze([
      finding(
        "ATLAS_INITIALIZATION_RUNTIME_FAILED",
        "Atlas Initialization runtime failed before the operation completed.",
      ),
    ]);
    return result(
      latestState,
      "not-completed",
      "failed",
      {},
      findings,
      "Initialization did not complete.",
    );
  }
}
