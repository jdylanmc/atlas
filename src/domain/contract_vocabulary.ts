export interface ContractVocabularyBinding {
  readonly exportedIdentifiers: readonly string[];
  readonly term: string;
}

/**
 * SDK-owned contract result terms that are not Core Archetypes. Each term is
 * bound to the exported TypeScript identifiers that carry the public contract,
 * so a code rename without a glossary rename is reported.
 */
export const contractVocabularyBindings = Object.freeze([
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasLintResult"]),
    term: "Atlas Lint Result",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasView"]),
    term: "Atlas View",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["ValidAtlasLintResult"]),
    term: "Valid Atlas Lint Result",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["InvalidAtlasLintResult"]),
    term: "Invalid Atlas Lint Result",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["OperationResult"]),
    term: "Operation Result",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["OperationHandoff"]),
    term: "Operation Handoff",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["SearchProvider"]),
    term: "Search Provider",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasSnapshot"]),
    term: "Atlas Snapshot",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasInitializationResult"]),
    term: "Atlas Initialization",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze([
      "AtlasInitializationWorkflowState",
      "AtlasGovernanceWorkflowState",
      "AtlasIngestWorkflowState",
    ]),
    term: "Operation Workflow",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze([
      "AtlasInitializationChangeSet",
      "AtlasGovernanceChangeSet",
      "AtlasIngestChangeSet",
    ]),
    term: "Atlas Change Set",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["LintStamp"]),
    term: "Lint Stamp",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasReadinessReport"]),
    term: "Atlas Readiness Report",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasIngestResult"]),
    term: "Ingest",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasIngestScope"]),
    term: "Ingest Scope",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasApprovalAttestation"]),
    term: "Approval Attestation",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasIngestCandidateGraph"]),
    term: "Candidate Graph",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["CoreArchetypeIdentifiers"]),
    term: "Core Archetype",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["SourceAuthority"]),
    term: "Source Authority",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["ContractVocabularyBinding"]),
    term: "Vocabulary Binding",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["LintOperationResult"]),
    term: "Lint",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["Finding"]),
    term: "Finding",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["ExploreOperationResult"]),
    term: "Explore",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["ExploreDegradationLevel"]),
    term: "Degraded Explore",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasIngestCandidateCitation"]),
    term: "Citation",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasIngestCrawlAssignment"]),
    term: "Crawlers",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AgentPersona"]),
    term: "Agent Persona",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AgentDirective"]),
    term: "Agent Directive",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AgentComposition"]),
    term: "Agent Composition",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AgentPersonaDesignRequest"]),
    term: "Persona Design",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["HostIntegrationPointer"]),
    term: "Host Integration",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasLocator"]),
    term: "Atlas Locator",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasSlug"]),
    term: "Atlas Slug",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasCache"]),
    term: "Atlas Cache",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasLock"]),
    term: "Atlas Lock",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["TrackedAtlas"]),
    term: "TrackedAtlas",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["atlasManifestPath", "canonicalAtlasManifest"]),
    term: "Atlas Manifest",
  }),
] as const) satisfies readonly ContractVocabularyBinding[];

export interface UnboundGlossaryTerm {
  readonly reason: string;
  readonly term: string;
}

/**
 * Every other CONTEXT.md glossary term, together with why Atlas SDK does not
 * bind it to an exported contract identifier today. This is a decision, not a
 * prediction: a term recorded here has no bound contract as of this
 * classification, and moves to `contractVocabularyBindings` (or to a Core
 * Archetype) the day one is deliberately built and bound for it. Trusted
 * vocabulary validation requires every glossary term to appear exactly once
 * across the Core Archetypes, `contractVocabularyBindings`, and this list, so
 * a term can no longer go unclassified by omission.
 */
export const unboundGlossaryTerms = Object.freeze([
  Object.freeze({
    reason: "The product name, not an exported contract identifier.",
    term: "Atlas SDK",
  }),
  Object.freeze({
    reason:
      "A generic domain concept several operations act on; no single exported type names it.",
    term: "Atlas",
  }),
  Object.freeze({
    reason: "A plain host directory path parameter, not a typed contract.",
    term: "Atlas Host Directory",
  }),
  Object.freeze({
    reason: "A conceptual role; not yet implemented.",
    term: "Atlas Guide",
  }),
  Object.freeze({
    reason:
      "The shared preflight is folded into each operation's own Home Atlas resolution rather than a dedicated exported contract (see #158).",
    term: "Atlas Entry",
  }),
  Object.freeze({
    reason: "A designation of which Atlas is home, not itself a type.",
    term: "Home Atlas",
  }),
  Object.freeze({
    reason: "A specific instance (this repository's own Atlas), not a type.",
    term: "SDK Atlas",
  }),
  Object.freeze({
    reason: "Not yet implemented.",
    term: "Check SDK",
  }),
  Object.freeze({
    reason: "Not yet implemented.",
    term: "Tool Runtime",
  }),
  Object.freeze({
    reason:
      "Realized as frontmatter schema-version fields, not a dedicated exported type.",
    term: "Atlas Schema",
  }),
  Object.freeze({
    reason: "Not yet implemented (connected Atlas feature).",
    term: "Atlas Refresh",
  }),
  Object.freeze({
    reason: "Not yet implemented (connected Atlas feature).",
    term: "Atlas Pruning",
  }),
  Object.freeze({
    reason: "Not yet implemented (connected Atlas feature).",
    term: "Atlas Untracking",
  }),
  Object.freeze({
    reason: "Not yet implemented (connected Atlas feature).",
    term: "Expand",
  }),
  Object.freeze({
    reason: "Not yet implemented (QMD/search acceleration feature).",
    term: "Explore Index",
  }),
  Object.freeze({
    reason:
      "Realized as a Markdown file convention and rendering functions, not a dedicated exported type.",
    term: "Atlas Changelog",
  }),
  Object.freeze({
    reason: "Not yet implemented.",
    term: "Atlas Site",
  }),
  Object.freeze({
    reason: "Not yet implemented (Atlas Site feature).",
    term: "Knowledge Health",
  }),
  Object.freeze({
    reason: "Not yet implemented (Atlas Site feature).",
    term: "Knowledge Evolution",
  }),
  Object.freeze({
    reason:
      "A specific Anchor instance identified by a constant page ID, not a distinct type from Anchor.",
    term: "Root Anchor",
  }),
  Object.freeze({
    reason:
      "A hyphenated term cannot satisfy the capitalized-phrase pattern a contract binding requires, even though ExploreReanchor exists.",
    term: "Re-anchor",
  }),
  Object.freeze({
    reason: "Not yet implemented (Source lifecycle feature).",
    term: "Source Refresh",
  }),
  Object.freeze({
    reason: "A plain timestamp field, not a dedicated exported type.",
    term: "Source Revision Time",
  }),
  Object.freeze({
    reason: "Represented generically through Lint Findings, not a dedicated type.",
    term: "Stale Knowledge",
  }),
  Object.freeze({
    reason: "A human role recorded as a plain string field, not a typed contract.",
    term: "Maintainer",
  }),
  Object.freeze({
    reason: "Not yet implemented.",
    term: "Directly Responsible Individual (DRI)",
  }),
  Object.freeze({
    reason: "Not yet implemented as a distinct type.",
    term: "Principle Amendment",
  }),
  Object.freeze({
    reason: "Represented generically through Lint Findings, not a dedicated type.",
    term: "Contradiction",
  }),
  Object.freeze({
    reason: "Not yet implemented (connected Atlas feature).",
    term: "Divergence",
  }),
  Object.freeze({
    reason: "Not yet implemented as a distinct type.",
    term: "Dispute",
  }),
  Object.freeze({
    reason:
      "Governed alongside Principle through the same generic governance types, with no Core Archetype entry or distinct exported identifier of its own yet.",
    term: "Atlas Policy",
  }),
  Object.freeze({
    reason: "Not yet implemented (Ingest Type Skill feature).",
    term: "Ingest Type",
  }),
  Object.freeze({
    reason: "Not yet implemented (Ingest Type Skill feature).",
    term: "Ingest Type Skill",
  }),
  Object.freeze({
    reason: "Not yet implemented.",
    term: "Challenge",
  }),
  Object.freeze({
    reason: "Realized as filesystem state, not a typed export.",
    term: "Operation Workspace",
  }),
  Object.freeze({
    reason: "Realized as Git branch and worktree conventions, not a dedicated type.",
    term: "Atlas Proposal",
  }),
  Object.freeze({
    reason: "Not yet implemented (concurrent proposal reconciliation feature).",
    term: "Stale Atlas Proposal",
  }),
  Object.freeze({
    reason: "A Git ref concept, not a type.",
    term: "Atlas Head",
  }),
  Object.freeze({
    reason: "Not yet implemented (concurrent proposal reconciliation feature).",
    term: "Proposal Footprint",
  }),
  Object.freeze({
    reason: "Not yet implemented (concurrent proposal reconciliation feature).",
    term: "Proposal Reconciliation",
  }),
] as const) satisfies readonly UnboundGlossaryTerm[];
