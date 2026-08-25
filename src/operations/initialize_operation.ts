import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { parseAtlasPage } from "../atlas/parse_atlas_pages.ts";
import { sha256Hex } from "../atlas/sha256.ts";
import {
  composeDirective,
  parseAtlasDirectiveSpecialization,
  sdkBaselineDirectives,
  validateDirectiveComposition,
  type AtlasDirectiveSpecialization,
} from "../domain/agent_directive.ts";
import {
  validateAgentComposition,
  type AgentComposition,
} from "../domain/agent_composition.ts";
import {
  parseAgentPersonaDesignRequest,
  validateAgentPersona,
  validatePersonaActivation,
  validatePersonaApproval,
  type AgentPersona,
  type AgentPersonaDesignRequest,
} from "../domain/agent_persona.ts";
import { atlasChangelogPath, renderAtlasChangelog } from "../domain/atlas_changelog.ts";
import {
  checkpointInputDigest,
  foundingCapabilityIds,
  foundingCheckpointDependencies,
  invalidateDependentCheckpoints,
  type FoundingCheckpoint,
  type FoundingCheckpointId,
} from "../domain/founding_checkpoint.ts";
import type { Finding } from "../domain/finding.ts";
import {
  generateHostIntegrationPointers,
  validateHostIntegrationChangeSet,
  type HostIntegrationPointer,
} from "../domain/host_integration.ts";
import type { VirtualAtlasView } from "../domain/virtual_atlas_view.ts";
import {
  applyVirtualAtlasChanges,
  createVirtualAtlasView,
  virtualAtlasTextFiles,
} from "./virtual_atlas_view.ts";
import {
  prepareGovernanceFragment,
  type AtlasGovernanceRequest,
} from "./governance_operation.ts";
import { prepareIngestFragment, type AtlasIngestRequest } from "./ingest_operation.ts";
import { isSafeGitBranchName as isSafeGitBranchNameShared } from "./operation_support.ts";
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
  readonly foundingCheckpoints?: readonly FoundingCheckpoint[];
  readonly proposalBranch: string;
  readonly targetBranch: string;
  readonly targetHead: string;
}

export interface AtlasFoundingAnchorRequest {
  readonly anchorId: string;
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly citedSources: readonly string[];
  readonly namedPaths: readonly {
    readonly label: string;
    readonly targetConceptId: string;
  }[];
  readonly orientation: string;
  readonly title: string;
}

export interface AtlasFoundingRequest {
  readonly anchors?: readonly AtlasFoundingAnchorRequest[];
  readonly directiveSpecialization?: AtlasDirectiveSpecialization;
  readonly governance?: readonly AtlasGovernanceRequest[];
  readonly hostIntegration?: {
    readonly skills: readonly string[];
  };
  readonly ingest?: AtlasIngestRequest;
  readonly persona?: AgentPersonaDesignRequest;
  readonly sitePolicy?: {
    readonly approvedAt?: string;
    readonly approvedBy?: string;
    readonly enabled: boolean;
  };
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
  readonly capabilities?: readonly {
    readonly evidence: readonly string[];
    readonly id: FoundingCheckpointId;
    readonly selected: boolean;
    readonly status: "blocked" | "complete" | "declined" | "degraded";
  }[];
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
  readonly unresolvedDecisions?: readonly string[];
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

function finding(
  code: string,
  message: string,
  path = ".atlas",
  severity: Finding["severity"] = "error",
): Finding {
  return Object.freeze({
    attribution: commandAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function foreignKeyFindings(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  code: string,
  message: string,
): readonly Finding[] {
  const extra = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  return extra.length === 0
    ? Object.freeze([])
    : Object.freeze([finding(code, `${message} Forbidden keys: ${extra.join(", ")}.`)]);
}

const foundingRequestKeys = Object.freeze([
  "anchors",
  "directiveSpecialization",
  "governance",
  "hostIntegration",
  "ingest",
  "persona",
  "sitePolicy",
] as const);

const hostIntegrationKeys = Object.freeze(["skills"] as const);
const sitePolicyKeys = Object.freeze(["approvedAt", "approvedBy", "enabled"] as const);
const foundingAnchorKeys = Object.freeze([
  "anchorId",
  "approvedAt",
  "approvedBy",
  "citedSources",
  "namedPaths",
  "orientation",
  "title",
] as const);
const namedPathKeys = Object.freeze(["label", "targetConceptId"] as const);

function parseAtlasFoundingRequest(value: unknown): {
  readonly findings: readonly Finding[];
  readonly request?: AtlasFoundingRequest;
} {
  if (!isRecord(value)) {
    return Object.freeze({
      findings: Object.freeze([
        finding(
          "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
          "Founding request input must be an object with only the supported own properties.",
        ),
      ]),
    });
  }
  const findings: Finding[] = [
    ...foreignKeyFindings(
      value,
      foundingRequestKeys,
      "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
      "Founding request input contains unsupported keys.",
    ),
  ];

  let persona: AgentPersonaDesignRequest | undefined;
  if (value["persona"] !== undefined) {
    const parsed = parseAgentPersonaDesignRequest(value["persona"]);
    findings.push(...parsed.findings);
    persona = parsed.request;
  }

  let directiveSpecialization: AtlasDirectiveSpecialization | undefined;
  if (value["directiveSpecialization"] !== undefined) {
    const parsed = parseAtlasDirectiveSpecialization(value["directiveSpecialization"]);
    findings.push(...parsed.findings);
    directiveSpecialization = parsed.specialization;
  }

  if (value["hostIntegration"] !== undefined && !isRecord(value["hostIntegration"])) {
    findings.push(
      finding(
        "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
        "Host Integration input must be an object containing only a skills array.",
      ),
    );
  }
  if (isRecord(value["hostIntegration"])) {
    findings.push(
      ...foreignKeyFindings(
        value["hostIntegration"],
        hostIntegrationKeys,
        "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
        "Host Integration input contains unsupported keys.",
      ),
    );
  }

  if (value["sitePolicy"] !== undefined && !isRecord(value["sitePolicy"])) {
    findings.push(
      finding(
        "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
        "Atlas Site policy input must be an object with enabled and optional approval fields.",
      ),
    );
  }
  if (isRecord(value["sitePolicy"])) {
    findings.push(
      ...foreignKeyFindings(
        value["sitePolicy"],
        sitePolicyKeys,
        "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
        "Atlas Site policy input contains unsupported keys.",
      ),
    );
  }

  const anchorRequests: AtlasFoundingAnchorRequest[] = [];
  if (value["anchors"] !== undefined) {
    if (!Array.isArray(value["anchors"])) {
      findings.push(
        finding(
          "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
          "Founding Anchor input must be an array of approved Anchor requests.",
        ),
      );
    } else {
      for (const entry of value["anchors"]) {
        if (!isRecord(entry)) {
          findings.push(
            finding(
              "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
              "Each Founding Anchor request must be an object with only the supported own properties.",
            ),
          );
          continue;
        }
        findings.push(
          ...foreignKeyFindings(
            entry,
            foundingAnchorKeys,
            "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
            "Founding Anchor input contains unsupported keys.",
          ),
        );
        const namedPaths = Array.isArray(entry["namedPaths"])
          ? entry["namedPaths"]
          : [];
        for (const namedPath of namedPaths) {
          if (!isRecord(namedPath)) {
            findings.push(
              finding(
                "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
                "Named Anchor paths must be objects with only label and targetConceptId.",
              ),
            );
            continue;
          }
          findings.push(
            ...foreignKeyFindings(
              namedPath,
              namedPathKeys,
              "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
              "Named Anchor paths contain unsupported keys.",
            ),
          );
        }
        anchorRequests.push(
          Object.freeze({
            anchorId: stringOrEmpty(entry["anchorId"]),
            approvedAt: stringOrEmpty(entry["approvedAt"]),
            approvedBy: stringOrEmpty(entry["approvedBy"]),
            citedSources: Object.freeze(
              Array.isArray(entry["citedSources"])
                ? entry["citedSources"].filter(
                    (source): source is string => typeof source === "string",
                  )
                : [],
            ),
            namedPaths: Object.freeze(
              namedPaths.map((namedPath) =>
                Object.freeze({
                  label: stringOrEmpty((namedPath as Record<string, unknown>)["label"]),
                  targetConceptId: stringOrEmpty(
                    (namedPath as Record<string, unknown>)["targetConceptId"],
                  ),
                }),
              ),
            ),
            orientation: stringOrEmpty(entry["orientation"]),
            title: stringOrEmpty(entry["title"]),
          }),
        );
      }
    }
  }

  if (findings.length > 0) {
    return Object.freeze({ findings: Object.freeze(findings) });
  }

  const request: AtlasFoundingRequest = Object.freeze({
    ...(anchorRequests.length === 0 ? {} : { anchors: Object.freeze(anchorRequests) }),
    ...(directiveSpecialization === undefined ? {} : { directiveSpecialization }),
    ...(Array.isArray(value["governance"])
      ? {
          governance: Object.freeze(
            value["governance"] as readonly AtlasGovernanceRequest[],
          ),
        }
      : {}),
    ...(isRecord(value["hostIntegration"])
      ? {
          hostIntegration: Object.freeze({
            skills: Object.freeze(
              Array.isArray(value["hostIntegration"]["skills"])
                ? value["hostIntegration"]["skills"].filter(
                    (skill): skill is string => typeof skill === "string",
                  )
                : [],
            ),
          }),
        }
      : {}),
    ...(isRecord(value["ingest"])
      ? { ingest: value["ingest"] as unknown as AtlasIngestRequest }
      : {}),
    ...(persona === undefined ? {} : { persona }),
    ...(isRecord(value["sitePolicy"])
      ? {
          sitePolicy: Object.freeze({
            ...(nonBlankString(value["sitePolicy"]["approvedAt"])
              ? { approvedAt: value["sitePolicy"]["approvedAt"] }
              : {}),
            ...(nonBlankString(value["sitePolicy"]["approvedBy"])
              ? { approvedBy: value["sitePolicy"]["approvedBy"] }
              : {}),
            enabled: Boolean(value["sitePolicy"]["enabled"]),
          }),
        }
      : {}),
  });
  return Object.freeze({ findings: Object.freeze([]), request });
}

function changePathCollisionKey(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.replace(/[. ]+$/u, ""))
    .join("/")
    .normalize("NFC")
    .toLowerCase();
}

export function validateNoChangePathCollisions(
  changes: readonly AtlasInitializationChange[],
): readonly Finding[] {
  const seen = new Map<string, string>();
  const findings: Finding[] = [];
  for (const change of changes) {
    const key = changePathCollisionKey(change.path);
    const prior = seen.get(key);
    if (prior !== undefined) {
      findings.push(
        finding(
          "ATLAS_FOUNDING_CHANGE_PATH_COLLISION",
          `Founding fragments may not emit colliding change paths: ${prior} and ${change.path}.`,
          change.path,
        ),
      );
      continue;
    }
    seen.set(key, change.path);
  }
  return Object.freeze(findings);
}

function clearFoundingMutationReceipts(
  state: AtlasInitializationWorkflowState,
): AtlasInitializationWorkflowState {
  return Object.freeze({
    ...state,
    effectReceipts: Object.freeze(
      state.effectReceipts.filter(
        (receipt) =>
          receipt.effect !== "write-change-set" &&
          receipt.effect !== "commit-proposal" &&
          receipt.effect !== "lint-proposal",
      ),
    ),
  });
}

function checkpointEvidenceDigest(
  changes: readonly AtlasInitializationChange[],
): string {
  return sha256Hex(
    changes.map((change) => `${change.path}\0${sha256Hex(change.content)}`).join("\0"),
  );
}

function selectedDirectiveCapability(request: AtlasFoundingRequest): boolean {
  return (
    request.directiveSpecialization !== undefined ||
    request.hostIntegration !== undefined
  );
}

function checkpointDependenciesForRequest(
  request: AtlasFoundingRequest,
): Readonly<Record<FoundingCheckpointId, readonly FoundingCheckpointId[]>> {
  return Object.freeze({
    anchor:
      request.anchors !== undefined
        ? foundingCheckpointDependencies.anchor
        : Object.freeze<readonly FoundingCheckpointId[]>([]),
    directive: Object.freeze<readonly FoundingCheckpointId[]>([]),
    governance: Object.freeze<readonly FoundingCheckpointId[]>([]),
    "host-integration": Object.freeze<readonly FoundingCheckpointId[]>([
      ...foundingCheckpointDependencies["host-integration"],
      ...(request.persona !== undefined ? (["persona"] as const) : []),
    ]),
    ingest: Object.freeze<readonly FoundingCheckpointId[]>([]),
    persona: Object.freeze<readonly FoundingCheckpointId[]>([]),
    site:
      request.sitePolicy !== undefined
        ? foundingCheckpointDependencies.site
        : Object.freeze<readonly FoundingCheckpointId[]>([]),
  });
}

function selectedCapabilities(
  request: AtlasFoundingRequest,
): ReadonlySet<FoundingCheckpointId> {
  return new Set<FoundingCheckpointId>([
    ...(request.persona === undefined ? [] : (["persona"] as const)),
    ...(selectedDirectiveCapability(request) ? (["directive"] as const) : []),
    ...(request.governance === undefined || request.governance.length === 0
      ? []
      : (["governance"] as const)),
    ...(request.ingest === undefined ? [] : (["ingest"] as const)),
    ...(request.anchors === undefined || request.anchors.length === 0
      ? []
      : (["anchor"] as const)),
    ...(request.sitePolicy === undefined ? [] : (["site"] as const)),
    ...(request.hostIntegration === undefined ? [] : (["host-integration"] as const)),
  ]);
}

function baseCheckpoints(request: AtlasFoundingRequest): readonly FoundingCheckpoint[] {
  const selected = selectedCapabilities(request);
  const dependencies = checkpointDependenciesForRequest(request);
  return Object.freeze(
    foundingCapabilityIds.map((id) =>
      Object.freeze({
        dependsOn: dependencies[id],
        id,
        status: selected.has(id) ? ("pending" as const) : ("skipped" as const),
      }),
    ),
  );
}

function replaceCheckpoint(
  checkpoints: readonly FoundingCheckpoint[],
  next: FoundingCheckpoint,
): readonly FoundingCheckpoint[] {
  return Object.freeze(
    checkpoints.map((checkpoint) => (checkpoint.id === next.id ? next : checkpoint)),
  );
}

function updateCheckpointCompletion(
  checkpoints: readonly FoundingCheckpoint[],
  id: FoundingCheckpointId,
  input: unknown,
  changes: readonly AtlasInitializationChange[],
): readonly FoundingCheckpoint[] {
  const existing = checkpoints.find((checkpoint) => checkpoint.id === id);
  if (existing === undefined) {
    throw new Error(
      `updateCheckpointCompletion: unknown founding checkpoint id "${id}".`,
    );
  }
  const dependsOn = existing.dependsOn;
  return replaceCheckpoint(
    checkpoints,
    Object.freeze({
      dependsOn,
      evidenceDigest: checkpointEvidenceDigest(changes),
      id,
      inputDigest: checkpointInputDigest(input),
      status: "complete" as const,
    }),
  );
}

function reconcileCheckpointInputs(
  state: AtlasInitializationWorkflowState,
  request: AtlasFoundingRequest,
): AtlasInitializationWorkflowState {
  let nextState: AtlasInitializationWorkflowState = Object.freeze({
    ...state,
    foundingCheckpoints: state.foundingCheckpoints ?? baseCheckpoints(request),
  });
  const checkpoints = nextState.foundingCheckpoints as readonly FoundingCheckpoint[];
  const selected = selectedCapabilities(request);
  const inputs = new Map<FoundingCheckpointId, unknown>([
    ["persona", request.persona],
    [
      "directive",
      request.directiveSpecialization ??
        Object.freeze({ role: "atlas-guide" as const }),
    ],
    ["governance", request.governance],
    ["ingest", request.ingest],
    ["anchor", request.anchors],
    ["site", request.sitePolicy],
    ["host-integration", request.hostIntegration],
  ]);
  let currentCheckpoints: readonly FoundingCheckpoint[] = checkpoints;
  for (const id of foundingCapabilityIds) {
    if (!selected.has(id)) {
      continue;
    }
    const checkpoint = currentCheckpoints.find((entry) => entry.id === id);
    if (checkpoint?.inputDigest === undefined) {
      continue;
    }
    const digest = checkpointInputDigest(inputs.get(id));
    if (checkpoint.inputDigest !== digest) {
      currentCheckpoints = replaceCheckpoint(
        invalidateDependentCheckpoints(currentCheckpoints, id),
        Object.freeze({
          dependsOn: checkpoint.dependsOn,
          id,
          status: "pending" as const,
        }),
      );
      nextState = clearFoundingMutationReceipts(
        Object.freeze({ ...nextState, foundingCheckpoints: currentCheckpoints }),
      );
    }
  }
  return Object.freeze({ ...nextState, foundingCheckpoints: currentCheckpoints });
}

function virtualAtlasIdsByType(
  view: VirtualAtlasView,
  type: string,
): ReadonlyMap<string, string> {
  const entries: [string, string][] = [];
  for (const file of virtualAtlasTextFiles(view)) {
    const parsed = parseAtlasPage(file);
    if (parsed instanceof Error) {
      continue;
    }
    if (parsed.page.sdk.type === type) {
      entries.push([parsed.page.sdk.id, file.path]);
    }
  }
  return new Map(entries);
}

function typedIdentifier(prefix: string, value: string): string {
  return `${prefix}:${value}`;
}

function renderTypedAtlasPage(input: {
  readonly atlas?: Record<string, unknown>;
  readonly body: readonly string[];
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly type: string;
}): AtlasInitializationChange {
  const atlasEntries = Object.entries(input.atlas ?? {});
  const atlasBlock =
    atlasEntries.length === 0
      ? "atlas: {}"
      : [
          "atlas:",
          ...atlasEntries.map(([key, value]) =>
            Array.isArray(value)
              ? `  ${key}: [${value.map((entry) => JSON.stringify(entry)).join(", ")}]`
              : `  ${key}: ${JSON.stringify(value)}`,
          ),
        ].join("\n");
  return Object.freeze({
    content: [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      '  created-at: "2026-01-01T00:00:00Z"',
      "  created-by:",
      "    kind: agent",
      "    name: Atlas SDK",
      `  id: ${input.id}`,
      "  local-atlas-schema: 1.0.0",
      `  originating-operation: ${minimalAtlasInitializationOperationId}`,
      "  tags: []",
      `  title: ${input.title}`,
      `  type: ${input.type}`,
      '  updated-at: "2026-01-01T00:00:00Z"',
      "  updated-by:",
      "    kind: agent",
      "    name: Atlas SDK",
      atlasBlock,
      "---",
      "",
      ...input.body,
      "",
    ].join("\n"),
    path: input.path,
  });
}

function preparePersonaFragment(request: AgentPersonaDesignRequest): {
  readonly changes: readonly AtlasInitializationChange[];
  readonly findings: readonly Finding[];
  readonly persona: AgentPersona;
} {
  const findings = Object.freeze([
    ...validateAgentPersona(request.proposed),
    ...validatePersonaApproval(request),
    ...validatePersonaActivation(request),
  ]);
  const persona: AgentPersona = Object.freeze({
    approvedAt: request.approvedAt ?? "",
    approvedBy: request.approvedBy ?? "",
    ...request.proposed,
  });
  const changes = Object.freeze([
    renderTypedAtlasPage({
      body: [`# ${persona.name}`, "", persona.voice],
      id: typedIdentifier("persona", persona.personaId),
      path: `.atlas/types/persona/${persona.personaId}.md`,
      title: persona.name,
      type: "persona",
    }),
    renderTypedAtlasPage({
      atlas: {
        activationConfirmedAt: request.activationConfirmedAt ?? "",
        activationConfirmedBy: request.activationConfirmedBy ?? "",
        persona: persona.personaId,
      },
      body: [
        `# ${persona.name} Persona Design`,
        "",
        "Approval and activation were recorded separately for this Agent Persona.",
      ],
      id: typedIdentifier("persona-design", persona.personaId),
      path: `.atlas/types/persona-design/${persona.personaId}.md`,
      title: `${persona.name} Persona Design`,
      type: "persona-design",
    }),
  ]);
  return Object.freeze({ changes, findings, persona });
}

function prepareDirectiveFragment(input: {
  readonly persona?: AgentPersona;
  readonly specialization?: AtlasDirectiveSpecialization;
}): {
  readonly changes: readonly AtlasInitializationChange[];
  readonly composition: AgentComposition;
  readonly findings: readonly Finding[];
} {
  const baseline = sdkBaselineDirectives["atlas-guide"];
  const findings = Object.freeze(
    validateDirectiveComposition(baseline, input.specialization),
  );
  const directive = composeDirective(baseline, input.specialization);
  const composition: AgentComposition = Object.freeze({
    directives: Object.freeze([directive]),
    ...(input.persona === undefined ? {} : { persona: input.persona }),
  });
  const compositionFindings = validateAgentComposition(composition);
  const changes = Object.freeze([
    renderTypedAtlasPage({
      atlas: {
        allowedActions: directive.allowedActions,
        constraints: directive.constraints,
        requiredHandoffs: directive.requiredHandoffs,
        responsibilities: directive.responsibilities,
      },
      body: [
        "# Atlas Guide Directive",
        "",
        ...directive.objectives.map((objective) => `- ${objective}`),
      ],
      id: typedIdentifier("directive", directive.role),
      path: `.atlas/types/directive/${directive.role}.md`,
      title: "Atlas Guide Directive",
      type: "directive",
    }),
    renderTypedAtlasPage({
      atlas: {
        directives: directive.role,
        persona: input.persona?.personaId ?? null,
      },
      body: [
        "# Atlas Guide Composition",
        "",
        input.persona === undefined
          ? "The Atlas Guide uses Directive-only composition."
          : `The Atlas Guide pairs Persona ${input.persona.personaId} with the authoritative Directive.`,
      ],
      id: typedIdentifier("agent-composition", "atlas-guide"),
      path: ".atlas/types/agent-composition/atlas-guide.md",
      title: "Atlas Guide Composition",
      type: "agent-composition",
    }),
  ]);
  return Object.freeze({
    changes,
    composition,
    findings: Object.freeze([...findings, ...compositionFindings]),
  });
}

function prepareAnchorFragment(
  request: AtlasFoundingAnchorRequest,
  virtualAtlas: VirtualAtlasView,
): {
  readonly changes: readonly AtlasInitializationChange[];
  readonly findings: readonly Finding[];
} {
  const findings: Finding[] = [];
  const sources = new Set(virtualAtlasIdsByType(virtualAtlas, "source").values());
  const concepts = new Set(virtualAtlasIdsByType(virtualAtlas, "concept").keys());
  if (
    !nonBlankString(request.anchorId) ||
    !nonBlankString(request.title) ||
    !nonBlankString(request.orientation)
  ) {
    findings.push(
      finding(
        "ATLAS_FOUNDING_ANCHOR_UNRESOLVED_REFERENCE",
        "Founding Anchor requests require non-blank anchorId, title, and orientation.",
      ),
    );
  }
  if (!nonBlankString(request.approvedBy) || !nonBlankString(request.approvedAt)) {
    findings.push(
      finding(
        "ATLAS_FOUNDING_ANCHOR_UNRESOLVED_REFERENCE",
        "Founding Anchor requests require explicit human approval before they are written.",
      ),
    );
  }
  for (const source of request.citedSources) {
    if (!sources.has(source)) {
      findings.push(
        finding(
          "ATLAS_FOUNDING_ANCHOR_UNRESOLVED_REFERENCE",
          `Founding Anchor cited Source ${source} does not resolve in the virtual Atlas view.`,
        ),
      );
    }
  }
  for (const namedPath of request.namedPaths) {
    if (!concepts.has(namedPath.targetConceptId)) {
      findings.push(
        finding(
          "ATLAS_FOUNDING_ANCHOR_UNRESOLVED_REFERENCE",
          `Founding Anchor target Concept ${namedPath.targetConceptId} does not resolve in the virtual Atlas view.`,
        ),
      );
    }
  }
  const slug = request.anchorId.replace(/^anchor:/u, "");
  return Object.freeze({
    changes: Object.freeze([
      renderTypedAtlasPage({
        atlas: {
          citedSources: request.citedSources,
          namedPaths: request.namedPaths.map((namedPath) => namedPath.targetConceptId),
        },
        body: [
          `# ${request.title}`,
          "",
          request.orientation,
          "",
          ...request.namedPaths.map(
            (namedPath) => `- ${namedPath.label}: ${namedPath.targetConceptId}`,
          ),
        ],
        id: request.anchorId,
        path: `.atlas/anchors/${slug}.md`,
        title: request.title,
        type: "anchor",
      }),
    ]),
    findings: Object.freeze(findings),
  });
}

function prepareSiteFragment(
  sitePolicy: NonNullable<AtlasFoundingRequest["sitePolicy"]>,
  virtualAtlas: VirtualAtlasView,
): {
  readonly changes: readonly AtlasInitializationChange[];
  readonly findings: readonly Finding[];
} {
  if (!sitePolicy.enabled) {
    return Object.freeze({ changes: Object.freeze([]), findings: Object.freeze([]) });
  }
  const request: AtlasGovernanceRequest = Object.freeze({
    "governance-request-schema": "1.0.0",
    action: "create",
    ...(sitePolicy.approvedAt === undefined
      ? {}
      : { approvedAt: sitePolicy.approvedAt }),
    ...(sitePolicy.approvedBy === undefined
      ? {}
      : { approvedBy: sitePolicy.approvedBy }),
    changes: Object.freeze([
      renderTypedAtlasPage({
        body: [
          "# Atlas Site Policy",
          "",
          "## Scope",
          "",
          "Atlas Site publication is governed here.",
          "",
          "## Evaluation",
          "",
          "Deterministic evaluation is required before publication.",
          "",
          "## Consequence",
          "",
          "Violations block only Atlas Site publication.",
        ],
        id: typedIdentifier("policy", "atlas-site"),
        path: ".atlas/types/policy/atlas-site.md",
        title: "Atlas Site Policy",
        type: "policy",
      }),
    ]),
    semanticVerdicts: Object.freeze([
      Object.freeze({
        challenge: Object.freeze({
          argument: "The Atlas Site policy remains internally consistent.",
          evidence: Object.freeze([".atlas/index.md#L1"]),
          position: "agree" as const,
        }),
        evidence: Object.freeze([".atlas/index.md#L1"]),
        policyId: typedIdentifier("policy", "atlas-site"),
        verdict: "pass" as const,
      }),
    ]),
    subject: "atlas-policy",
  });
  const prepared = prepareGovernanceFragment(request, virtualAtlas);
  return Object.freeze({
    changes: prepared.changes,
    findings: prepared.findings,
  });
}

function prepareHostIntegrationFragment(input: {
  readonly composition: AgentComposition;
  readonly skills: readonly string[];
}): {
  readonly changes: readonly AtlasInitializationChange[];
  readonly findings: readonly Finding[];
  readonly pointers: readonly HostIntegrationPointer[];
} {
  const pointers = generateHostIntegrationPointers(input.composition, input.skills);
  const changes = Object.freeze(
    pointers.map((pointer) =>
      Object.freeze({
        content: `${JSON.stringify(pointer, null, 2)}\n`,
        path: pointer.targetPath,
      }),
    ),
  );
  return Object.freeze({
    changes,
    findings: validateHostIntegrationChangeSet(changes),
    pointers,
  });
}

function composedChangelog(
  state: AtlasInitializationWorkflowState,
  request: AtlasFoundingRequest,
): AtlasInitializationChange {
  const selected = [...selectedCapabilities(request)];
  const summary =
    selected.length === 0
      ? "Initialized minimal Home Atlas."
      : `Initialized founding Home Atlas with ${selected.join(", ")}.`;
  return Object.freeze({
    content: renderAtlasChangelog(
      undefined,
      "2026-01-01",
      minimalAtlasInitializationOperationId,
      summary,
    ),
    path: atlasChangelogPath,
  });
}

export function foundingCapabilityStatus(
  selectedCapability: boolean,
  checkpoint: FoundingCheckpoint | undefined,
): "blocked" | "complete" | "declined" | "degraded" {
  return !selectedCapability
    ? "declined"
    : checkpoint?.status === "complete"
      ? "complete"
      : checkpoint?.status === "pending"
        ? "blocked"
        : "degraded";
}

function composedReadinessReport(input: {
  readonly checkpoints: readonly FoundingCheckpoint[];
  readonly lintStamp: LintStamp;
  readonly request: AtlasFoundingRequest;
}): AtlasReadinessReport {
  const selected = selectedCapabilities(input.request);
  return Object.freeze({
    boundary: "The Home Atlas boundary is the repository root Atlas Host Directory.",
    capabilities: Object.freeze(
      foundingCapabilityIds.map((id) => {
        const checkpoint = input.checkpoints.find((entry) => entry.id === id);
        const selectedCapability = selected.has(id);
        return Object.freeze({
          evidence:
            checkpoint?.evidenceDigest === undefined
              ? Object.freeze([])
              : Object.freeze([checkpoint.evidenceDigest]),
          id,
          selected: selectedCapability,
          status: foundingCapabilityStatus(selectedCapability, checkpoint),
        });
      }),
    ),
    degradation:
      "No degraded dependency was needed for local, non-forge founding Initialization.",
    evidence:
      "Founding evidence was preflight-validated in memory before a single proposal worktree was created.",
    foundingGraph:
      "Founding capabilities composed into one Atlas Proposal with one Atlas Changelog entry and one Lint Stamp.",
    governance:
      selected.has("governance") || selected.has("site")
        ? "Governance fragments were validated before write and folded into the founding proposal."
        : "No founding governance fragment was selected.",
    guide: selected.has("persona")
      ? "The Atlas Guide has an approved Persona and authoritative Directive composition."
      : selected.has("directive")
        ? "The Atlas Guide uses authoritative Directive composition without a Persona."
        : "No Guide Persona or Directive composition was selected.",
    integration: selected.has("host-integration")
      ? "Host Integration emitted only thin pointer records to canonical Atlas artifacts."
      : "No Host Integration pointer layer was selected.",
    lintStamp: input.lintStamp,
    nextAction:
      "Review and publish the local proposal branch, then merge through Git governance.",
    publicationHandoff:
      "Forge publication was not requested; push the proposal branch and open a pull request with the readiness report.",
    uninspectedAreas:
      "No forge remotes were inspected, and omitted founding capabilities remain intentionally declined.",
    unresolvedDecisions: Object.freeze([]),
  });
}

// The stable operation ID Initialization stamps on every file it emits,
// matching the Root Anchor's `originating-operation` literal above. Minimal
// Initialization is otherwise fully hardcoded (tracked separately by #159 and
// #161), so this identity is a fixed constant rather than derived per run.
const minimalAtlasInitializationOperationId = "atlas-initialization";

function minimalAtlasChangeSet(
  state: AtlasInitializationWorkflowState,
): AtlasInitializationChangeSet {
  const rootAnchor = `---\nsdk:\n  atlas-sdk-schema: 1.0.0\n  created-at: "2026-01-01T00:00:00Z"\n  created-by:\n    kind: agent\n    name: Atlas SDK\n  id: anchor:root\n  local-atlas-schema: 1.0.0\n  originating-operation: atlas-initialization\n  tags: []\n  title: Home Atlas\n  type: anchor\n  updated-at: "2026-01-01T00:00:00Z"\n  updated-by:\n    kind: agent\n    name: Atlas SDK\natlas: {}\n---\n\n# Home Atlas\n\nThis Root Anchor starts a minimal Home Atlas with no Guide Persona, founding knowledge, or Atlas Site.\n`;
  const changelog = Object.freeze({
    content: renderAtlasChangelog(
      undefined,
      "2026-01-01",
      minimalAtlasInitializationOperationId,
      "Initialized minimal Home Atlas.",
    ),
    path: atlasChangelogPath,
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

export function runComposedAtlasInitializationWorkflow(
  state: AtlasInitializationWorkflowState,
  rawRequest: unknown,
  runtime: AtlasInitializationRuntime,
): AtlasInitializationResult {
  const parsed = parseAtlasFoundingRequest(rawRequest);
  if (parsed.request === undefined) {
    return result(
      state,
      "not-completed",
      "failed",
      {},
      parsed.findings,
      "Founding Initialization refused invalid composed input before any write.",
    );
  }
  const request = parsed.request;
  let nextState = reconcileCheckpointInputs(state, request);
  const minimal = minimalAtlasChangeSet(nextState);
  let virtualAtlas = createVirtualAtlasView(
    minimal.changes.filter((change) => change.path !== atlasChangelogPath),
  );
  let checkpoints = nextState.foundingCheckpoints as readonly FoundingCheckpoint[];
  const findings: Finding[] = [];
  const fragmentChanges: AtlasInitializationChange[] = [];

  let persona: AgentPersona | undefined;
  if (request.persona !== undefined) {
    const prepared = preparePersonaFragment(request.persona);
    findings.push(...prepared.findings);
    if (prepared.findings.length === 0) {
      persona = prepared.persona;
      fragmentChanges.push(...prepared.changes);
      virtualAtlas = applyVirtualAtlasChanges(virtualAtlas, prepared.changes);
      checkpoints = updateCheckpointCompletion(
        checkpoints,
        "persona",
        request.persona,
        prepared.changes,
      );
    }
  }

  let composition: AgentComposition | undefined;
  if (selectedDirectiveCapability(request)) {
    const prepared = prepareDirectiveFragment({
      ...(persona === undefined ? {} : { persona }),
      ...(request.directiveSpecialization === undefined
        ? {}
        : { specialization: request.directiveSpecialization }),
    });
    findings.push(...prepared.findings);
    if (prepared.findings.length === 0) {
      composition = prepared.composition;
      fragmentChanges.push(...prepared.changes);
      virtualAtlas = applyVirtualAtlasChanges(virtualAtlas, prepared.changes);
      checkpoints = updateCheckpointCompletion(
        checkpoints,
        "directive",
        request.directiveSpecialization ??
          Object.freeze({ role: "atlas-guide" as const }),
        prepared.changes,
      );
    }
  }

  if (request.governance !== undefined && request.governance.length > 0) {
    const changes: AtlasInitializationChange[] = [];
    for (const governance of request.governance) {
      const prepared = prepareGovernanceFragment(governance, virtualAtlas);
      findings.push(...prepared.findings);
      changes.push(...prepared.changes);
    }
    if (changes.length > 0 && findings.length === 0) {
      fragmentChanges.push(...changes);
      virtualAtlas = applyVirtualAtlasChanges(virtualAtlas, changes);
      checkpoints = updateCheckpointCompletion(
        checkpoints,
        "governance",
        request.governance,
        changes,
      );
    }
  }

  if (request.ingest !== undefined) {
    const prepared = prepareIngestFragment(request.ingest, virtualAtlas);
    findings.push(...prepared.findings);
    if (prepared.findings.length === 0) {
      fragmentChanges.push(...prepared.changes);
      virtualAtlas = applyVirtualAtlasChanges(virtualAtlas, prepared.changes);
      checkpoints = updateCheckpointCompletion(
        checkpoints,
        "ingest",
        request.ingest,
        prepared.changes,
      );
    }
  }

  if (request.anchors !== undefined && request.anchors.length > 0) {
    const changes: AtlasInitializationChange[] = [];
    for (const anchor of request.anchors) {
      const prepared = prepareAnchorFragment(anchor, virtualAtlas);
      findings.push(...prepared.findings);
      changes.push(...prepared.changes);
    }
    if (changes.length > 0 && findings.length === 0) {
      fragmentChanges.push(...changes);
      virtualAtlas = applyVirtualAtlasChanges(virtualAtlas, changes);
      checkpoints = updateCheckpointCompletion(
        checkpoints,
        "anchor",
        request.anchors,
        changes,
      );
    }
  }

  if (request.sitePolicy !== undefined) {
    const prepared = prepareSiteFragment(request.sitePolicy, virtualAtlas);
    findings.push(...prepared.findings);
    if (prepared.changes.length > 0 && findings.length === 0) {
      fragmentChanges.push(...prepared.changes);
    }
    checkpoints = updateCheckpointCompletion(
      checkpoints,
      "site",
      request.sitePolicy,
      prepared.changes,
    );
  }

  if (request.hostIntegration !== undefined && composition !== undefined) {
    const prepared = prepareHostIntegrationFragment({
      composition,
      skills: request.hostIntegration.skills,
    });
    findings.push(...prepared.findings);
    if (prepared.findings.length === 0) {
      fragmentChanges.push(...prepared.changes);
      checkpoints = updateCheckpointCompletion(
        checkpoints,
        "host-integration",
        request.hostIntegration,
        prepared.changes,
      );
    }
  }

  const mergedChanges = Object.freeze([
    ...minimal.changes.filter((change) => change.path !== atlasChangelogPath),
    ...fragmentChanges,
    composedChangelog(nextState, request),
  ]);
  findings.push(...validateNoChangePathCollisions(mergedChanges));
  nextState = Object.freeze({ ...nextState, foundingCheckpoints: checkpoints });
  if (findings.length > 0) {
    return result(
      nextState,
      "not-completed",
      "failed",
      {},
      Object.freeze(findings),
      "Founding Initialization failed preflight validation before creating a proposal worktree.",
    );
  }

  const changeSet: AtlasInitializationChangeSet = Object.freeze({
    baseSnapshotDigest: nextState.baseSnapshotDigest,
    changes: Object.freeze(
      [...mergedChanges].toSorted((left, right) =>
        compareCodePoints(left.path, right.path),
      ),
    ),
    targetHead: nextState.targetHead,
  });
  const underlying = runAtlasInitializationWorkflow(nextState, {
    ...runtime,
    changeSet: () => changeSet,
  });
  if (
    underlying.completion === "completed" &&
    underlying.disposition === "success" &&
    underlying.payload.atlasReadinessReport !== undefined
  ) {
    return Object.freeze({
      ...underlying,
      payload: Object.freeze({
        ...underlying.payload,
        atlasReadinessReport: composedReadinessReport({
          checkpoints: underlying.payload.workflowState
            .foundingCheckpoints as readonly FoundingCheckpoint[],
          lintStamp: underlying.payload.atlasReadinessReport.lintStamp,
          request,
        }),
      }),
    });
  }
  return underlying;
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
