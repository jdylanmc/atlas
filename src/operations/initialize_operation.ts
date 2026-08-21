import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
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
import type { LintOperationResult } from "./lint_operation.ts";

export interface AtlasInitializationOperationIdentity extends OperationIdentity {
  readonly kind: "initialization";
  readonly subject: "atlas-host-directory";
}

export interface AtlasInitializationWorkflowState {
  readonly "operation-workflow-schema": "1.0.0";
  readonly atlasViewDigest: string;
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
  readonly atlasViewDigest: string;
  readonly changes: readonly AtlasInitializationChange[];
  readonly targetHead: string;
}

export interface LintStamp {
  readonly "lint-stamp-schema": "1.0.0";
  readonly atlasCommit: string;
  readonly check: "sdk-core.atlas-lint";
  readonly evidence: "local-proposal-snapshot";
  readonly framework: "source-worktree";
  readonly policy: "trusted-sdk-core";
  readonly schema: "1.0.0";
}

export interface AtlasReadinessReport {
  readonly boundary: string;
  readonly degradation: string;
  readonly evidence: string;
  readonly governance: string;
  readonly integration: string;
  readonly lintStamp: LintStamp;
  readonly nextAction: string;
  readonly publicationHandoff: string;
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
  readonly currentViewDigest: () => string;
  readonly lintProposal: () => {
    readonly lint: LintOperationResult;
    readonly receipt: string;
  };
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
        : "Refresh the Atlas View, then resume Initialization from the typed workflow state.",
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
  return Object.freeze({
    atlasViewDigest: state.atlasViewDigest,
    changes: Object.freeze([
      Object.freeze({
        content: "# Changelog\n\n- Initialized minimal Home Atlas.\n",
        path: ".atlas/CHANGELOG.md",
      }),
      Object.freeze({
        content:
          '{\n  "atlas-manifest-schema": "1.0.0",\n  "boundary": "repository-root",\n  "guide": null,\n  "site": null\n}\n',
        path: ".atlas/atlas-manifest.json",
      }),
      Object.freeze({
        content:
          "# Framework\n\nThis Atlas is initialized from the source Framework Bundle.\n",
        path: [".atlas", "framework", "README.md"].join("/"),
      }),
      Object.freeze({ content: rootAnchor, path: ".atlas/index.md" }),
    ]),
    targetHead: state.targetHead,
  });
}

export function initialAtlasInitializationWorkflowState(input: {
  readonly atlasViewDigest: string;
  readonly proposalBranch: string;
  readonly targetBranch: string;
  readonly targetHead: string;
}): AtlasInitializationWorkflowState {
  return Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    atlasViewDigest: input.atlasViewDigest,
    effectReceipts: Object.freeze([]),
    proposalBranch: input.proposalBranch,
    targetBranch: input.targetBranch,
    targetHead: input.targetHead,
  });
}

export function validateAtlasInitializationChangeSet(
  state: AtlasInitializationWorkflowState,
  changeSet: AtlasInitializationChangeSet,
): readonly Finding[] {
  const findings: Finding[] = [];
  if (
    changeSet.targetHead !== state.targetHead ||
    changeSet.atlasViewDigest !== state.atlasViewDigest
  ) {
    findings.push(
      finding(
        "ATLAS_INITIALIZATION_CHANGE_SET_STALE",
        "Atlas Change Set base does not match the current Atlas View.",
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

function completedReport(commit: string): AtlasReadinessReport {
  const lintStamp: LintStamp = Object.freeze({
    "lint-stamp-schema": "1.0.0",
    atlasCommit: commit,
    check: "sdk-core.atlas-lint",
    evidence: "local-proposal-snapshot",
    framework: "source-worktree",
    policy: "trusted-sdk-core",
    schema: "1.0.0",
  });
  return Object.freeze({
    boundary: "The Home Atlas boundary is the repository root Atlas Host Directory.",
    degradation:
      "No degraded dependency was needed for local, non-forge Initialization.",
    evidence:
      "No founding knowledge was imported; Lint evidence is the proposal commit snapshot.",
    governance:
      "The minimal Atlas records no Guide Persona and defers governance policy adoption.",
    integration:
      "The Operation Workspace produced a local proposal branch and no forge publication.",
    lintStamp,
    nextAction:
      "Review and publish the local proposal branch, then merge through Git governance.",
    publicationHandoff:
      "Forge publication was not requested; push the proposal branch and open a pull request with the readiness report.",
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

function isSafeGitBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/u.test(name) &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.includes("..") &&
    !name.split("/").some((segment) => segment === "" || segment === ".")
  );
}

export function runAtlasInitializationWorkflow(
  state: AtlasInitializationWorkflowState,
  runtime: AtlasInitializationRuntime,
): AtlasInitializationResult {
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
        state,
        "not-completed",
        "failed",
        {},
        findings,
        "Initialization refused unsafe workflow state before mutating.",
      );
    }

    if (
      runtime.currentTargetHead() !== state.targetHead ||
      runtime.currentViewDigest() !== state.atlasViewDigest
    ) {
      const findings = Object.freeze([
        finding(
          "ATLAS_INITIALIZATION_VIEW_STALE",
          "Atlas Initialization refused stale mutation because the target branch or Atlas View digest changed.",
        ),
      ]);
      return result(
        state,
        "not-completed",
        "failed",
        {},
        findings,
        "Initialization requires a refreshed Atlas View before mutating.",
      );
    }

    let nextState = state;
    if (receiptFor(nextState, "create-proposal-worktree") === undefined) {
      const created = runtime.createProposalWorktree();
      nextState = addReceipt(nextState, {
        effect: "create-proposal-worktree",
        receipt: created.receipt,
      });
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
    }
    let commit = receiptFor(nextState, "commit-proposal")?.receipt;
    if (commit === undefined) {
      const committed = runtime.commitProposal();
      commit = committed.commit;
      nextState = addReceipt(nextState, {
        effect: "commit-proposal",
        receipt: committed.receipt,
      });
    }

    let lint: LintOperationResult | undefined;
    if (receiptFor(nextState, "lint-proposal") === undefined) {
      const linted = runtime.lintProposal();
      lint = linted.lint;
      nextState = addReceipt(nextState, {
        effect: "lint-proposal",
        receipt: linted.receipt,
      });
    } else {
      const linted = runtime.lintProposal();
      lint = linted.lint;
    }

    if (lint.completion !== "completed" || lint.disposition !== "success") {
      return result(
        nextState,
        "not-completed",
        "failed",
        { changeSet, lint },
        lint.handoff.validationState.findings,
        "Initialization proposal did not pass trusted Lint.",
      );
    }

    return result(
      nextState,
      "completed",
      "success",
      { atlasReadinessReport: completedReport(commit), changeSet, lint },
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
      state,
      "not-completed",
      "failed",
      {},
      findings,
      "Initialization did not complete.",
    );
  }
}
