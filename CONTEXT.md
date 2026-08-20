# Atlas

Atlas is a structured knowledge environment that helps coding agents discover and traverse project-relevant knowledge.

## Language

**Atlas**:
The framework and operation-scoped composite view through which an agent discovers connected knowledge domains. Atlas does not own a central knowledge graph or registry.

**Realm**:
A sovereign, bounded knowledge domain rooted in one Realm Host Directory. Its knowledge, governance, automation, and records live beneath `.atlas/`, and it may track other Realms.
_Avoid_: Region

**Realm Host Directory**:
The directory containing a Realm's `.atlas/`. It may be a Git worktree root or a subdirectory within one. A Git worktree may contain several Realm Host Directories only when they are disjoint: no Realm Host Directory may contain another. Repository root is the encouraged default, with multiple Realms reserved for exceptional monorepo boundaries.

**Realm Initialization**:
The human-facing workflow that interactively composes one new Realm's orientation, optional Guide Persona, human-approved governance, scoped founding knowledge, navigation, publication choice, and operational integration. It ends with one reviewable Realm Proposal carrying the Realm's first Lint Stamp.

**Agent Persona**:
An optional named identity, display profile, and avatar that shape an agent's conversational voice, tone, and visual or editorial flavor without changing semantic meaning. A Persona carries no behavioral or governance authority, does not shape the authored voice of Concepts or Principles, and remains separate from the agent's Directive.

**Agent Directive**:
The literal statement of an agent role's objectives, responsibilities, allowed actions, constraints, and required handoffs. An Atlas-owned baseline may be specialized by a separate Realm-owned layer that cannot weaken the baseline, Framework contracts, or Realm Policies. A Directive is precise instruction, not character prose.

**Agent Composition**:
The declarative pairing of zero or one Agent Persona with an ordered set of one or more Agent Directives. Directives remain authoritative and determine behavior; an optional Persona shapes only eligible presentation, cannot change semantic meaning, and loses every conflict with a Directive.

**Persona Design**:
The human-guided workflow that elicits, proposes, and validates an Agent Persona before writing it into Realm ownership. Approval of the Persona and confirmation to begin using its provisional voice are separate decisions.

**Realm Guide**:
The Realm-owned caretaker and Realm Site chief marketing officer that guides navigation, narrates Re-anchoring, drafts Changelog entries, and proactively stewards the knowledge store under human governance. The Home Realm Guide supplies the human-facing voice for Atlas responses even when their knowledge comes from another Realm; source identity and evidence remain explicit. It may propose precise provisional terminology for unnamed concepts, but reviewed adoption is required before a term becomes canonical. Its Directive defines the work and proposal authority; its optional Agent Persona defines the flavor.

**Realm Entry**:
The shared preflight through which an Atlas skill identifies the Home Realm for the current Realm Host Directory, verifies tooling and schema compatibility, and loads only the instructions and context required by that operation. Entry classifies the Home Realm as ready, degraded, or blocked before the skill proceeds.

**Host Integration**:
The optional host-owned thin discovery and loading layer that points an agent harness to canonical skills, Directives, Personas, and compositions under `.atlas/`. It contains no duplicated Atlas behavior and remains outside Framework Upgrade ownership.

**Home Realm**:
The Realm owned by the current Realm Host Directory and identified by Realm Entry. Its committed maintenance code is trusted at the same level as its host repository; every other Realm is connected through cross-Realm Edges and remains read-only cached data.

**Atlas SDK Realm**:
The canonical upstream Home Realm of the Atlas repository, displayed as **Atlas SDK** and identified by the Realm Slug `atlas-sdk`. It maintains cited knowledge about Atlas's purpose, architecture, implementation, onboarding, operation, and use, while Framework Releases carry its enforceable core contracts into sovereign Realms. Its deployed Realm Site is the canonical destination linked by other Realms when explaining Atlas. Merlin is its designated Realm Guide.

**Framework Bundle**:
The Atlas-owned, portable baseline committed inside a Realm. It contains the installed Framework Release Manifest and that manifest's complete inventory of Atlas-owned files, whose bytes remain immutable while the release is pinned. Together they provide the instructions, contracts, and maintenance tooling that make the Realm operable without joining the host application's dependency ecosystem, and an upgrade replaces them atomically as one governed unit.

**Framework Release**:
One exact version of the Atlas-owned runtime, core contracts, packaged skills, templates, and adapters from which a Realm's Framework Bundle is derived. A Home Realm pins one Framework Release while its Realm Schema evolves independently.

**Framework Release Manifest**:
The immutable inventory and compatibility contract included in one Framework Release and installed in its Framework Bundle. It identifies every complete Atlas-owned file and its digest, supported environments and Realm contracts, and the explicit migration paths to and from other supported releases.

**Framework Upgrade**:
The governed workflow that replaces a Home Realm's pinned Framework Release as one isolated, fully Linted Realm Proposal while preserving Realm-owned state. A completed upgrade operation has proposed the change for review; the target release becomes active only when that proposal merges.

**Check SDK**:
The Framework Release's typed, read-only interface for Realm-owned deterministic checks. It exposes the parsed Home Realm model and graph-oriented utilities so checks express Realm-specific invariants without parsing knowledge files or acquiring host dependencies.

**Tool Runtime**:
An Atlas-managed machine-scoped installation of a heavyweight replaceable tool used by many Realms. A Tool Runtime is disposable, version-coupled generated state rather than part of a Realm or the host application's dependencies.

**Realm Locator**:
The normalized Git repository URL, branch, and Realm-relative path that identifies a tracked Realm. Normalization settles syntax only, never identity: host case, `.git` suffixes, trailing separators, embedded credentials, and equivalent SSH and HTTPS forms of one repository resolve together, while owner, repository, branch, and path remain significant.

**Realm Slug**:
The deterministic reference name of a Realm, derived from its Realm Locator rather than chosen by a human. It combines host, owner, repository, and Realm-relative path, names the branch only when it is not the repository default, and identifies the Realm in caches, cross-Realm references, and publication paths.

**Realm Cache**:
The generated, Git-ignored store beneath a Realm's `.atlas/` holding read-only working copies of tracked Realms, one flat entry per Realm Locator, materialized on first entry. Realm Cache entries are disposable data: they are never edited, executed, or used as a place from which a Realm is maintained.

**Realm Snapshot**:
The exact Git commit of a Realm used during one operation. A snapshot records observed context but is not the Realm's logical identity.

**Realm Manifest**:
The human-authored declaration of a Realm's intended knowledge contract and local configuration.

**Realm Schema**:
The versioned extension contract that adds Realm-specific page types, fields, relationship semantics, and validation while inheriting and preserving Atlas core archetype behavior.

**Realm Lock**:
The generated, local record of resolved schema versions, tracked Realm Snapshots, fetch times, and the lazily materialized Realm dependency graph. It records which Anchor gateway and cross-Realm Edge introduced each dependency. Realm Lock is replaceable cache state rather than committed Realm knowledge.

**Realm Refresh**:
The pull that returns a Realm Cache entry to its tracked branch tip. Refresh happens automatically when an entry is older than the freshness window its declaration allows, and on demand when a human asks for it. Refresh never merges: divergent upstream history replaces the cached copy outright.

**Realm Pruning**:
The local removal of disposable Realm Cache entries and their generated references without changing committed Realm knowledge. A pruned Realm that remains tracked is materialized again when next entered.

**Realm Untracking**:
The human-approved knowledge change that ends a Home Realm's active relationship with one Realm Slug by removing its declaration and cross-Realm Edges and repairing affected orientation. Untracking preserves independent knowledge, Git history, and disposable cache state.

**Expand**:
The read-only workflow that expands a Realm Cache by one graph layer. Expand follows the selected Realm Snapshot's Anchor gateway Edges, materializes its directly related Realms with human approval, and refreshes generated Lock and search state without changing Realm knowledge.
_Avoid_: Scout

**Explore Index**:
The generated, disposable search state owned by one Realm Host Directory. It indexes that Realm and its materialized reachable Realm Snapshots behind a replaceable provider interface while Atlas retains responsibility for graph reachability, routing, validation, and context.

**Search Provider**:
A replaceable candidate-ranking capability that indexes deterministic Realm projections and returns scored Realm objects. It never owns Realm reachability, Anchor routing, Re-anchoring, evidence, graph traversal, or final context loading.

**Realm Changelog**:
The curated, human-readable history of notable knowledge changes in a Realm, kept as `.atlas/CHANGELOG.md`. One entry, identified by its stable operation ID, records one merged knowledge-changing operation and can be correlated with Git history. The Changelog is history a newcomer can read, not an operational ledger and not synthesized knowledge.
_Avoid_: Realm Chronicle

**Realm Site**:
An optional, read-only static projection through which humans browse one Home Realm's published knowledge, governance, history, and evolution. It is derived from validated Realm state, is neither a raw `.atlas/` mirror nor an interactive Atlas runtime, and exposes only what a Realm Policy scoped to publication allows. Site build mechanics belong to each Realm rather than to Atlas.

**Knowledge Health**:
The Realm Site's current evidence-linked view of whether the published Realm Head passes a full Lint and how fresh its supporting Source is. Structural, governance, and connection diagnostics explain those two headline signals without collapsing them into a composite score.

**Knowledge Evolution**:
The Realm Site's reconstruction of how a Realm's knowledge, evidence, graph, and governance changed across Changelog operation IDs in Git history. It describes durable understanding rather than agent or contributor productivity.

**Anchor**:
A human-approved, Realm-local page through which an agent enters a region of knowledge and from which every route to a result begins. It provides cited orientation and named paths while Concepts hold detailed understanding, and a Realm establishes one where related ideas strongly intersect. Ingest and Lint may recommend Anchors according to Realm policy, but agents do not establish them autonomously. An Anchor may connect through a cross-Realm Edge to another Realm, but it is not authoritative source material.
_Avoid_: Bonfire, Landmark, Hub

**Root Anchor**:
The permanent `.atlas/index.md` Anchor through which an agent enters a Realm. It carries orientation and additionally catalogs pages not otherwise reachable from an Anchor. A cross-Realm Edge resolves a tracked Realm's Realm Slug, lands at its Root Anchor, and re-anchors there.

**Re-anchor**:
The mandatory re-anchoring checkpoint performed whenever an agent reaches an Anchor. The agent re-reads the Anchor orientation and every active Principle directly connected to it, then restates its active objective and the truths governing the path before continuing.
_Avoid_: Rest

**Source**:
The Realm's record of one piece of source material or a pointer to it, together with its source metadata, ingestion method, refresh history, freshness dates, immutable revision or digest, and Realm-assigned Source Authority. A Source is evidence, not synthesized understanding.
_Avoid_: Lore

**Source Refresh**:
The targeted re-Ingest of one existing Source object when its own refresh lifecycle is due. It records the source's latest revision and Source Revision Time, then re-integrates affected knowledge and fully Lints one Realm Proposal.

**Source Authority**:
A Realm-configured priority class assigned to Source according to its origin, such as official, first-party, community, or opinion. Conflicting claims resolve first by Source Authority, subject to applicable Principles and Realm Policies.

**Source Revision Time**:
The update time asserted by the exact cited source revision, such as a Git commit time or captured page metadata. It breaks conflicts between equal-Authority Source when trustworthy and comparable; Ingest time is never a substitute, and unresolved ties require human adjudication.

**Concept**:
Derived understanding of exactly one concept, whose factual claims remain traceable through Citations to the Sources from which they were formed. A page covering several concepts is split into separate Concepts joined by an Anchor. Every Concept carries at least one Edge, so no page is unreachable by traversal.
_Avoid_: Insight

**Citation**:
A claim-level reference to a Source object that supports an agent-managed claim. Concepts, Anchors, and Edges require Citations; Principles are exempt because their truths are established by humans. A claim's effective Source Authority is derived from its cited Source. Citations are not Edges.

**Stale Knowledge**:
Derived knowledge supported by Source whose Realm-defined refresh date has elapsed. Stale Knowledge remains traversable, but Lint surfaces it and the agentic workflow offers to re-Ingest the supporting Source.

**Edge**:
A first-class Markdown relationship used to traverse Concepts, Principles, Anchors, and Realm-defined extensions of those archetypes. Zero or one Edge exists per unordered in-Realm page pair. It has a stable identity, canonical direction, one or more typed semantics, explanatory context, and Citations supporting the asserted relationship. A cross-Realm Edge instead connects an Anchor to a tracked Realm identified by its Realm Slug. Edges do not connect to Sources.
_Avoid_: Thread

**Principle**:
A human-governed, Realm-local page of individually identified active universal truths that hold across a Realm. A Principle has a stable identity, explains what it governs, and keeps a Keep a Changelog-style amendment history. Deleting a Principle invalidates all of its active truths and requires its dependent knowledge relationships and governance markers to be reconciled. Agents may help create, modify, or delete a Principle only under explicit human direction and approval.
_Avoid_: Pillar

**Maintainer**:
Any human acting through the Realm Host Directory's Git governance to direct or approve changes to Principles or Realm Policies. Maintainer is a contextual authority role, not a permanently named owner.
_Avoid_: Creator, Owner

**Principle Amendment**:
A numbered, dated entry appended to a Principle's amendment history. It records added, changed, or invalidated truths together with the directing or approving human, rationale, and change reference. Meaning-preserving clarification retains a truth's stable identity; semantic replacement invalidates the old truth and adds a linked successor with a new identity.

**Contradiction**:
A Realm-local claim that contradicts an active Principle truth or violates a Realm Policy. An accepted Contradiction is marked on its citation and on the containing Concept so agents can preserve it without mistaking it for ordinary knowledge.
_Avoid_: Heresy

**Divergence**:
A non-persistent disagreement surfaced while an agent traverses knowledge from multiple sovereign Realms. Divergence does not invalidate either Realm and is presented to the human for clarification.

**Dispute**:
A warning that two cited Concept claims within one Realm conflict without contradicting a Principle. The Lint workflow surfaces the evidence and Source Authority, then works with a human to reconcile or scope the claims.

**Realm Policy**:
A human-approved, versioned invariant that governs a Realm. Each Policy declares its scope, naming the workflows it governs such as Realm maintenance or publication; its evaluation, either deterministic or semantic and therefore subject to Challenge; and its consequence, either invalidating the Realm or blocking only the operation it governs. A Policy retains its stable identity while its governing intention remains the same and retires rather than disappears. Agents may propose Policies and amendments but cannot establish them autonomously. Explore is never governed by Policies; it loads a Realm's Policies once, when traversal first enters that Realm, as descriptive context.
_Avoid_: Realm Law, Realm Rule

**Ingest**:
The human-facing workflow for ingesting Sources and updating a Realm's derived knowledge. Ingest runs inside the Realm's own repository and takes one source per invocation. A source that is itself a Realm becomes a tracked Realm and a human-agreed cross-Realm Edge rather than a Source.
_Avoid_: Gather

**Ingest Scope**:
The human-approved traversal envelope for one Ingest source, including its entry point, depth or stopping rule, included and excluded regions, and relevant authority and freshness assumptions. Crawlers may fully traverse within it but must request approval before expanding beyond it.

**Ingest Type**:
A canonical structured-source contract whose recognizable semantics warrant a reusable Ingest optimization. Its identity follows the source contract rather than its transport, serialization, branding, or subject matter alone.

**Ingest Type Skill**:
A reusable `ingest-<type>` source adapter that makes repeated Ingest operations for one Ingest Type cheaper and more consistent. Whether Framework-provided, downloaded, or learned, it may specialize source handling but never owns Realm synthesis or governance.

**Crawlers**:
The read-only subagents an Ingest dispatches to crawl one source in parallel. Crawlers report candidates and never writes to a Realm.
_Avoid_: Fleet

**Candidate Graph**:
The proposed concepts, Edges, and Citations Crawlers return from one source, reconciled against existing knowledge before anything is written. It is working material, not Realm knowledge.

**Lint**:
The human-facing workflow for validating a Realm. Trusted deterministic validation runs before isolated Realm-owned deterministic checks and semantic verification, and every semantic verdict must survive a Challenge before it counts; pure Lint reports findings without mutating knowledge. Lint also reports what a Realm is missing, and validates a Realm's edges into tracked Realms rather than their contents.
_Avoid_: Weave

**Lint Stamp**:
A deterministic machine-readable attestation that one exact Realm commit completed a full Lint under identified Framework, schema, check, Policy, and evidence revisions. It is reproducible validation evidence rather than committed Realm knowledge, and any change to the stamped commit invalidates it.

**Finding**:
One result reported by a Lint, attributed to the check that raised it and to whether that check is trusted Atlas validation or Realm-owned. A finding is an error, a warning, a suggestion, an inconclusive semantic verdict, or a check skipped because one it depended on failed. A Realm-owned check may add findings; it may never suppress or downgrade a trusted one.

**Challenge**:
The adversarial review a semantic verdict must survive before it counts. A challenger receives the verdict and its cited evidence and argues against it; disagreement makes the verdict inconclusive and escalates both arguments to a human.

**Operation Handoff**:
The stable completion summary returned by every Atlas skill. It identifies the operation, Home Realm and base snapshot, result or proposed changes, unresolved human decisions, validation or degradation state, review link when applicable, and recommended next action.

**Operation Workflow**:
The versioned resumable state machine for one Atlas operation. It consumes typed events and yields typed effects while the deterministic runtime retains authority over state transitions, evidence, allowed writes, and validation gates.

**Realm View**:
The immutable operation-scoped model parsed from exact Home and tracked Realm Snapshots. It carries normalized Realm objects, source locations, file digests, ownership, validation state, and Atlas-owned graph indexes.

**Realm Change Set**:
The typed proposal of intended Realm file and graph changes against one Realm View's base digests. A validated Change Set is the only input from which the proposal writer may serialize Realm changes.

**Operation Workspace**:
The ephemeral repository-local state for one resumable operation, including checkpoints, effect receipts, temporary evidence, locks, and proposal-worktree references. It lives outside Realm knowledge and may be resumed or explicitly discarded.

**Realm Readiness Report**:
The Realm Initialization handoff and pull-request description that explains the proposed Realm boundary, Guide, governance, founding evidence and graph, integrations, degradations, uninspected areas, first Lint Stamp, and recommended next actions.

**Realm Proposal**:
The isolated branch, worktree, and pull request through which one knowledge-changing operation or Framework Upgrade proposes changes to a Home Realm. A Framework Upgrade uses the same reconciliation and full Lint gate without changing Realm knowledge. A Realm Proposal is anchored to a base commit and must reconcile against the current target branch before it can merge.

**Stale Realm Proposal**:
A Realm Proposal whose target branch has advanced since its last successful reconciliation and full Lint. It cannot merge until Atlas rebases and revalidates it against the new target state.

**Realm Head**:
The current target-branch commit containing the Home Realm's authoritative merged state. Every Realm Proposal must be reconciled and fully Linted against the current Realm Head before it can merge.

**Proposal Footprint**:
The Sources, Realm objects, governing truths, schema contracts, and connected knowledge neighborhood on which a Realm Proposal's meaning depends. Atlas compares this footprint with changes since the proposal's base to decide whether ordinary reconciliation is sufficient or its synthesis must be rebuilt.

**Proposal Reconciliation**:
The process that brings a Stale Realm Proposal onto the current Realm Head, resolves permitted mechanical and agent-managed overlaps, rebuilds synthesis when its Proposal Footprint has materially drifted, and requires a new full Lint before merge.

**Explore**:
The human-facing workflow for querying and traversing knowledge through Anchors, Edges, and supporting nodes. Explore searches an Explore Index for relevant entry points, then follows a required Anchor-to-result route through one fixed set of Realm Snapshots. It reads tracked Realms only through the Realm Cache and never modifies them.
_Avoid_: Query, when naming the user-facing skill

**Degraded Explore**:
Best-effort read-only traversal used when a Realm Snapshot cannot be fully validated. Explore progressively falls back from valid structured objects to partial structure, raw `.atlas/` Markdown, or a cached snapshot while surfacing diagnostics.
