import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import { resolvedCitationSourcePaths } from "../atlas/resolve_citations.ts";
import { serializeAtlasPages } from "../atlas/serialize_atlas_pages.ts";
import type { ParsedAtlasPage } from "../atlas/parse_atlas_pages.ts";
import {
  checkAtlasDateTime,
  type AtlasPageEnvelope,
  type ReadonlyJsonValue,
} from "../domain/atlas_page.ts";
import type { Finding } from "../domain/finding.ts";
import type { LintOperationResult } from "./lint_operation.ts";
import {
  addReceipt,
  canContinue,
  changeSetDigest,
  hasControlCharacter,
  isSafeGitBranchName as isSafeGitBranchNameShared,
  receiptFor,
  revisionDigest,
} from "./operation_support.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationHandoff,
  type OperationIdentity,
  type OperationReference,
  type OperationResult,
  type OperationReviewLink,
} from "./operation_result.ts";

// The safe-branch rule, replay digest, and receipt walk are shared with the
// sibling proposal operations; ingest re-exports the branch rule so its public
// contract keeps the identifier while its definition stays single-sourced.
export const isSafeGitBranchName = isSafeGitBranchNameShared;

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

export function isSourceAuthority(value: string): value is SourceAuthority {
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

// A Source Revision Time must be comparable, not merely well-formed. RFC 3339
// admits leap seconds such as 1990-12-31T23:59:60Z, which the schema accepts but
// Date.parse cannot represent. Returning the raw parse would hand NaN to the
// freshness comparison, where every comparison is false and Stale Knowledge
// would pass silently. Anything that does not parse to a finite instant is
// refused here so the caller fails closed.
function dateTimeMilliseconds(value: string): number | undefined {
  if (!checkAtlasDateTime(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

/** The content digest that identifies one immutable Source revision. */
export function sourceRevisionDigest(content: string): string {
  return revisionDigest(content);
}

/** The replay-protection digest of one Ingest Atlas Change Set. */
export function atlasIngestChangeSetDigest(changeSet: AtlasIngestChangeSet): string {
  return changeSetDigest(changeSet);
}

function pathSegments(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function isCanonicalLocator(locator: string): boolean {
  if (locator.length === 0) return false;
  if (locator.startsWith("/") || locator.includes("\\")) return false;
  // A repository-relative path holds no control character, so a newline can
  // never reach a value the crawler asserts as a locator.
  if (hasControlCharacter(locator)) return false;
  return !locator.split("/").some(
    (segment) =>
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      // Win32 strips trailing dots and spaces from every path component, so
      // `docs/private.` and `docs/private ` name the same directory as
      // `docs/private`. Such a spelling is not canonical, and accepting it
      // would let a crawler address a scope-excluded directory under a name
      // scope confinement does not recognize.
      segment !== trimWin32Segment(segment),
  );
}

/** One path component as Win32 resolves it, without trailing dots or spaces. */
function trimWin32Segment(segment: string): string {
  return segment.replace(/[. ]+$/u, "");
}

// Scope confinement compares directories, not raw strings. A case-insensitive
// or Unicode-decomposed spelling of an excluded directory names the same
// directory on a case-folding or normalizing file system, so both sides are
// folded to NFC lower case before comparison. Trailing dots and spaces fold
// away too, because Win32 strips them from every component. Component
// alignment already holds; this closes the case, normalization, and Win32
// trailing-form gaps a raw `===` left open.
function scopeSegments(path: string): readonly string[] {
  return path
    .normalize("NFC")
    .split("/")
    .map((segment) => trimWin32Segment(segment).toLowerCase())
    .filter((segment) => segment.length > 0);
}

function isPrefixPath(prefix: string, path: string): boolean {
  const prefixParts = scopeSegments(prefix);
  const pathParts = scopeSegments(path);
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
  readonly atlasPolicyIds: ReadonlySet<string>;
  readonly sourceText: ReadonlyMap<string, string>;
  readonly nonSourcePageIds: ReadonlySet<string>;
  readonly pageIds: ReadonlySet<string>;
  readonly edgePairs: ReadonlySet<string>;
}

function frontmatterId(content: string): string | undefined {
  return /^\s*id:\s*([^\s]+)\s*$/mu.exec(content)?.[1];
}

function frontmatterField(content: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}:\\s*([^\\s]+)\\s*$`, "mu").exec(content);
  return match?.[1];
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
  const atlasPolicyIds = new Set<string>();
  const sourceText = new Map<string, string>();
  const nonSourcePageIds = new Set<string>();
  const pageIds = new Set<string>();
  const edgePairs = new Set<string>();
  for (const file of files) {
    const text = decoder.decode(file.bytes);
    const id = frontmatterId(text);
    if (id !== undefined) pageIds.add(id);
    if (file.path.startsWith(".atlas/sources/")) {
      if (id !== undefined) sourceText.set(id, text);
      continue;
    }
    if (file.path.startsWith(".atlas/principles/")) {
      for (const truth of activePrincipleTruthIds(text)) principleTruthIds.add(truth);
    }
    if (file.path.startsWith(".atlas/types/policy/")) {
      if (id !== undefined) atlasPolicyIds.add(id);
    }
    // An existing Edge already occupies its unordered page pair, so its
    // endpoints seed the pair-uniqueness set the Home Atlas would otherwise not
    // enforce against a freshly crawled Edge.
    if (file.path.startsWith(".atlas/edges/")) {
      const from = frontmatterField(text, "from");
      const to = frontmatterField(text, "to");
      if (from !== undefined && to !== undefined && from !== to) {
        edgePairs.add(unorderedPairKey(from, to));
      }
    }
    if (id !== undefined) nonSourcePageIds.add(id);
  }
  return Object.freeze({
    atlasPolicyIds,
    edgePairs,
    nonSourcePageIds,
    pageIds,
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

// A candidate page identity that already names a curated page would overwrite
// it — its Edges and Citations with it. Ingest refuses that silent replacement
// unless the identity is exactly the Source this Ingest Scope re-ingests, which
// is a Source Refresh of that one Source object.
function collisionFindings(
  graph: AtlasIngestCandidateGraph,
  scope: AtlasIngestScope,
  existing: ExistingAtlas,
): readonly Finding[] {
  const findings: Finding[] = [];
  const collision = (
    id: string,
    directory: string,
    prefix: string,
    refreshable: boolean,
  ): void => {
    const slug = slugForId(id, prefix);
    // A non-canonical identity is already reported by its own identity check, so
    // collision detection only concerns identities that name a real page.
    if (slug === undefined) return;
    if (!existing.pageIds.has(id)) return;
    if (refreshable && id === scope.sourceId) return;
    findings.push(
      finding(
        "ATLAS_INGEST_ID_COLLISION",
        "A crawled page identity already names a page in the Home Atlas and would replace it; only a Source Refresh of that Source may reuse an identity.",
        `.atlas/${directory}/${slug}.md`,
      ),
    );
  };
  for (const source of graph.sources) {
    collision(source.id, "sources", "source", true);
  }
  for (const concept of graph.concepts) {
    collision(concept.id, "concepts", "concept", false);
  }
  for (const edge of graph.edges) {
    collision(edge.id, "edges", "edge", false);
  }
  return findings;
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
    // The approved Ingest Scope caps Source Authority: a crawler may not assert
    // a higher authority than the human approved for this source.
    if (
      isSourceAuthority(scope.authority) &&
      authorityRank[source.authority] > authorityRank[scope.authority]
    ) {
      findings.push(
        finding(
          "ATLAS_INGEST_SOURCE_AUTHORITY_EXCEEDS_SCOPE",
          "A crawled Source claims a higher Source Authority than the approved Ingest Scope allows.",
          path,
        ),
      );
    }
  }
  return findings;
}

// The deterministic half of citation support: the quoted span must be a
// non-trivial substring of the cited revision content. It is verbatim
// containment, not verified meaning, so a span must be long enough to bind a
// claim rather than match an incidental character.
const minimumCitationSpanLength = 8;

function citationSupported(
  citation: AtlasIngestCandidateCitation,
  sources: ReadonlyMap<string, ResolvedSource>,
  existing: ExistingAtlas,
): "supported" | "missing-source" | "unsupported" | "span-too-short" {
  const candidate = sources.get(citation.sourceId);
  const existingText = existing.sourceText.get(citation.sourceId);
  if (candidate === undefined && existingText === undefined) return "missing-source";
  const span = citation.sourceClaim.trim();
  if (span === "") return "unsupported";
  if (span.length < minimumCitationSpanLength) return "span-too-short";
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
  if (support === "span-too-short") {
    findings.push(
      finding(
        "ATLAS_INGEST_CITATION_SPAN_TOO_SHORT",
        "A Citation must quote a span long enough to bind its claim to the cited Source revision, not an incidental character.",
        path,
      ),
    );
    return;
  }
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
  reachable: ReadonlySet<string>,
): readonly Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
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
    if (!reachable.has(concept.id)) {
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
  // A Contradiction contradicts an active Principle truth or violates an Atlas
  // Policy. Exactly one governing marker must be named, and it must resolve to a
  // governor the Home Atlas actually holds.
  const truthId = contradiction.principleTruthId;
  const policyId = contradiction.atlasPolicyId;
  if ((truthId === undefined) === (policyId === undefined)) {
    return [
      finding(
        "ATLAS_INGEST_CONTRADICTION_UNRESOLVED",
        "An accepted Contradiction must name exactly one governor: an active Principle truth or an Atlas Policy in the Home Atlas.",
        path,
      ),
    ];
  }
  const governed =
    truthId !== undefined
      ? existing.principleTruthIds.has(truthId)
      : existing.atlasPolicyIds.has(policyId as string);
  if (!governed) {
    return [
      finding(
        "ATLAS_INGEST_CONTRADICTION_UNRESOLVED",
        "An accepted Contradiction must name an active Principle truth or an Atlas Policy in the Home Atlas.",
        path,
      ),
    ];
  }
  if ((contradiction.acceptedBy ?? "").trim() === "") {
    return [
      finding(
        "ATLAS_INGEST_CONTRADICTION_UNACCEPTED",
        "A Concept contradicting an active Principle truth or Atlas Policy cannot be ingested until a human accepts the Contradiction.",
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
    const leftTime = dateTimeMilliseconds(leftSource.revisionTime);
    const rightTime = dateTimeMilliseconds(rightSource.revisionTime);
    if (leftTime === undefined || rightTime === undefined || leftTime === rightTime) {
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
  const asOf = dateTimeMilliseconds(scope.asOf);
  if (asOf === undefined) {
    findings.push(
      finding(
        "ATLAS_INGEST_SCOPE_AS_OF_INVALID",
        "An Ingest Scope asOf value must be a date-time so Stale Knowledge checks and emitted Atlas page timestamps are deterministic.",
      ),
    );
    return findings;
  }
  for (const source of graph.sources) {
    const revised = dateTimeMilliseconds(source.revisionTime);
    if (revised === undefined) {
      findings.push(
        finding(
          "ATLAS_INGEST_SOURCE_REVISION_TIME_INVALID",
          "A Source Revision Time must be a comparable date-time asserted by the cited revision.",
          `.atlas/sources/${slugForId(source.id, "source") ?? "unknown"}.md`,
        ),
      );
      continue;
    }
    const elapsedDays = (asOf - revised) / 86_400_000;
    // The approved Ingest Scope caps freshness: a crawler-asserted refresh
    // window may be shorter but never outlast the window the human approved.
    const effectiveWindow = Math.min(
      source.refreshWindowDays,
      scope.freshnessWindowDays,
    );
    if (elapsedDays > effectiveWindow) {
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
  // The Home Atlas's existing Edges already occupy their pairs, so a crawled
  // Edge over a pair the Atlas already relates is a duplicate too.
  const pairs = new Set<string>(existing.edgePairs);
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
    if (edge.citations.length === 0) {
      findings.push(
        finding(
          "ATLAS_INGEST_EDGE_UNCITED",
          "An Edge must support its asserted relationship with at least one Citation.",
          path,
        ),
      );
    }
    for (const citation of edge.citations) {
      validateCitation(citation, path, sources, existing, findings);
    }
  }
  return findings;
}

// Reachability is decided from Edges that would actually be written: an Edge to
// a Source, a self-loop, an endpoint that resolves to no page, or an Edge with
// no canonical identity is never written, so it cannot make a Concept reachable.
function reachableEndpoints(
  graph: AtlasIngestCandidateGraph,
  existing: ExistingAtlas,
): ReadonlySet<string> {
  const conceptIds = new Set(graph.concepts.map((concept) => concept.id));
  const sourceIds = new Set(graph.sources.map((source) => source.id));
  const isSource = (endpoint: string): boolean =>
    sourceIds.has(endpoint) || existing.sourceText.has(endpoint);
  const isPage = (endpoint: string): boolean =>
    conceptIds.has(endpoint) || existing.nonSourcePageIds.has(endpoint);
  const reachable = new Set<string>();
  for (const edge of graph.edges) {
    if (slugForId(edge.id, "edge") === undefined) continue;
    if (edge.from === edge.to) continue;
    const endpoints = [edge.from, edge.to];
    if (endpoints.some((endpoint) => isSource(endpoint))) continue;
    if (!endpoints.every((endpoint) => isPage(endpoint))) continue;
    for (const endpoint of endpoints) reachable.add(endpoint);
  }
  return reachable;
}

// The Ingest Scope is a human-approved envelope, and every generated Source page
// stamps that its material was ingested within it. That claim is only true if a
// Maintainer actually approved: approval identity and time are required, exactly
// as the sibling governance operation requires them before it mutates.
export function validateApproval(scope: AtlasIngestScope): readonly Finding[] {
  if (
    scope.approvedBy.trim() !== "" &&
    dateTimeMilliseconds(scope.approvedAt) !== undefined
  ) {
    return [];
  }
  return [
    finding(
      "ATLAS_INGEST_APPROVAL_REQUIRED",
      "Ingest requires explicit Maintainer approval identity and date-time before it derives knowledge within the approved Ingest Scope.",
    ),
  ];
}

export function validateIngestScopeTime(scope: AtlasIngestScope): readonly Finding[] {
  if (dateTimeMilliseconds(scope.asOf) !== undefined) return [];
  return [
    finding(
      "ATLAS_INGEST_SCOPE_AS_OF_INVALID",
      "An Ingest Scope asOf value must be a date-time so Stale Knowledge checks and emitted Atlas page timestamps are deterministic.",
    ),
  ];
}

export function validateCandidateGraph(
  request: AtlasIngestRequest,
  existingFiles: readonly CapturedAtlasFile[],
): readonly Finding[] {
  const { candidateGraph: graph, scope } = request;
  const existing = readExistingAtlas(existingFiles);
  const sources = resolvedSources(graph);
  const reachable = reachableEndpoints(graph, existing);
  const findings: Finding[] = [];
  findings.push(...validateApproval(scope));
  findings.push(...staleFindings(graph, scope));
  findings.push(...collisionFindings(graph, scope, existing));
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
  findings.push(...validateConcepts(graph, scope, sources, existing, reachable));
  findings.push(...validateEdges(graph, scope, sources, existing));
  findings.push(...validateDisputes(graph, sources));
  return Object.freeze(
    findings.toSorted((left, right) => {
      const path = compareCodePoints(left.path, right.path);
      return path !== 0 ? path : compareCodePoints(left.code, right.code);
    }),
  );
}

type AtlasBlock = Readonly<Record<string, ReadonlyJsonValue>>;

// Every page's frontmatter is a typed value emitted through the house
// serializer, never string interpolation. The serializer quotes any non-plain
// scalar, so a newline or a colon in a crawled title, locator, or semantic can
// never open a sibling key in the `sdk` or `atlas` block: the injection class is
// unrepresentable rather than guarded form by form.
function sdkMetadata(
  id: string,
  type: string,
  title: string,
  asOf: string,
  operationId: string,
): AtlasPageEnvelope["sdk"] {
  return {
    "atlas-sdk-schema": "1.0.0",
    "created-at": asOf,
    "created-by": { kind: "agent" as const, name: "Atlas SDK" },
    id,
    "local-atlas-schema": "1.0.0",
    "originating-operation": operationId,
    tags: [],
    title,
    type,
    "updated-at": asOf,
    "updated-by": { kind: "agent" as const, name: "Atlas SDK" },
  };
}

function pageEnvelope(
  path: string,
  sdk: AtlasPageEnvelope["sdk"],
  atlas: AtlasBlock,
  body: string,
): ParsedAtlasPage {
  return {
    page: { atlas, body, sdk },
    source: {
      body: { endLine: 0, startLine: 0 },
      frontmatter: { endLine: 0, startLine: 0 },
      path,
    },
  };
}

// A citation footnote names its Source with a resolvable `[[.atlas/sources/...]]`
// target and records the quoted span verbatim, so Lint can re-derive the same
// deterministic binding the Candidate Graph asserted. The span is written as a
// JSON string so a control character cannot break the footnote, and the
// correspondence gate rejects any span that smuggles a second citation target.
function citationBody(citations: readonly AtlasIngestCandidateCitation[]): {
  readonly markers: string;
  readonly definitions: string;
} {
  const markers = citations.map((_, index) => `[^s${String(index + 1)}]`).join("");
  const definitions = citations
    .map(
      (citation, index) =>
        `[^s${String(index + 1)}]: [[.atlas/sources/${slugForId(citation.sourceId, "source") as string}]] Quoted span ${JSON.stringify(citation.sourceClaim.trim())}.`,
    )
    .join("\n");
  return { definitions, markers };
}

function sourcePage(
  source: AtlasIngestCandidateSource,
  scope: AtlasIngestScope,
  operationId: string,
): ParsedAtlasPage {
  const slug = slugForId(source.id, "source") as string;
  const atlas: AtlasBlock = {
    authority: source.authority,
    locator: source.locator,
    "refresh-window-days": source.refreshWindowDays,
    revision: sourceRevisionDigest(source.content),
    "revision-time": source.revisionTime,
  };
  const body = [
    `# ${source.title}`,
    "",
    `Ingested from ${source.locator} within the approved Ingest Scope.`,
    "",
  ].join("\n");
  return pageEnvelope(
    `.atlas/sources/${slug}.md`,
    sdkMetadata(source.id, "source", source.title, scope.asOf, operationId),
    atlas,
    body,
  );
}

function conceptPage(
  concept: AtlasIngestCandidateConcept,
  scope: AtlasIngestScope,
  operationId: string,
): ParsedAtlasPage {
  const slug = slugForId(concept.id, "concept") as string;
  const evidence = concept.citations.map(
    (citation) => `.atlas/sources/${slugForId(citation.sourceId, "source") as string}`,
  );
  const contradiction = concept.contradiction;
  const governor = contradiction?.principleTruthId ?? contradiction?.atlasPolicyId;
  const atlas: AtlasBlock = {
    confidence: "unreviewed",
    ...(governor === undefined ? {} : { contradicts: governor }),
    evidence,
  };
  const { definitions, markers } = citationBody(concept.citations);
  const bodyLines = [`# ${concept.title}`, "", `${concept.claim}${markers}`];
  if (governor !== undefined) {
    bodyLines.push("", `This claim is an accepted Contradiction of ${governor}.`);
  }
  bodyLines.push("", definitions, "");
  return pageEnvelope(
    `.atlas/concepts/${slug}.md`,
    sdkMetadata(concept.id, "concept", concept.title, scope.asOf, operationId),
    atlas,
    bodyLines.join("\n"),
  );
}

function edgePage(
  edge: AtlasIngestCandidateEdge,
  scope: AtlasIngestScope,
  operationId: string,
): ParsedAtlasPage {
  const slug = slugForId(edge.id, "edge") as string;
  const atlas: AtlasBlock = {
    from: edge.from,
    semantics: [...edge.semantics],
    to: edge.to,
  };
  const { definitions, markers } = citationBody(edge.citations);
  const body = [
    `# ${edge.title}`,
    "",
    `${edge.context}${markers}`,
    "",
    definitions,
    "",
  ].join("\n");
  return pageEnvelope(
    `.atlas/edges/${slug}.md`,
    sdkMetadata(edge.id, "edge", edge.title, scope.asOf, operationId),
    atlas,
    body,
  );
}

function changelogEntry(
  graph: AtlasIngestCandidateGraph,
  scope: AtlasIngestScope,
  operationId: string,
  refresh: boolean,
): AtlasIngestChange {
  const verb = refresh ? "Refreshed" : "Ingested";
  return Object.freeze({
    content: [
      "# Changelog",
      "",
      `## ${scope.asOf}`,
      "",
      `- ${operationId}: ${verb} ${scope.sourceId} approved by ${scope.approvedBy} at ${scope.approvedAt} into ${String(graph.concepts.length)} Concept(s) with cited Source and Edges.`,
      "",
    ].join("\n"),
    path: ".atlas/CHANGELOG.md",
  });
}

/** The Source paths a citation footnote for these structured Citations resolves
 * to, so the emitted body can be checked against the structured evidence. */
function structuredCitationPaths(
  citations: readonly AtlasIngestCandidateCitation[],
): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        citations.map(
          (citation) =>
            `.atlas/sources/${slugForId(citation.sourceId, "source") as string}.md`,
        ),
      ),
    ].sort(compareCodePoints),
  );
}

/**
 * The one deterministic reconciliation from a validated Candidate Graph into an
 * Atlas Change Set, reconciled against the Home Atlas it will modify: an
 * identity the Atlas already holds is recorded as a Source Refresh rather than a
 * new page. Frontmatter is emitted through the house serializer, so the same
 * validated graph always reconciles to the same bytes and no crawled value can
 * be interpolated into structured YAML.
 */
export function reconcileCandidateGraph(
  state: AtlasIngestWorkflowState,
  request: AtlasIngestRequest,
  existingFiles: readonly CapturedAtlasFile[] = [],
): AtlasIngestChangeSet {
  const { candidateGraph: graph, scope } = request;
  const existing = readExistingAtlas(existingFiles);
  const refresh = existing.sourceText.has(scope.sourceId);
  const pages: ParsedAtlasPage[] = [];
  for (const source of graph.sources) {
    pages.push(sourcePage(source, scope, state.operationId));
  }
  for (const concept of graph.concepts) {
    pages.push(conceptPage(concept, scope, state.operationId));
  }
  for (const edge of graph.edges) {
    pages.push(edgePage(edge, scope, state.operationId));
  }
  const changes: AtlasIngestChange[] = [
    changelogEntry(graph, scope, state.operationId, refresh),
    ...serializeAtlasPages(pages).map((file) =>
      Object.freeze({ content: file.content, path: file.path }),
    ),
  ];
  return Object.freeze({
    baseSnapshotDigest: state.baseSnapshotDigest,
    changes: Object.freeze(
      changes.toSorted((left, right) => compareCodePoints(left.path, right.path)),
    ),
    targetHead: state.targetHead,
  });
}

// After emission and before any write, the citation footnotes actually present
// in each derived page's body must resolve to exactly the structured Citations
// that were validated. A footnote forged into a free-text claim or context would
// attach an extra Source to the committed page while `atlas.evidence` and the
// validated Candidate Graph list fewer; this equality refuses that laundering.
function bodyOf(content: string): string {
  const closing = content.indexOf("\n---\n", content.indexOf("---") + 3);
  return closing === -1 ? content : content.slice(closing + "\n---\n".length);
}

export function validateCitationCorrespondence(
  request: AtlasIngestRequest,
  changeSet: AtlasIngestChangeSet,
): readonly Finding[] {
  const findings: Finding[] = [];
  const byPath = new Map(changeSet.changes.map((change) => [change.path, change]));
  const check = (
    id: string,
    directory: string,
    prefix: string,
    citations: readonly AtlasIngestCandidateCitation[],
  ): void => {
    const slug = slugForId(id, prefix);
    if (slug === undefined) return;
    const path = `.atlas/${directory}/${slug}.md`;
    const change = byPath.get(path);
    if (change === undefined) return;
    const bodyPaths = resolvedCitationSourcePaths(bodyOf(change.content));
    const expected = structuredCitationPaths(citations);
    const equal =
      bodyPaths.length === expected.length &&
      bodyPaths.every((value, index) => value === expected[index]);
    if (!equal) {
      findings.push(
        finding(
          "ATLAS_INGEST_CITATION_CORRESPONDENCE",
          "A derived page's body cites Sources its validated Citations do not; every emitted Citation must correspond to a structured Citation.",
          path,
        ),
      );
    }
  };
  for (const concept of request.candidateGraph.concepts) {
    check(concept.id, "concepts", "concept", concept.citations);
  }
  for (const edge of request.candidateGraph.edges) {
    check(edge.id, "edges", "edge", edge.citations);
  }
  return Object.freeze(findings);
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
      hasControlCharacter(change.path) ||
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

    const existingFiles = runtime.existingAtlasFiles();
    const graphFindings = validateCandidateGraph(request, existingFiles);
    // A page whose frontmatter values are structurally sound is emitted, and its
    // change set, citation correspondence, and resume receipts are cross-checked.
    // A graph with a structural error is never emitted, so no invalid page and no
    // adversarial worktree churn precedes the blocking Findings.
    const emittable = graphFindings.every((entry) => entry.severity !== "error");
    let changeSet: AtlasIngestChangeSet | undefined;
    let emissionFindings: readonly Finding[] = [];
    if (emittable) {
      try {
        changeSet = reconcileCandidateGraph(state, request, existingFiles);
      } catch {
        emissionFindings = Object.freeze([
          finding(
            "ATLAS_INGEST_PAGE_EMISSION_INVALID",
            "A derived page could not be emitted through the house serializer, so nothing was written.",
          ),
        ]);
      }
      if (changeSet !== undefined) {
        emissionFindings = Object.freeze([
          ...validateAtlasIngestChangeSet(state, changeSet),
          ...validateCitationCorrespondence(request, changeSet),
          ...validateResumeReceipts(state, changeSet),
        ]);
      }
    }
    const findings = Object.freeze([...graphFindings, ...emissionFindings]);
    if (!canContinue(findings) || changeSet === undefined) {
      return result(
        state,
        "not-completed",
        "failed",
        changeSet === undefined ? {} : { changeSet },
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
