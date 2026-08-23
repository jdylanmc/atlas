import {
  normalizeAtlasTextPath,
  type CapturedAtlasFile,
} from "../atlas/load_atlas_text.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import { dateTimeMilliseconds } from "../domain/atlas_page.ts";
import {
  addReceipt,
  canContinue,
  changeSetDigest,
  isSafeGitBranchName,
  receiptFor,
} from "./operation_support.ts";
import type { Finding } from "../domain/finding.ts";
import type { LintOperationResult } from "./lint_operation.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationHandoff,
  type OperationIdentity,
  type OperationReference,
  type OperationResult,
  type OperationReviewLink,
} from "./operation_result.ts";

export type AtlasGovernanceSubject = "principle" | "atlas-policy";

export interface AtlasGovernanceOperationIdentity extends OperationIdentity {
  readonly kind: "governance";
  readonly subject: AtlasGovernanceSubject;
}

export interface AtlasGovernanceEffectReceipt {
  readonly changeSetDigest?: string;
  readonly commit?: string;
  readonly effect:
    | "create-proposal-worktree"
    | "write-change-set"
    | "commit-proposal"
    | "lint-proposal";
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

export type AtlasGovernanceResult = OperationResult<
  AtlasGovernanceOperationIdentity,
  AtlasGovernanceHandoff,
  AtlasGovernancePayload
>;

export interface AtlasGovernanceRuntime {
  readonly commitProposal: () => { readonly commit: string; readonly receipt: string };
  readonly createProposalWorktree: () => { readonly receipt: string };
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

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.atlas-governance",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const noReviewLink: OperationReviewLink = Object.freeze({
  reason: "Governance maintenance produced a local Atlas Proposal only.",
  state: "not-applicable",
});

const severityRank = Object.freeze({
  error: 4,
  inconclusive: 3,
  skipped: 0,
  suggestion: 1,
  warning: 2,
} as const);

function finding(
  code: string,
  message: string,
  path = ".atlas",
  severity: Finding["severity"] = "error",
): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity,
  });
}

function operation(subject: AtlasGovernanceSubject): AtlasGovernanceOperationIdentity {
  return Object.freeze({ kind: "governance" as const, subject });
}

function handoff(
  state: AtlasGovernanceWorkflowState,
  subject: AtlasGovernanceSubject,
  disposition: "failed" | "success",
  completion: "completed" | "not-completed",
  findings: readonly Finding[],
  summary: string,
): AtlasGovernanceHandoff {
  return Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: Object.freeze({
      reference: state.targetHead,
      state: "known" as const,
    }),
    degradationState: Object.freeze({
      reason:
        findings.length === 0
          ? "Governance maintenance completed without degraded dependencies."
          : summary,
      state: findings.length === 0 ? ("not-degraded" as const) : ("degraded" as const),
    }),
    homeAtlas: Object.freeze({
      reason: "Governance maintenance runs against the selected Home Atlas.",
      state: "unknown" as const,
    }) satisfies OperationReference,
    operation: operation(subject),
    proposedChanges:
      completion === "completed"
        ? Object.freeze({
            state: "available" as const,
            summary: `Atlas Proposal branch ${state.proposalBranch} carries governance operation ${state.operationId}.`,
          })
        : Object.freeze({ reason: summary, state: "unknown" as const }),
    recommendedNextAction:
      completion === "completed"
        ? "Review the Atlas Proposal, then merge it through Git governance if approved."
        : "Resolve the reported governance Findings, then resume from the typed workflow state.",
    result: Object.freeze({ disposition, summary }),
    reviewLink: noReviewLink,
    unresolvedHumanDecisions: findings.some(
      (entry) => entry.severity === "inconclusive",
    )
      ? Object.freeze({
          decisions: Object.freeze([
            "A Maintainer must adjudicate the semantic Policy verdict and Challenge disagreement.",
          ]),
          state: "pending" as const,
        })
      : Object.freeze({
          state: "none" as const,
          summary: "No unresolved human decision is encoded in this result.",
        }),
    validationState: Object.freeze({
      findings,
      state:
        completion === "completed" ? ("passed" as const) : ("not-completed" as const),
    }),
  });
}

function result(
  state: AtlasGovernanceWorkflowState,
  request: AtlasGovernanceRequest,
  completion: "completed" | "not-completed",
  disposition: "failed" | "success",
  payload: Omit<AtlasGovernancePayload, "state" | "workflowState">,
  findings: readonly Finding[],
  summary: string,
): AtlasGovernanceResult {
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion,
    disposition,
    handoff: handoff(
      state,
      request.subject,
      disposition,
      completion,
      findings,
      summary,
    ),
    operation: operation(request.subject),
    payload: Object.freeze({ ...payload, state: completion, workflowState: state }),
  });
}

// The one shared path rule the product enforces. A governance Change Set may
// write only a path that is already in canonical `.atlas/` form: no leading
// slash, no backslash, no `.`/`..`/empty segment, and — the clause a hand-rolled
// check omitted — none of the control characters or bidirectional overrides
// normalizeAtlasTextPath refuses, which otherwise pass this pre-mutation gate and
// are written and committed before Lint catches them. Requiring the input to
// equal its own normalization keeps one rule instead of two that approximate it.
function pathIsCanonicalAtlasPath(path: string): boolean {
  try {
    return normalizeAtlasTextPath(path) === path;
  } catch {
    return false;
  }
}

function evidencePath(reference: string): string | undefined {
  const [path] = reference.split("#", 1);
  if (path === undefined || !pathIsCanonicalAtlasPath(path)) return undefined;
  return path;
}

function capturedPathSet(
  baseFiles: readonly CapturedAtlasFile[],
  changeSet: AtlasGovernanceChangeSet | undefined,
): ReadonlySet<string> {
  const paths = new Set(baseFiles.map((file) => file.path));
  for (const change of changeSet?.changes ?? []) paths.add(change.path);
  return paths;
}

function capturedText(file: CapturedAtlasFile | undefined): string | undefined {
  return file === undefined ? undefined : new TextDecoder().decode(file.bytes);
}

function frontmatterId(content: string): string | undefined {
  return /^\s*id:\s*([^\s]+)\s*$/mu.exec(content)?.[1];
}

function expectedIdFromPath(path: string, prefix: string): string | undefined {
  const match = /^\.atlas\/(?:types\/policy|principles)\/([^/]+)\.md$/u.exec(path);
  const slug = match?.[1];
  return slug === undefined ? undefined : `${prefix}:${slug}`;
}

interface PolicyTarget {
  readonly id: string;
  readonly path: string;
}

function changedPolicyTargets(
  existing: readonly CapturedAtlasFile[],
  changeSet: AtlasGovernanceChangeSet | undefined,
): readonly PolicyTarget[] {
  if (changeSet === undefined) return Object.freeze([]);
  const existingByPath = new Map(existing.map((file) => [file.path, file]));
  return Object.freeze(
    changeSet.changes
      .filter((change) => change.path.startsWith(".atlas/types/policy/"))
      .map((change) => {
        const baseId = frontmatterId(
          capturedText(existingByPath.get(change.path)) ?? "",
        );
        const changedId = frontmatterId(change.content);
        const expectedId = expectedIdFromPath(change.path, "policy");
        return Object.freeze({
          id: baseId ?? changedId ?? expectedId ?? "",
          path: change.path,
        });
      })
      .filter((target) => target.id !== ""),
  );
}

function validateEvidence(
  references: readonly string[],
  paths: ReadonlySet<string>,
  findingPath: string,
): readonly Finding[] {
  if (references.length === 0) {
    return Object.freeze([
      finding(
        "ATLAS_GOVERNANCE_SEMANTIC_EVIDENCE_REQUIRED",
        "Semantic Policy verdicts and Challenges must cite evidence.",
        findingPath,
      ),
    ]);
  }
  const findings: Finding[] = [];
  for (const reference of references) {
    const path = evidencePath(reference);
    if (path === undefined || !paths.has(path)) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_SEMANTIC_EVIDENCE_UNRESOLVED",
          "Semantic Policy evidence must resolve to an existing Atlas location.",
          findingPath,
        ),
      );
    }
  }
  return Object.freeze(findings);
}

function validateSemanticVerdicts(
  request: AtlasGovernanceRequest,
  paths: ReadonlySet<string>,
  targets: readonly PolicyTarget[],
): readonly Finding[] {
  const findings: Finding[] = [];
  const verdicts = request.semanticVerdicts ?? [];
  const targetIds = new Set(targets.map((target) => target.id));
  if (request.subject === "atlas-policy" && request.action !== "verify") {
    if (verdicts.length === 0) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_POLICY_DOCTRINE_UNSUPPORTED",
          "Atlas Policy doctrine must be enforceable by deterministic rules or supplied semantic verdicts.",
        ),
      );
    }
    for (const target of targets) {
      if (!verdicts.some((verdict) => verdict.policyId === target.id)) {
        findings.push(
          finding(
            "ATLAS_GOVERNANCE_POLICY_VERDICT_MISSING",
            "Every changed Atlas Policy identity must have its own semantic verdict.",
            target.path,
          ),
        );
      }
    }
    for (const verdict of verdicts) {
      if (!targetIds.has(verdict.policyId)) {
        findings.push(
          finding(
            "ATLAS_GOVERNANCE_POLICY_VERDICT_UNMATCHED",
            "Semantic Policy verdicts must correspond to a Policy changed by this Atlas Change Set.",
            `.atlas/types/policy/${verdict.policyId.replace(/^policy:/u, "")}.md`,
          ),
        );
      }
    }
  }
  for (const verdict of verdicts) {
    const path =
      targets.find((target) => target.id === verdict.policyId)?.path ??
      `.atlas/types/policy/${verdict.policyId.replace(/^policy:/u, "")}.md`;
    findings.push(...validateEvidence(verdict.evidence, paths, path));
    findings.push(...validateEvidence(verdict.challenge.evidence, paths, path));
    if (verdict.verdict === "fail") {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_SEMANTIC_VERDICT_FAILED",
          "A failing semantic Atlas Policy verdict blocks the governed operation.",
          path,
        ),
      );
    }
    if (verdict.challenge.argument.trim() === "") {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_CHALLENGE_ARGUMENT_REQUIRED",
          "A Challenge must include the adversarial argument it made against the semantic verdict.",
          path,
        ),
      );
    }
    if (verdict.challenge.position === "disagree") {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_SEMANTIC_DISAGREEMENT",
          "Semantic Policy verdict and Challenge disagree; the Finding is inconclusive and requires Maintainer escalation.",
          path,
          "inconclusive",
        ),
      );
    }
  }
  return Object.freeze(findings);
}

function validateApproval(request: AtlasGovernanceRequest): readonly Finding[] {
  if (request.action === "verify") return Object.freeze([]);
  if (
    (request.approvedBy ?? "").trim() !== "" &&
    dateTimeMilliseconds(request.approvedAt ?? "") !== undefined
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([
    finding(
      "ATLAS_GOVERNANCE_APPROVAL_REQUIRED",
      "Principle and Atlas Policy maintenance requires an explicit Maintainer approver and a comparable date-time approval instant.",
    ),
  ]);
}

function activeTruthIds(content: string): readonly string[] {
  const ids: string[] = [];
  let active = false;
  for (const line of content.split(/\r?\n/u)) {
    if (/^## /u.test(line)) active = line === "## Active truths";
    if (!active) continue;
    const match = /^- `([^`]+)` /u.exec(line);
    if (match !== null) ids.push(match[1] as string);
  }
  return Object.freeze(ids);
}

function validatePrincipleChangeSet(
  request: AtlasGovernanceRequest,
  changeSet: AtlasGovernanceChangeSet | undefined,
  existing: readonly CapturedAtlasFile[],
): readonly Finding[] {
  if (request.subject !== "principle" || changeSet === undefined)
    return Object.freeze([]);
  const findings: Finding[] = [];
  const existingByPath = new Map(existing.map((file) => [file.path, file]));
  for (const change of changeSet.changes) {
    if (!change.path.startsWith(".atlas/principles/")) continue;
    const ids = activeTruthIds(change.content);
    const baseContent = capturedText(existingByPath.get(change.path));
    const baseId = frontmatterId(baseContent ?? "");
    const changedId = frontmatterId(change.content);
    const expectedId = expectedIdFromPath(change.path, "principle");
    if (baseId !== undefined && changedId !== baseId) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_PRINCIPLE_IDENTITY_CHANGED",
          "Principle amendments must retain the stable Principle identity captured at that path.",
          change.path,
        ),
      );
    } else if (
      baseId === undefined &&
      expectedId !== undefined &&
      changedId !== expectedId
    ) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_PRINCIPLE_IDENTITY_CHANGED",
          "New Principle pages must use the deterministic path-derived Principle identity.",
          change.path,
        ),
      );
    }
    if (baseContent !== undefined && request.action === "amend") {
      const oldIds = new Set(activeTruthIds(baseContent));
      const nextIds = new Set(ids);
      const removed = [...oldIds].filter((id) => !nextIds.has(id));
      const added = ids.filter((id) => !oldIds.has(id));
      if (removed.length > 0 && added.length > 0) {
        const lower = change.content.toLowerCase();
        const recordsInvalidation = removed.every(
          (id) => lower.includes(id.toLowerCase()) && lower.includes("invalidat"),
        );
        const recordsSuccessor = added.every(
          (id) => lower.includes(id.toLowerCase()) && lower.includes("successor"),
        );
        if (!recordsInvalidation || !recordsSuccessor) {
          findings.push(
            finding(
              "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_SUCCESSOR_REQUIRED",
              "Semantic Principle truth replacement must invalidate the old truth and record a linked successor with a new identity.",
              change.path,
            ),
          );
        }
      }
    }
    if (ids.length === 0 && request.action !== "retire") {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_REQUIRED",
          "An active Principle must carry at least one stable truth identity.",
          change.path,
        ),
      );
    }
    const sorted = [...ids].toSorted(compareCodePoints);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] === sorted[index - 1]) {
        findings.push(
          finding(
            "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_DUPLICATE",
            "Principle truth identities must be stable and unique within the Principle.",
            change.path,
          ),
        );
      }
    }
    if (!change.content.includes("## Amendments")) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_PRINCIPLE_AMENDMENT_REQUIRED",
          "Principle maintenance must preserve the amendment history.",
          change.path,
        ),
      );
    }
  }
  return Object.freeze(findings);
}

function validatePolicyChangeSet(
  request: AtlasGovernanceRequest,
  changeSet: AtlasGovernanceChangeSet | undefined,
  existing: readonly CapturedAtlasFile[],
): readonly Finding[] {
  if (request.subject !== "atlas-policy" || changeSet === undefined) {
    return Object.freeze([]);
  }
  const policyChanges = changeSet.changes.filter((change) =>
    change.path.startsWith(".atlas/types/policy/"),
  );
  if (policyChanges.length === 0) {
    return Object.freeze([
      finding(
        "ATLAS_GOVERNANCE_POLICY_CHANGE_REQUIRED",
        "Atlas Policy maintenance must change a Policy page with a stable identity.",
      ),
    ]);
  }
  const findings: Finding[] = [];
  const existingByPath = new Map(existing.map((file) => [file.path, file]));
  for (const change of policyChanges) {
    const id = frontmatterId(change.content);
    const baseId = frontmatterId(capturedText(existingByPath.get(change.path)) ?? "");
    const expectedId = expectedIdFromPath(change.path, "policy");
    if (
      id !== undefined &&
      ((baseId !== undefined && id !== baseId) ||
        (baseId === undefined && expectedId !== undefined && id !== expectedId))
    ) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_POLICY_IDENTITY_CHANGED",
          "Atlas Policy page identity must correspond to the existing page or deterministic path target.",
          change.path,
        ),
      );
    }
    if (!/^\s*id: policy:[^\s]+$/mu.test(change.content)) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_POLICY_ID_REQUIRED",
          "Atlas Policy pages must retain a stable Policy identity.",
          change.path,
        ),
      );
    }
    if (!/^\s*type: policy$/mu.test(change.content)) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_POLICY_TYPE_REQUIRED",
          "Atlas Policy pages must declare the Policy page type.",
          change.path,
        ),
      );
    }
    for (const [heading, code, message] of [
      [
        "Scope",
        "ATLAS_GOVERNANCE_POLICY_SCOPE_REQUIRED",
        "Atlas Policy pages must declare the workflows or operations they govern.",
      ],
      [
        "Evaluation",
        "ATLAS_GOVERNANCE_POLICY_EVALUATION_REQUIRED",
        "Atlas Policy pages must declare deterministic or semantic evaluation.",
      ],
      [
        "Consequence",
        "ATLAS_GOVERNANCE_POLICY_CONSEQUENCE_REQUIRED",
        "Atlas Policy pages must declare the consequence of violation.",
      ],
    ] as const) {
      if (!new RegExp(`^##\\s+${heading}\\b`, "imu").test(change.content)) {
        findings.push(finding(code, message, change.path));
      }
    }
    if (
      /\bExplore\b[^.\n]*\bgovern(?:ed|s|ance)?\b|\bgovern(?:ed|s|ance)?\b[^.\n]*\bExplore\b/iu.test(
        change.content,
      )
    ) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_POLICY_EXPLORE_FORBIDDEN",
          "Explore is descriptive context for traversal and is never governed by Atlas Policies.",
          change.path,
        ),
      );
    }
  }
  return Object.freeze(findings);
}

export function validateAtlasGovernanceChangeSet(
  state: AtlasGovernanceWorkflowState,
  request: AtlasGovernanceRequest,
): readonly Finding[] {
  const changeSet = request.changeSet;
  if (request.action === "verify") {
    return changeSet === undefined
      ? Object.freeze([])
      : Object.freeze([
          finding(
            "ATLAS_GOVERNANCE_VERIFY_IS_READ_ONLY",
            "Verification-only governance runs must not carry an Atlas Change Set.",
          ),
        ]);
  }
  if (request.action === "delete") {
    return Object.freeze([
      finding(
        "ATLAS_GOVERNANCE_DELETE_RETIRES_TRUTHS",
        "Principle deletion is not a product write primitive; retire or amend the Principle and reconcile dependents instead.",
      ),
    ]);
  }
  if (changeSet === undefined) {
    return Object.freeze([
      finding(
        "ATLAS_GOVERNANCE_CHANGE_SET_REQUIRED",
        "Governance maintenance requires a validated Atlas Change Set.",
      ),
    ]);
  }
  const findings: Finding[] = [];
  if (
    changeSet.targetHead !== state.targetHead ||
    changeSet.baseSnapshotDigest !== state.baseSnapshotDigest
  ) {
    findings.push(
      finding(
        "ATLAS_GOVERNANCE_CHANGE_SET_STALE",
        "Governance Atlas Change Set base does not match the current base snapshot.",
      ),
    );
  }
  for (const change of changeSet.changes) {
    if (!pathIsCanonicalAtlasPath(change.path)) {
      findings.push(
        finding(
          "ATLAS_GOVERNANCE_CHANGE_SET_PATH_INVALID",
          "Governance Atlas Change Sets may write only canonical .atlas paths.",
        ),
      );
    }
  }
  if (!changeSet.changes.some((change) => change.path === ".atlas/CHANGELOG.md")) {
    findings.push(
      finding(
        "ATLAS_GOVERNANCE_CHANGELOG_REQUIRED",
        "Successful governance proposals must append an operation-identified Atlas Changelog entry.",
      ),
    );
  } else if (
    !changeSet.changes
      .find((change) => change.path === ".atlas/CHANGELOG.md")
      ?.content.includes(state.operationId)
  ) {
    findings.push(
      finding(
        "ATLAS_GOVERNANCE_CHANGELOG_OPERATION_ID_REQUIRED",
        "Atlas Changelog entries for governance proposals must name the stable operation ID.",
        ".atlas/CHANGELOG.md",
      ),
    );
  }
  const existing: readonly CapturedAtlasFile[] = Object.freeze([]);
  findings.push(...validatePrincipleChangeSet(request, changeSet, existing));
  findings.push(...validatePolicyChangeSet(request, changeSet, existing));
  return Object.freeze(findings);
}

export function mergeGovernanceFindings(
  trustedFindings: readonly Finding[],
  suppliedFindings: readonly Finding[],
): readonly Finding[] {
  const merged: Finding[] = [...trustedFindings];
  for (const supplied of suppliedFindings) {
    const matchingTrusted = trustedFindings.find(
      (trusted) => trusted.code === supplied.code && trusted.path === supplied.path,
    );
    if (
      matchingTrusted !== undefined &&
      severityRank[supplied.severity] < severityRank[matchingTrusted.severity]
    ) {
      merged.push(
        finding(
          "ATLAS_GOVERNANCE_TRUSTED_FINDING_OVERRIDE_REJECTED",
          "Atlas-owned or model-supplied findings cannot suppress or downgrade trusted Findings.",
          supplied.path,
        ),
      );
      continue;
    }
    if (!supplied.attribution.trusted) merged.push(supplied);
  }
  return Object.freeze(
    merged.toSorted((left, right) => {
      const path = compareCodePoints(left.path, right.path);
      if (path !== 0) return path;
      return compareCodePoints(left.code, right.code);
    }),
  );
}

function validateResumeReceipts(
  state: AtlasGovernanceWorkflowState,
  changeSet: AtlasGovernanceChangeSet,
): readonly Finding[] {
  const digest = changeSetDigest(changeSet);
  const findings: Finding[] = [];
  const writeReceipt = receiptFor(state, "write-change-set");
  if (
    writeReceipt !== undefined &&
    (writeReceipt.changeSetDigest !== digest ||
      writeReceipt.writtenTree !== writeReceipt.receipt)
  ) {
    findings.push(
      finding(
        "ATLAS_GOVERNANCE_RESUME_CHANGE_SET_MISMATCH",
        "Atlas Governance resume receipts must be content-addressed to the current Atlas Change Set digest and written tree.",
      ),
    );
  }
  const commitReceipt = receiptFor(state, "commit-proposal");
  if (
    commitReceipt !== undefined &&
    (commitReceipt.changeSetDigest !== digest ||
      commitReceipt.commit !== commitReceipt.receipt)
  ) {
    findings.push(
      finding(
        "ATLAS_GOVERNANCE_RESUME_CHANGE_SET_MISMATCH",
        "Atlas Governance commit receipts must bind the current Atlas Change Set digest to the proposal commit OID.",
      ),
    );
  }
  const lintReceipt = receiptFor(state, "lint-proposal");
  if (
    lintReceipt !== undefined &&
    (lintReceipt.changeSetDigest !== digest ||
      lintReceipt.lintEvidenceCommit !== lintReceipt.receipt)
  ) {
    findings.push(
      finding(
        "ATLAS_GOVERNANCE_RESUME_CHANGE_SET_MISMATCH",
        "Atlas Governance Lint receipts must bind the current Atlas Change Set digest to the lint evidence commit.",
      ),
    );
  }
  if (
    commitReceipt !== undefined &&
    lintReceipt !== undefined &&
    (lintReceipt.lintEvidenceCommit ?? lintReceipt.receipt) !==
      (commitReceipt.commit ?? commitReceipt.receipt)
  ) {
    findings.push(
      finding(
        "ATLAS_GOVERNANCE_LINT_STAMP_STALE",
        "Atlas Governance refused to accept Lint evidence for a proposal commit different from the committed Atlas Change Set.",
      ),
    );
  }
  return Object.freeze(findings);
}

export function runAtlasGovernanceWorkflow(
  state: AtlasGovernanceWorkflowState,
  request: AtlasGovernanceRequest,
  runtime: AtlasGovernanceRuntime,
): AtlasGovernanceResult {
  let latestState = state;
  try {
    if (
      !isSafeGitBranchName(state.proposalBranch) ||
      !isSafeGitBranchName(state.targetBranch)
    ) {
      const findings = Object.freeze([
        finding(
          "ATLAS_GOVERNANCE_WORKFLOW_STATE_INVALID",
          "Atlas Governance workflow state names an unsafe branch.",
        ),
      ]);
      return result(
        state,
        request,
        "not-completed",
        "failed",
        {},
        findings,
        "Governance refused unsafe workflow state before mutating.",
      );
    }
    if (
      runtime.currentTargetHead() !== state.targetHead ||
      runtime.currentBaseSnapshotDigest() !== state.baseSnapshotDigest
    ) {
      const findings = Object.freeze([
        finding(
          "ATLAS_GOVERNANCE_BASE_SNAPSHOT_STALE",
          "Atlas Governance refused stale mutation because the target branch or base snapshot digest changed.",
        ),
      ]);
      return result(
        state,
        request,
        "not-completed",
        "failed",
        {},
        findings,
        "Governance requires a refreshed base snapshot before mutating.",
      );
    }

    const existing = runtime.existingAtlasFiles();
    const paths = capturedPathSet(existing, request.changeSet);
    const policyTargets = changedPolicyTargets(existing, request.changeSet);
    const changeSetFindings = validateAtlasGovernanceChangeSet(state, request);
    const correspondenceFindings = Object.freeze([
      ...validatePrincipleChangeSet(request, request.changeSet, existing),
      ...validatePolicyChangeSet(request, request.changeSet, existing),
    ]);
    const resumeFindings =
      request.action === "verify" || request.changeSet === undefined
        ? Object.freeze([])
        : validateResumeReceipts(state, request.changeSet);
    const findings = Object.freeze([
      ...validateApproval(request),
      ...changeSetFindings,
      ...correspondenceFindings,
      ...validateSemanticVerdicts(request, paths, policyTargets),
      ...resumeFindings,
    ]);
    if (!canContinue(findings)) {
      return result(
        state,
        request,
        "not-completed",
        "failed",
        request.changeSet === undefined ? {} : { changeSet: request.changeSet },
        findings,
        "Governance maintenance is blocked by validation Findings.",
      );
    }

    if (request.action === "verify") {
      const linted = runtime.lintProposal();
      return result(
        state,
        request,
        linted.lint.completion === "completed" && linted.lint.disposition === "success"
          ? "completed"
          : "not-completed",
        linted.lint.disposition,
        { lint: linted.lint },
        linted.lint.handoff.validationState.findings,
        linted.lint.disposition === "success"
          ? "Governance verification completed without creating a proposal."
          : "Governance verification did not pass Lint.",
      );
    }

    const digest = changeSetDigest(request.changeSet as AtlasGovernanceChangeSet);
    let nextState = state;
    if (
      receiptFor(nextState, "create-proposal-worktree") === undefined &&
      runtime.workspaceExists?.() === true
    ) {
      const workspaceFindings = Object.freeze([
        finding(
          "ATLAS_GOVERNANCE_WORKSPACE_EXISTS",
          "Atlas Governance found an existing proposal branch or Operation Workspace before creating a new proposal.",
        ),
      ]);
      return result(
        nextState,
        request,
        "not-completed",
        "failed",
        {},
        workspaceFindings,
        "Governance refused to overwrite an existing Operation Workspace.",
      );
    }
    if (
      receiptFor(nextState, "create-proposal-worktree") === undefined &&
      runtime.workspacePathValid?.() === false
    ) {
      const workspaceFindings = Object.freeze([
        finding(
          "ATLAS_GOVERNANCE_WORKSPACE_PATH_INVALID",
          "Atlas Governance refused an Operation Workspace path that escapes the Atlas Host Directory.",
        ),
      ]);
      return result(
        nextState,
        request,
        "not-completed",
        "failed",
        {},
        workspaceFindings,
        "Governance refused to create an Operation Workspace outside the Atlas Host Directory.",
      );
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
    if (receiptFor(nextState, "write-change-set") === undefined) {
      const written = runtime.writeChangeSet(
        request.changeSet as AtlasGovernanceChangeSet,
      );
      nextState = addReceipt(nextState, {
        changeSetDigest: digest,
        effect: "write-change-set",
        receipt: written.receipt,
        writtenTree: written.receipt,
      });
      latestState = nextState;
      runtime.persistState?.(nextState);
    }
    let commit = receiptFor(nextState, "commit-proposal")?.commit;
    if (commit === undefined) {
      const committed = runtime.commitProposal();
      commit = committed.commit;
      nextState = addReceipt(nextState, {
        changeSetDigest: digest,
        commit: committed.commit,
        effect: "commit-proposal",
        receipt: committed.commit,
      });
      latestState = nextState;
      runtime.persistState?.(nextState);
    }
    const linted = runtime.lintProposal();
    if (receiptFor(nextState, "lint-proposal") === undefined) {
      nextState = addReceipt(nextState, {
        changeSetDigest: digest,
        commit,
        effect: "lint-proposal",
        lintEvidenceCommit: linted.receipt,
        receipt: linted.receipt,
      });
      latestState = nextState;
      runtime.persistState?.(nextState);
    }
    const acceptedChangeSet = request.changeSet as AtlasGovernanceChangeSet;
    if (
      linted.lint.completion !== "completed" ||
      linted.lint.disposition !== "success"
    ) {
      return result(
        nextState,
        request,
        "not-completed",
        "failed",
        { changeSet: acceptedChangeSet, lint: linted.lint },
        linted.lint.handoff.validationState.findings,
        "Governance proposal did not pass trusted Lint.",
      );
    }
    if (linted.receipt !== commit) {
      const stampFindings = Object.freeze([
        finding(
          "ATLAS_GOVERNANCE_LINT_STAMP_STALE",
          "Atlas Governance refused to stamp a proposal commit different from the Lint evidence commit.",
        ),
      ]);
      return result(
        nextState,
        request,
        "not-completed",
        "failed",
        { changeSet: acceptedChangeSet, lint: linted.lint },
        stampFindings,
        "Governance refused a stale Lint Stamp.",
      );
    }
    return result(
      nextState,
      request,
      "completed",
      "success",
      { changeSet: acceptedChangeSet, lint: linted.lint },
      Object.freeze([]),
      "Governance maintenance produced a Linted Atlas Proposal.",
    );
  } catch {
    const findings = Object.freeze([
      finding(
        "ATLAS_GOVERNANCE_RUNTIME_FAILED",
        "Atlas Governance runtime failed before the operation completed.",
      ),
    ]);
    return result(
      latestState,
      request,
      "not-completed",
      "failed",
      {},
      findings,
      "Governance maintenance did not complete.",
    );
  }
}
