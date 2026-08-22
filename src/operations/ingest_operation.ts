import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
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

// Atlas SDK never invokes a model (docs/adr/0001-sdk-is-a-deterministic-library.md).
// Ingest hands a typed Ingest Scope out to a Markdown workflow, which dispatches
// read-only Crawlers, and accepts one Candidate Graph back as validated input.
// This module owns only the deterministic half: the input it hands out, the
// exact Candidate Graph shape it accepts back, the correspondence that returned
// graph must survive, and the one deterministic reconciliation into an Atlas
// Change Set. No crawling, network, model, or subagent dispatch happens here.

export type SourceAuthority = "official" | "first-party" | "community" | "opinion";

const authorityRank: Readonly<Record<SourceAuthority, number>> = Object.freeze({
  community: 2,
  "first-party": 3,
  official: 4,
  opinion: 1,
});

function isSourceAuthority(value: string): value is SourceAuthority {
  return value === "official" || value === "first-party" || value === "community"
    ? true
    : value === "opinion";
}

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
  readonly principleTruthId: string;
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
  readonly citation: AtlasIngestCandidateCitation;
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
  readonly effect:
    | "create-proposal-worktree"
    | "write-change-set"
    | "commit-proposal"
    | "lint-proposal";
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

export type AtlasIngestResult = OperationResult<
  AtlasIngestOperationIdentity,
  AtlasIngestHandoff,
  AtlasIngestPayload
>;

export interface AtlasIngestRuntime {
  readonly commitProposal: () => { readonly commit: string; readonly receipt: string };
  readonly createProposalWorktree: () => { readonly receipt: string };
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

const ingestOperation: AtlasIngestOperationIdentity = Object.freeze({
  kind: "ingest",
  subject: "repository-source",
});

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.atlas-ingest",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const noReviewLink: OperationReviewLink = Object.freeze({
  reason: "Ingest produced a local Atlas Proposal only.",
  state: "not-applicable",
});

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

function pendingDecisions(findings: readonly Finding[]): readonly string[] {
  const decisions: string[] = [];
  for (const entry of findings) {
    if (entry.severity !== "inconclusive") continue;
    if (entry.code === "ATLAS_INGEST_SCOPE_EXPANSION_PENDING") {
      decisions.push(
        "A human must approve expanding the Ingest Scope before the crawled candidate outside it can be ingested.",
      );
    } else {
      decisions.push(
        "A human must adjudicate an equal-authority conflict Source Revision Time cannot settle.",
      );
    }
  }
  return Object.freeze([...new Set(decisions)]);
}

function handoff(
  state: AtlasIngestWorkflowState,
  disposition: "failed" | "success",
  completion: "completed" | "not-completed",
  findings: readonly Finding[],
  summary: string,
  evidence: string,
): AtlasIngestHandoff {
  const decisions = pendingDecisions(findings);
  const staleWarnings = findings.filter(
    (entry) => entry.code === "ATLAS_INGEST_SOURCE_STALE",
  );
  return Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: Object.freeze({
      reference: state.targetHead,
      state: "known" as const,
    }),
    degradationState: Object.freeze({
      reason:
        staleWarnings.length === 0
          ? evidence
          : `${evidence} Stale Knowledge remains traversable and its Source can be re-Ingested.`,
      state:
        staleWarnings.length === 0 ? ("not-degraded" as const) : ("degraded" as const),
    }),
    homeAtlas: Object.freeze({
      reason: "Ingest runs against the selected Home Atlas repository.",
      state: "unknown" as const,
    }) satisfies OperationReference,
    operation: ingestOperation,
    proposedChanges:
      completion === "completed"
        ? Object.freeze({
            state: "available" as const,
            summary: `Atlas Proposal branch ${state.proposalBranch} carries Ingest operation ${state.operationId}.`,
          })
        : Object.freeze({ reason: summary, state: "unknown" as const }),
    recommendedNextAction:
      completion === "completed"
        ? "Review the cited Source and derived knowledge, then merge the Atlas Proposal through Git governance."
        : decisions.length > 0
          ? "Resolve the unresolved human decisions, then resume Ingest from the typed workflow state."
          : "Resolve the reported Ingest Findings, then resume Ingest from the typed workflow state.",
    result: Object.freeze({ disposition, summary }),
    reviewLink: noReviewLink,
    unresolvedHumanDecisions:
      decisions.length > 0
        ? Object.freeze({
            decisions: Object.freeze(decisions),
            state: "pending" as const,
          })
        : Object.freeze({
            state: "none" as const,
            summary:
              staleWarnings.length === 0
                ? "No unresolved human decision is encoded in this result."
                : "Stale Knowledge is surfaced for optional re-Ingest but needs no decision to merge.",
          }),
    validationState: Object.freeze({
      findings,
      state:
        completion === "completed" ? ("passed" as const) : ("not-completed" as const),
    }),
  });
}

function result(
  state: AtlasIngestWorkflowState,
  completion: "completed" | "not-completed",
  disposition: "failed" | "success",
  payload: Omit<AtlasIngestPayload, "state" | "workflowState">,
  findings: readonly Finding[],
  summary: string,
  evidence: string,
): AtlasIngestResult {
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion,
    disposition,
    handoff: handoff(state, disposition, completion, findings, summary, evidence),
    operation: ingestOperation,
    payload: Object.freeze({ ...payload, state: completion, workflowState: state }),
  });
}

function receiptFor(
  state: AtlasIngestWorkflowState,
  effect: AtlasIngestEffectReceipt["effect"],
): AtlasIngestEffectReceipt | undefined {
  return state.effectReceipts.find((receipt) => receipt.effect === effect);
}

function addReceipt(
  state: AtlasIngestWorkflowState,
  receipt: AtlasIngestEffectReceipt,
): AtlasIngestWorkflowState {
  return Object.freeze({
    ...state,
    effectReceipts: Object.freeze([...state.effectReceipts, receipt]),
  });
}

export function isSafeGitBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/u.test(name) &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.includes("..") &&
    !name.split("/").some((segment) => segment === "" || segment === ".")
  );
}

function digestText(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function changeSetDigest(changeSet: AtlasIngestChangeSet): string {
  const parts = [changeSet.baseSnapshotDigest, changeSet.targetHead];
  for (const change of [...changeSet.changes].toSorted((left, right) =>
    compareCodePoints(left.path, right.path),
  )) {
    parts.push(change.path, digestText(change.content));
  }
  return digestText(parts.join("\0"));
}

/** The content digest that identifies one immutable Source revision. */
export function sourceRevisionDigest(content: string): string {
  return digestText(content);
}

function pathSegments(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function isCanonicalLocator(locator: string): boolean {
  if (locator.length === 0) return false;
  if (locator.startsWith("/") || locator.includes("\\")) return false;
  return !locator
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

function isPrefixPath(prefix: string, path: string): boolean {
  const prefixParts = pathSegments(prefix);
  const pathParts = pathSegments(path);
  if (prefixParts.length > pathParts.length) return false;
  return prefixParts.every((segment, index) => segment === pathParts[index]);
}

function withinScope(locator: string, scope: AtlasIngestScope): boolean {
  const included = [scope.entryPoint, ...scope.includedPaths];
  if (!included.some((prefix) => isPrefixPath(prefix, locator))) return false;
  if (scope.excludedPaths.some((prefix) => isPrefixPath(prefix, locator))) return false;
  return pathSegments(locator).length <= scope.maxDepth;
}

function slugForId(id: string, prefix: string): string | undefined {
  if (!id.startsWith(`${prefix}:`)) return undefined;
  const slug = id.slice(prefix.length + 1);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) ? slug : undefined;
}

interface ExistingAtlas {
  readonly principleTruthIds: ReadonlySet<string>;
  readonly sourceText: ReadonlyMap<string, string>;
  readonly nonSourcePageIds: ReadonlySet<string>;
}

function frontmatterId(content: string): string | undefined {
  return /^\s*id:\s*([^\s]+)\s*$/mu.exec(content)?.[1];
}

function activePrincipleTruthIds(content: string): readonly string[] {
  const ids: string[] = [];
  let active = false;
  for (const line of content.split(/\r?\n/u)) {
    if (/^## /u.test(line)) active = line.trim() === "## Active truths";
    if (!active) continue;
    const match = /^- `([^`]+)` /u.exec(line);
    if (match !== null) ids.push(match[1] as string);
  }
  return ids;
}

function readExistingAtlas(files: readonly CapturedAtlasFile[]): ExistingAtlas {
  const decoder = new TextDecoder();
  const principleTruthIds = new Set<string>();
  const sourceText = new Map<string, string>();
  const nonSourcePageIds = new Set<string>();
  for (const file of files) {
    const text = decoder.decode(file.bytes);
    const id = frontmatterId(text);
    if (file.path.startsWith(".atlas/sources/")) {
      if (id !== undefined) sourceText.set(id, text);
      continue;
    }
    if (file.path.startsWith(".atlas/principles/")) {
      for (const truth of activePrincipleTruthIds(text)) principleTruthIds.add(truth);
    }
    if (id !== undefined) nonSourcePageIds.add(id);
  }
  return Object.freeze({
    nonSourcePageIds,
    principleTruthIds,
    sourceText,
  });
}

interface ResolvedSource {
  readonly authority: SourceAuthority;
  readonly content: string;
  readonly revisionTime: string;
}

function resolvedSources(
  graph: AtlasIngestCandidateGraph,
): ReadonlyMap<string, ResolvedSource> {
  const resolved = new Map<string, ResolvedSource>();
  for (const source of graph.sources) {
    resolved.set(source.id, {
      authority: source.authority,
      content: source.content,
      revisionTime: source.revisionTime,
    });
  }
  return resolved;
}

function unorderedPairKey(from: string, to: string): string {
  return [from, to].toSorted(compareCodePoints).join("\u0000");
}

function validateSources(
  graph: AtlasIngestCandidateGraph,
  scope: AtlasIngestScope,
): readonly Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const source of graph.sources) {
    const path = `.atlas/sources/${slugForId(source.id, "source") ?? "unknown"}.md`;
    if (slugForId(source.id, "source") === undefined) {
      findings.push(
        finding(
          "ATLAS_INGEST_SOURCE_ID_INVALID",
          "Every ingested Source must carry a canonical source page identity.",
          path,
        ),
      );
      continue;
    }
    if (seen.has(source.id)) {
      findings.push(
        finding(
          "ATLAS_INGEST_SOURCE_ID_DUPLICATE",
          "Each ingested Source identity must appear once in the Candidate Graph.",
          path,
        ),
      );
    }
    seen.add(source.id);
    if (source.content.trim() === "") {
      findings.push(
        finding(
          "ATLAS_INGEST_SOURCE_CONTENT_REQUIRED",
          "A Source revision must carry the captured content its digest and Citations bind to.",
          path,
        ),
      );
    }
    if (Number.isNaN(Date.parse(source.revisionTime))) {
      findings.push(
        finding(
          "ATLAS_INGEST_SOURCE_REVISION_TIME_INVALID",
          "A Source Revision Time must be a comparable date-time asserted by the cited revision.",
          path,
        ),
      );
    }
    if (!isCanonicalLocator(source.locator)) {
      findings.push(
        finding(
          "ATLAS_INGEST_LOCATOR_INVALID",
          "A crawled locator must be a canonical repository-relative path.",
          path,
        ),
      );
    } else if (!withinScope(source.locator, scope)) {
      findings.push(
        finding(
          "ATLAS_INGEST_SCOPE_EXPANSION_PENDING",
          "A crawled Source lies beyond the approved Ingest Scope and pauses for approval.",
          path,
          "inconclusive",
        ),
      );
    }
  }
  return findings;
}

function citationSupported(
  citation: AtlasIngestCandidateCitation,
  sources: ReadonlyMap<string, ResolvedSource>,
  existing: ExistingAtlas,
): "supported" | "missing-source" | "unsupported" {
  const candidate = sources.get(citation.sourceId);
  const existingText = existing.sourceText.get(citation.sourceId);
  if (candidate === undefined && existingText === undefined) return "missing-source";
  if (citation.sourceClaim.trim() === "") return "unsupported";
  const content =
    candidate === undefined ? (existingText as string) : candidate.content;
  return content.includes(citation.sourceClaim) ? "supported" : "unsupported";
}

function validateCitation(
  citation: AtlasIngestCandidateCitation,
  path: string,
  sources: ReadonlyMap<string, ResolvedSource>,
  existing: ExistingAtlas,
  findings: Finding[],
): void {
  const support = citationSupported(citation, sources, existing);
  if (support === "missing-source") {
    findings.push(
      finding(
        "ATLAS_INGEST_CITATION_SOURCE_MISSING",
        "A Citation must resolve to an Atlas-local Source in this Candidate Graph or the Home Atlas.",
        path,
      ),
    );
    return;
  }
  if (support === "unsupported") {
    findings.push(
      finding(
        "ATLAS_INGEST_CITATION_UNSUPPORTED",
        "A Citation must quote a claim that appears in the cited Source revision content.",
        path,
      ),
    );
  }
}

function validateConcepts(
  graph: AtlasIngestCandidateGraph,
  scope: AtlasIngestScope,
  sources: ReadonlyMap<string, ResolvedSource>,
  existing: ExistingAtlas,
): readonly Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const edgeEndpointCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    for (const endpoint of [edge.from, edge.to]) {
      edgeEndpointCounts.set(endpoint, (edgeEndpointCounts.get(endpoint) ?? 0) + 1);
    }
  }
  for (const concept of graph.concepts) {
    const slug = slugForId(concept.id, "concept");
    const path = `.atlas/concepts/${slug ?? "unknown"}.md`;
    if (slug === undefined) {
      findings.push(
        finding(
          "ATLAS_INGEST_CONCEPT_ID_INVALID",
          "Every Concept must carry a canonical concept page identity.",
          path,
        ),
      );
      continue;
    }
    if (seen.has(concept.id)) {
      findings.push(
        finding(
          "ATLAS_INGEST_CONCEPT_ID_DUPLICATE",
          "Each Concept identity must appear once in the Candidate Graph.",
          path,
        ),
      );
    }
    seen.add(concept.id);
    if (concept.claim.trim() === "") {
      findings.push(
        finding(
          "ATLAS_INGEST_CONCEPT_CLAIM_REQUIRED",
          "A Concept represents exactly one concept and must state its one claim.",
          path,
        ),
      );
    }
    if (concept.citations.length === 0) {
      findings.push(
        finding(
          "ATLAS_INGEST_CONCEPT_UNCITED",
          "A Concept must trace its claim to at least one Atlas-local Source through a Citation.",
          path,
        ),
      );
    }
    for (const citation of concept.citations) {
      validateCitation(citation, path, sources, existing, findings);
    }
    if ((edgeEndpointCounts.get(concept.id) ?? 0) === 0) {
      findings.push(
        finding(
          "ATLAS_INGEST_CONCEPT_UNREACHABLE",
          "A Concept must carry at least one Edge so no page is unreachable by traversal.",
          path,
        ),
      );
    }
    if (!isCanonicalLocator(concept.locator)) {
      findings.push(
        finding(
          "ATLAS_INGEST_LOCATOR_INVALID",
          "A crawled locator must be a canonical repository-relative path.",
          path,
        ),
      );
    } else if (!withinScope(concept.locator, scope)) {
      findings.push(
        finding(
          "ATLAS_INGEST_SCOPE_EXPANSION_PENDING",
          "A crawled Concept lies beyond the approved Ingest Scope and pauses for approval.",
          path,
          "inconclusive",
        ),
      );
    }
    findings.push(...validateContradiction(concept, path, existing));
  }
  return findings;
}

function validateContradiction(
  concept: AtlasIngestCandidateConcept,
  path: string,
  existing: ExistingAtlas,
): readonly Finding[] {
  const contradiction = concept.contradiction;
  if (contradiction === undefined) return [];
  if (!existing.principleTruthIds.has(contradiction.principleTruthId)) {
    return [
      finding(
        "ATLAS_INGEST_CONTRADICTION_UNRESOLVED",
        "An accepted Contradiction must name an active Principle truth in the Home Atlas.",
        path,
      ),
    ];
  }
  if ((contradiction.acceptedBy ?? "").trim() === "") {
    return [
      finding(
        "ATLAS_INGEST_CONTRADICTION_UNACCEPTED",
        "A Concept contradicting an active Principle truth cannot be ingested until a human accepts the Contradiction.",
        path,
      ),
    ];
  }
  return [];
}

function conceptById(
  graph: AtlasIngestCandidateGraph,
): ReadonlyMap<string, AtlasIngestCandidateConcept> {
  return new Map(graph.concepts.map((concept) => [concept.id, concept]));
}

function primarySourceOf(
  concept: AtlasIngestCandidateConcept,
  sources: ReadonlyMap<string, ResolvedSource>,
): ResolvedSource | undefined {
  const citation = concept.citations[0];
  return citation === undefined ? undefined : sources.get(citation.sourceId);
}

function validateDisputes(
  graph: AtlasIngestCandidateGraph,
  sources: ReadonlyMap<string, ResolvedSource>,
): readonly Finding[] {
  const findings: Finding[] = [];
  const byId = conceptById(graph);
  for (const dispute of graph.disputes) {
    const left = byId.get(dispute.leftConceptId);
    const right = byId.get(dispute.rightConceptId);
    if (left === undefined || right === undefined) {
      findings.push(
        finding(
          "ATLAS_INGEST_DISPUTE_CONCEPT_MISSING",
          "A Dispute must name two Concepts present in this Candidate Graph.",
        ),
      );
      continue;
    }
    const leftSource = primarySourceOf(left, sources);
    const rightSource = primarySourceOf(right, sources);
    if (leftSource === undefined || rightSource === undefined) {
      findings.push(
        finding(
          "ATLAS_INGEST_DISPUTE_CONCEPT_MISSING",
          "A disputed Concept must cite a resolvable Source so its authority can settle the conflict.",
        ),
      );
      continue;
    }
    if (authorityRank[leftSource.authority] !== authorityRank[rightSource.authority]) {
      continue;
    }
    const leftTime = Date.parse(leftSource.revisionTime);
    const rightTime = Date.parse(rightSource.revisionTime);
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime) || leftTime === rightTime) {
      findings.push(
        finding(
          "ATLAS_INGEST_DISPUTE_UNRESOLVED",
          "Equal-authority Concepts whose Source Revision Time cannot break the tie require human adjudication.",
          ".atlas",
          "inconclusive",
        ),
      );
    }
  }
  return findings;
}

function staleFindings(
  graph: AtlasIngestCandidateGraph,
  scope: AtlasIngestScope,
): readonly Finding[] {
  const findings: Finding[] = [];
  const asOf = Date.parse(scope.asOf);
  if (Number.isNaN(asOf)) return findings;
  for (const source of graph.sources) {
    const revised = Date.parse(source.revisionTime);
    if (Number.isNaN(revised)) continue;
    const elapsedDays = (asOf - revised) / 86_400_000;
    if (elapsedDays > source.refreshWindowDays) {
      findings.push(
        finding(
          "ATLAS_INGEST_SOURCE_STALE",
          "The cited Source revision is older than its refresh window; its Stale Knowledge can be re-Ingested.",
          `.atlas/sources/${slugForId(source.id, "source") ?? "unknown"}.md`,
          "warning",
        ),
      );
    }
  }
  return findings;
}

function validateEdges(
  graph: AtlasIngestCandidateGraph,
  scope: AtlasIngestScope,
  sources: ReadonlyMap<string, ResolvedSource>,
  existing: ExistingAtlas,
): readonly Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const pairs = new Set<string>();
  const conceptIds = new Set(graph.concepts.map((concept) => concept.id));
  const sourceIds = new Set(graph.sources.map((source) => source.id));
  for (const edge of graph.edges) {
    const slug = slugForId(edge.id, "edge");
    const path = `.atlas/edges/${slug ?? "unknown"}.md`;
    if (slug === undefined) {
      findings.push(
        finding(
          "ATLAS_INGEST_EDGE_ID_INVALID",
          "Every Edge must carry a canonical edge page identity.",
          path,
        ),
      );
      continue;
    }
    if (seen.has(edge.id)) {
      findings.push(
        finding(
          "ATLAS_INGEST_EDGE_ID_DUPLICATE",
          "Each Edge identity must appear once in the Candidate Graph.",
          path,
        ),
      );
    }
    seen.add(edge.id);
    if (edge.semantics.length === 0) {
      findings.push(
        finding(
          "ATLAS_INGEST_EDGE_SEMANTICS_REQUIRED",
          "An Edge must assert at least one typed relationship semantic.",
          path,
        ),
      );
    }
    for (const endpoint of [edge.from, edge.to]) {
      if (sourceIds.has(endpoint) || existing.sourceText.has(endpoint)) {
        findings.push(
          finding(
            "ATLAS_INGEST_EDGE_CONNECTS_SOURCE",
            "Edges traverse Concepts, Anchors, and Principles; they never connect to a Source.",
            path,
          ),
        );
      } else if (
        !conceptIds.has(endpoint) &&
        !existing.nonSourcePageIds.has(endpoint)
      ) {
        findings.push(
          finding(
            "ATLAS_INGEST_EDGE_ENDPOINT_MISSING",
            "An Edge endpoint must resolve to a page in this Candidate Graph or the Home Atlas.",
            path,
          ),
        );
      }
    }
    if (edge.from === edge.to) {
      findings.push(
        finding(
          "ATLAS_INGEST_EDGE_SELF_LOOP",
          "An Edge must relate two distinct pages.",
          path,
        ),
      );
    } else {
      const key = unorderedPairKey(edge.from, edge.to);
      if (pairs.has(key)) {
        findings.push(
          finding(
            "ATLAS_INGEST_EDGE_PAIR_DUPLICATE",
            "At most one Edge may exist per unordered in-Atlas page pair.",
            path,
          ),
        );
      }
      pairs.add(key);
    }
    validateCitation(edge.citation, path, sources, existing, findings);
  }
  return findings;
}

export function validateCandidateGraph(
  request: AtlasIngestRequest,
  existingFiles: readonly CapturedAtlasFile[],
): readonly Finding[] {
  const { candidateGraph: graph, scope } = request;
  const existing = readExistingAtlas(existingFiles);
  const sources = resolvedSources(graph);
  const findings: Finding[] = [];
  if (!isSourceAuthority(scope.authority)) {
    findings.push(
      finding(
        "ATLAS_INGEST_SCOPE_AUTHORITY_INVALID",
        "An Ingest Scope must assign a recognized Source Authority class.",
      ),
    );
  }
  if (graph.sources.length === 0) {
    findings.push(
      finding(
        "ATLAS_INGEST_SOURCE_REQUIRED",
        "Ingesting one repository source must record at least one Source.",
      ),
    );
  }
  findings.push(...validateSources(graph, scope));
  findings.push(...validateConcepts(graph, scope, sources, existing));
  findings.push(...validateEdges(graph, scope, sources, existing));
  findings.push(...validateDisputes(graph, sources));
  findings.push(...staleFindings(graph, scope));
  return Object.freeze(
    findings.toSorted((left, right) => {
      const path = compareCodePoints(left.path, right.path);
      return path !== 0 ? path : compareCodePoints(left.code, right.code);
    }),
  );
}

function frontmatter(
  id: string,
  type: string,
  title: string,
  asOf: string,
  operationId: string,
  atlasBlock: string,
): string {
  return [
    "---",
    "sdk:",
    "  atlas-sdk-schema: 1.0.0",
    `  created-at: "${asOf}"`,
    "  created-by:",
    "    kind: agent",
    "    name: Atlas SDK",
    `  id: ${id}`,
    "  local-atlas-schema: 1.0.0",
    `  originating-operation: ${operationId}`,
    "  tags: []",
    `  title: ${title}`,
    `  type: ${type}`,
    `  updated-at: "${asOf}"`,
    "  updated-by:",
    "    kind: agent",
    "    name: Atlas SDK",
    atlasBlock,
    "---",
    "",
  ].join("\n");
}

function citationBlock(citations: readonly AtlasIngestCandidateCitation[]): {
  readonly markers: string;
  readonly definitions: string;
} {
  const markers = citations.map((_, index) => `[^s${String(index + 1)}]`).join("");
  const definitions = citations
    .map(
      (citation, index) =>
        `[^s${String(index + 1)}]: [[.atlas/sources/${slugForId(citation.sourceId, "source") as string}]] Supports this claim.`,
    )
    .join("\n");
  return { definitions, markers };
}

function sourcePage(
  source: AtlasIngestCandidateSource,
  scope: AtlasIngestScope,
  operationId: string,
): AtlasIngestChange {
  const slug = slugForId(source.id, "source") as string;
  const atlasBlock = [
    "atlas:",
    `  authority: ${source.authority}`,
    `  locator: ${source.locator}`,
    `  refresh-window-days: ${String(source.refreshWindowDays)}`,
    `  revision: ${sourceRevisionDigest(source.content)}`,
    `  revision-time: "${source.revisionTime}"`,
  ].join("\n");
  const body = [
    `# ${source.title}`,
    "",
    `Ingested from ${source.locator} within the approved Ingest Scope.`,
    "",
  ].join("\n");
  return Object.freeze({
    content:
      frontmatter(
        source.id,
        "source",
        source.title,
        scope.asOf,
        operationId,
        atlasBlock,
      ) + body,
    path: `.atlas/sources/${slug}.md`,
  });
}

function conceptPage(
  concept: AtlasIngestCandidateConcept,
  scope: AtlasIngestScope,
  operationId: string,
): AtlasIngestChange {
  const slug = slugForId(concept.id, "concept") as string;
  const evidence = concept.citations.map(
    (citation) =>
      `    - .atlas/sources/${slugForId(citation.sourceId, "source") as string}`,
  );
  const contradiction = concept.contradiction;
  const atlasBlock = [
    "atlas:",
    "  confidence: unreviewed",
    ...(contradiction === undefined
      ? []
      : [`  contradicts: ${contradiction.principleTruthId}`]),
    "  evidence:",
    ...evidence,
  ].join("\n");
  const { definitions, markers } = citationBlock(concept.citations);
  const bodyLines = [`# ${concept.title}`, "", `${concept.claim}${markers}`];
  if (contradiction !== undefined) {
    bodyLines.push(
      "",
      `This claim is an accepted Contradiction of ${contradiction.principleTruthId}.`,
    );
  }
  bodyLines.push("", definitions, "");
  return Object.freeze({
    content:
      frontmatter(
        concept.id,
        "concept",
        concept.title,
        scope.asOf,
        operationId,
        atlasBlock,
      ) + bodyLines.join("\n"),
    path: `.atlas/concepts/${slug}.md`,
  });
}

function edgePage(
  edge: AtlasIngestCandidateEdge,
  scope: AtlasIngestScope,
  operationId: string,
): AtlasIngestChange {
  const slug = slugForId(edge.id, "edge") as string;
  const atlasBlock = [
    "atlas:",
    `  from: ${edge.from}`,
    "  semantics:",
    ...edge.semantics.map((semantic) => `    - ${semantic}`),
    `  to: ${edge.to}`,
  ].join("\n");
  const { definitions, markers } = citationBlock([edge.citation]);
  const body = [
    `# ${edge.title}`,
    "",
    `${edge.context}${markers}`,
    "",
    definitions,
    "",
  ].join("\n");
  return Object.freeze({
    content:
      frontmatter(edge.id, "edge", edge.title, scope.asOf, operationId, atlasBlock) +
      body,
    path: `.atlas/edges/${slug}.md`,
  });
}

function changelogEntry(
  graph: AtlasIngestCandidateGraph,
  scope: AtlasIngestScope,
  operationId: string,
): AtlasIngestChange {
  return Object.freeze({
    content: [
      "# Changelog",
      "",
      `## ${scope.asOf}`,
      "",
      `- ${operationId}: Ingested ${scope.sourceId} into ${String(graph.concepts.length)} Concept(s) with cited Source and Edges.`,
      "",
    ].join("\n"),
    path: ".atlas/CHANGELOG.md",
  });
}

/**
 * The one deterministic reconciliation from a validated Candidate Graph into an
 * Atlas Change Set. It is a pure function of the request and workflow state, so
 * the same validated graph always reconciles to the same bytes.
 */
export function reconcileCandidateGraph(
  state: AtlasIngestWorkflowState,
  request: AtlasIngestRequest,
): AtlasIngestChangeSet {
  const { candidateGraph: graph, scope } = request;
  const changes: AtlasIngestChange[] = [
    changelogEntry(graph, scope, state.operationId),
  ];
  for (const source of graph.sources) {
    changes.push(sourcePage(source, scope, state.operationId));
  }
  for (const concept of graph.concepts) {
    changes.push(conceptPage(concept, scope, state.operationId));
  }
  for (const edge of graph.edges) {
    changes.push(edgePage(edge, scope, state.operationId));
  }
  return Object.freeze({
    baseSnapshotDigest: state.baseSnapshotDigest,
    changes: Object.freeze(
      changes.toSorted((left, right) => compareCodePoints(left.path, right.path)),
    ),
    targetHead: state.targetHead,
  });
}

export function validateAtlasIngestChangeSet(
  state: AtlasIngestWorkflowState,
  changeSet: AtlasIngestChangeSet,
): readonly Finding[] {
  const findings: Finding[] = [];
  if (
    changeSet.targetHead !== state.targetHead ||
    changeSet.baseSnapshotDigest !== state.baseSnapshotDigest
  ) {
    findings.push(
      finding(
        "ATLAS_INGEST_CHANGE_SET_STALE",
        "Ingest Atlas Change Set base does not match the current base snapshot.",
      ),
    );
  }
  for (const change of changeSet.changes) {
    if (
      !change.path.startsWith(".atlas/") ||
      change.path.includes("..") ||
      change.path.startsWith("/") ||
      change.path.includes("\\") ||
      change.path.split("/").some((segment) => segment === "" || segment === ".")
    ) {
      findings.push(
        finding(
          "ATLAS_INGEST_CHANGE_SET_PATH_INVALID",
          "Ingest Atlas Change Sets may write only canonical .atlas paths.",
          change.path,
        ),
      );
    }
  }
  const changelog = changeSet.changes.find(
    (change) => change.path === ".atlas/CHANGELOG.md",
  );
  if (changelog === undefined) {
    findings.push(
      finding(
        "ATLAS_INGEST_CHANGELOG_REQUIRED",
        "A successful Ingest proposal must append an operation-identified Atlas Changelog entry.",
      ),
    );
  } else if (!changelog.content.includes(state.operationId)) {
    findings.push(
      finding(
        "ATLAS_INGEST_CHANGELOG_OPERATION_ID_REQUIRED",
        "The Atlas Changelog entry for an Ingest proposal must name the stable operation ID.",
        ".atlas/CHANGELOG.md",
      ),
    );
  }
  return Object.freeze(findings);
}

function validateResumeReceipts(
  state: AtlasIngestWorkflowState,
  changeSet: AtlasIngestChangeSet,
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
        "ATLAS_INGEST_RESUME_CHANGE_SET_MISMATCH",
        "Ingest resume receipts must be content-addressed to the current Atlas Change Set digest and written tree.",
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
        "ATLAS_INGEST_RESUME_CHANGE_SET_MISMATCH",
        "Ingest commit receipts must bind the current Atlas Change Set digest to the proposal commit.",
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
        "ATLAS_INGEST_RESUME_CHANGE_SET_MISMATCH",
        "Ingest Lint receipts must bind the current Atlas Change Set digest to the lint evidence commit.",
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
        "ATLAS_INGEST_LINT_STAMP_STALE",
        "Ingest refused Lint evidence for a proposal commit different from the committed Atlas Change Set.",
      ),
    );
  }
  return Object.freeze(findings);
}

function canContinue(findings: readonly Finding[]): boolean {
  return findings.every(
    (entry) => entry.severity !== "error" && entry.severity !== "inconclusive",
  );
}

const evidenceSummary = (request: AtlasIngestRequest): string =>
  `Ingest of ${request.scope.sourceId} recorded ${String(request.candidateGraph.sources.length)} Source(s), ${String(request.candidateGraph.concepts.length)} Concept(s), and ${String(request.candidateGraph.edges.length)} Edge(s) within the approved Ingest Scope.`;

export function runAtlasIngestWorkflow(
  state: AtlasIngestWorkflowState,
  request: AtlasIngestRequest,
  runtime: AtlasIngestRuntime,
): AtlasIngestResult {
  let latestState = state;
  const evidence = evidenceSummary(request);
  try {
    if (
      !isSafeGitBranchName(state.proposalBranch) ||
      !isSafeGitBranchName(state.targetBranch)
    ) {
      return result(
        state,
        "not-completed",
        "failed",
        {},
        Object.freeze([
          finding(
            "ATLAS_INGEST_WORKFLOW_STATE_INVALID",
            "Ingest workflow state names an unsafe branch.",
          ),
        ]),
        "Ingest refused unsafe workflow state before mutating.",
        evidence,
      );
    }
    if (
      runtime.currentTargetHead() !== state.targetHead ||
      runtime.currentBaseSnapshotDigest() !== state.baseSnapshotDigest
    ) {
      return result(
        state,
        "not-completed",
        "failed",
        {},
        Object.freeze([
          finding(
            "ATLAS_INGEST_BASE_SNAPSHOT_STALE",
            "Ingest refused stale mutation because the target branch or base snapshot digest changed.",
          ),
        ]),
        "Ingest requires a refreshed base snapshot before mutating.",
        evidence,
      );
    }

    const changeSet = reconcileCandidateGraph(state, request);
    const graphFindings = validateCandidateGraph(request, runtime.existingAtlasFiles());
    const changeSetFindings = validateAtlasIngestChangeSet(state, changeSet);
    const resumeFindings = validateResumeReceipts(state, changeSet);
    const findings = Object.freeze([
      ...graphFindings,
      ...changeSetFindings,
      ...resumeFindings,
    ]);
    if (!canContinue(findings)) {
      return result(
        state,
        "not-completed",
        "failed",
        { changeSet },
        findings,
        pendingDecisions(findings).length > 0
          ? "Ingest paused for unresolved human decisions before mutating."
          : "Ingest is blocked by Candidate Graph validation Findings.",
        evidence,
      );
    }

    let nextState = state;
    if (
      receiptFor(nextState, "create-proposal-worktree") === undefined &&
      runtime.workspaceExists?.() === true
    ) {
      return result(
        nextState,
        "not-completed",
        "failed",
        {},
        Object.freeze([
          finding(
            "ATLAS_INGEST_WORKSPACE_EXISTS",
            "Ingest found an existing proposal branch or Operation Workspace before creating a new proposal.",
          ),
        ]),
        "Ingest refused to overwrite an existing Operation Workspace.",
        evidence,
      );
    }
    if (
      receiptFor(nextState, "create-proposal-worktree") === undefined &&
      runtime.workspacePathValid?.() === false
    ) {
      return result(
        nextState,
        "not-completed",
        "failed",
        {},
        Object.freeze([
          finding(
            "ATLAS_INGEST_WORKSPACE_PATH_INVALID",
            "Ingest refused an Operation Workspace path that escapes the Atlas Host Directory.",
          ),
        ]),
        "Ingest refused to create an Operation Workspace outside the Atlas Host Directory.",
        evidence,
      );
    }

    const digest = changeSetDigest(changeSet);
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
      const written = runtime.writeChangeSet(changeSet);
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
    if (
      linted.lint.completion !== "completed" ||
      linted.lint.disposition !== "success"
    ) {
      return result(
        nextState,
        "not-completed",
        "failed",
        { changeSet, lint: linted.lint },
        linted.lint.handoff.validationState.findings,
        "Ingest proposal did not pass trusted Lint.",
        evidence,
      );
    }
    if (linted.receipt !== commit) {
      return result(
        nextState,
        "not-completed",
        "failed",
        { changeSet, lint: linted.lint },
        Object.freeze([
          finding(
            "ATLAS_INGEST_LINT_STAMP_STALE",
            "Ingest refused to stamp a proposal commit different from the Lint evidence commit.",
          ),
        ]),
        "Ingest refused a stale Lint Stamp.",
        evidence,
      );
    }
    return result(
      nextState,
      "completed",
      "success",
      { changeSet, lint: linted.lint },
      staleFindings(request.candidateGraph, request.scope),
      "Ingest produced a Linted Atlas Proposal with cited Source and derived knowledge.",
      evidence,
    );
  } catch {
    return result(
      latestState,
      "not-completed",
      "failed",
      {},
      Object.freeze([
        finding(
          "ATLAS_INGEST_RUNTIME_FAILED",
          "Ingest runtime failed before the operation completed.",
        ),
      ]),
      "Ingest did not complete.",
      evidence,
    );
  }
}
