# Atlas SDK

Atlas SDK is a structured knowledge environment that helps coding agents discover and traverse project-relevant knowledge.

## Language

**Atlas SDK**:
The framework and operation-scoped composite view through which an agent discovers connected knowledge domains. Atlas SDK does not own a central knowledge graph or registry.

**Atlas**:
A sovereign, bounded knowledge domain rooted in one Atlas Host Directory. Its knowledge, governance, automation, and records live beneath `.atlas/`, and it may track other Atlases.
_Avoid_: Region

**Atlas Host Directory**:
The directory containing an Atlas's `.atlas/`. It may be a Git worktree root or a subdirectory within one. A Git worktree may contain several Atlas Host Directories only when they are disjoint: no Atlas Host Directory may contain another. Repository root is the encouraged default, with multiple Atlases reserved for exceptional monorepo boundaries.

**Atlas Initialization**:
The human-facing workflow that interactively composes one new Atlas's orientation, optional Guide Persona, human-approved governance, scoped founding knowledge, navigation, publication choice, and operational integration. It ends with one reviewable Atlas Proposal carrying the Atlas's first Lint Stamp.

**Agent Persona**:
An optional named identity, display profile, and avatar that shape an agent's conversational voice, tone, and visual or editorial flavor without changing semantic meaning. A Persona carries no behavioral or governance authority, does not shape the authored voice of Concepts or Principles, and remains separate from the agent's Directive.

**Agent Directive**:
The literal statement of an agent role's objectives, responsibilities, allowed actions, constraints, and required handoffs. An SDK-owned baseline may be specialized by a separate Atlas-owned layer that cannot weaken the baseline, Framework contracts, or Atlas Policies. A Directive is precise instruction, not character prose.

**Agent Composition**:
The declarative pairing of zero or one Agent Persona with an ordered set of one or more Agent Directives. Directives remain authoritative and determine behavior; an optional Persona shapes only eligible presentation, cannot change semantic meaning, and loses every conflict with a Directive.

**Persona Design**:
The human-guided workflow that elicits, proposes, and validates an Agent Persona before writing it into Atlas ownership. Approval of the Persona and confirmation to begin using its provisional voice are separate decisions.

**Atlas Guide**:
The Atlas-owned caretaker and Atlas Site chief marketing officer that guides navigation, narrates Re-anchoring, drafts Changelog entries, and proactively stewards the knowledge store under human governance. The Home Atlas Guide supplies the human-facing voice for Atlas SDK responses even when their knowledge comes from another Atlas; source identity and evidence remain explicit. It may propose precise provisional terminology for unnamed concepts, but reviewed adoption is required before a term becomes canonical. Its Directive defines the work and proposal authority; its optional Agent Persona defines the flavor.

**Atlas Entry**:
The shared preflight through which an Atlas SDK skill identifies the Home Atlas for the current Atlas Host Directory, verifies tooling and schema compatibility, and loads only the instructions and context required by that operation. Entry classifies the Home Atlas as ready, degraded, or blocked before the skill proceeds.

**Host Integration**:
The optional host-owned thin discovery and loading layer that points an agent harness to canonical skills, Directives, Personas, and compositions under `.atlas/`. It contains no duplicated Atlas SDK behavior and remains outside Framework Upgrade ownership.

**Home Atlas**:
The Atlas owned by the current Atlas Host Directory and identified by Atlas Entry. Its committed maintenance code is trusted at the same level as its host repository; every other Atlas is connected through cross-Atlas Edges and remains read-only cached data.

**SDK Atlas**:
The canonical upstream Home Atlas of the Atlas SDK repository, displayed as **Atlas SDK** and identified by the Atlas Slug `atlas-sdk`. It maintains cited knowledge about Atlas SDK's purpose, architecture, implementation, onboarding, operation, and use, while Framework Releases carry its enforceable core contracts into sovereign Atlases. Its deployed Atlas Site is the canonical destination linked by other Atlases when explaining Atlas SDK. Merlin is its designated Atlas Guide.

**Framework Bundle**:
The SDK-owned, portable baseline committed inside an Atlas. It contains the installed Framework Release Manifest and that manifest's complete inventory of SDK-owned files, whose bytes remain immutable while the release is pinned. Together they provide the instructions, contracts, and maintenance tooling that make the Atlas operable without joining the host application's dependency ecosystem, and an upgrade replaces them atomically as one governed unit.

**Framework Release**:
One exact version of the SDK-owned runtime, core contracts, packaged skills, templates, and adapters from which an Atlas's Framework Bundle is derived. A Home Atlas pins one Framework Release while its Atlas Schema evolves independently.

**Framework Release Manifest**:
The immutable inventory and compatibility contract included in one Framework Release and installed in its Framework Bundle. It identifies every complete SDK-owned file and its digest, supported environments and Atlas contracts, and the explicit migration paths to and from other supported releases.

**Framework Upgrade**:
The governed workflow that replaces a Home Atlas's pinned Framework Release as one isolated, fully Linted Atlas Proposal while preserving Atlas-owned state. A completed upgrade operation has proposed the change for review; the target release becomes active only when that proposal merges.

**Check SDK**:
The Framework Release's typed, read-only interface for Atlas-owned deterministic checks. It exposes the parsed Home Atlas model and graph-oriented utilities so checks express Atlas-specific invariants without parsing knowledge files or acquiring host dependencies.

**Tool Runtime**:
An SDK-managed machine-scoped installation of a heavyweight replaceable tool used by many Atlases. A Tool Runtime is disposable, version-coupled generated state rather than part of an Atlas or the host application's dependencies.

**Atlas Locator**:
The normalized Git repository URL, branch, and Atlas-relative path that identifies a tracked Atlas. Normalization settles syntax only, never identity: host case, `.git` suffixes, trailing separators, embedded credentials, and equivalent SSH and HTTPS forms of one repository resolve together, while owner, repository, branch, and path remain significant.

**Atlas Slug**:
The deterministic reference name of an Atlas, derived from its Atlas Locator rather than chosen by a human. It combines host, owner, repository, and Atlas-relative path, names the branch only when it is not the repository default, and identifies the Atlas in caches, cross-Atlas references, and publication paths.

**Atlas Cache**:
The generated, Git-ignored store beneath an Atlas's `.atlas/` holding read-only working copies of tracked Atlases, one flat entry per Atlas Locator, materialized on first entry. Atlas Cache entries are disposable data: they are never edited, executed, or used as a place from which an Atlas is maintained.

**Atlas Snapshot**:
The exact Git commit of an Atlas used during one operation. A snapshot records observed context but is not the Atlas's logical identity.

**Atlas Manifest**:
The human-authored declaration of an Atlas's intended knowledge contract and local configuration.

**Atlas Schema**:
The versioned extension contract that adds Atlas-specific page types, fields, relationship semantics, and validation while inheriting and preserving Atlas SDK core archetype behavior. Every page declares two versions because two owners evolve on independent lifecycles: `atlas-sdk-schema` pins the SDK-owned page contract, which advances only through a governed Framework Upgrade, and `local-atlas-schema` pins the Atlas's own extensions built on top of it, which the Atlas may change at any time. Both declarations live in the page's SDK-owned block, because the Atlas SDK must read which local contract applies before it can interpret the Atlas-owned block that contract governs.

**Atlas Lock**:
The generated, local record of resolved schema versions, tracked Atlas Snapshots, fetch times, and the lazily materialized Atlas dependency graph. It records which Anchor gateway and cross-Atlas Edge introduced each dependency. Atlas Lock is replaceable cache state rather than committed Atlas knowledge.

**Atlas Refresh**:
The pull that returns an Atlas Cache entry to its tracked branch tip. Refresh happens automatically when an entry is older than the freshness window its declaration allows, and on demand when a human asks for it. Refresh never merges: divergent upstream history replaces the cached copy outright.

**Atlas Pruning**:
The local removal of disposable Atlas Cache entries and their generated references without changing committed Atlas knowledge. A pruned Atlas that remains tracked is materialized again when next entered.

**Atlas Untracking**:
The human-approved knowledge change that ends a Home Atlas's active relationship with one Atlas Slug by removing its declaration and cross-Atlas Edges and repairing affected orientation. Untracking preserves independent knowledge, Git history, and disposable cache state.

**Expand**:
The read-only workflow that expands an Atlas Cache by one graph layer. Expand follows the selected Atlas Snapshot's Anchor gateway Edges, materializes its directly related Atlases with human approval, and refreshes generated Lock and search state without changing Atlas knowledge.
_Avoid_: Scout

**Explore Index**:
The generated, disposable search state owned by one Atlas Host Directory. It indexes that Atlas and its materialized reachable Atlas Snapshots behind a replaceable provider interface while Atlas SDK retains responsibility for graph reachability, routing, validation, and context.

**Search Provider**:
A replaceable candidate-ranking capability that indexes deterministic Atlas projections and returns scored Atlas objects. It never owns Atlas reachability, Anchor routing, Re-anchoring, evidence, graph traversal, or final context loading.

**Atlas Changelog**:
The curated, human-readable history of notable knowledge changes in an Atlas, kept as `.atlas/CHANGELOG.md`. One entry, identified by its stable operation ID, records one merged knowledge-changing operation and can be correlated with Git history. The Changelog is history a newcomer can read, not an operational ledger and not synthesized knowledge.
_Avoid_: Realm Chronicle

**Atlas Site**:
An optional, read-only static projection through which humans browse one Home Atlas's published knowledge, governance, history, and evolution. It is derived from validated Atlas state, is neither a raw `.atlas/` mirror nor an interactive Atlas SDK runtime, and exposes only what an Atlas Policy scoped to publication allows. Site build mechanics belong to each Atlas rather than to Atlas SDK.

**Knowledge Health**:
The Atlas Site's current evidence-linked view of whether the published Atlas Head passes a full Lint and how fresh its supporting Source is. Structural, governance, and connection diagnostics explain those two headline signals without collapsing them into a composite score.

**Knowledge Evolution**:
The Atlas Site's reconstruction of how an Atlas's knowledge, evidence, graph, and governance changed across Changelog operation IDs in Git history. It describes durable understanding rather than agent or contributor productivity.

**Core Archetype**:
A page kind Atlas SDK owns and names in every Atlas, rather than one an Atlas defines for itself. An Atlas Schema extends a Core Archetype but never redefines what it means.

**Anchor**:
A human-approved, Atlas-local page through which an agent enters a region of knowledge and from which every route to a result begins. It provides cited orientation and named paths while Concepts hold detailed understanding, and an Atlas establishes one where related ideas strongly intersect. Ingest and Lint may recommend Anchors according to Atlas policy, but agents do not establish them autonomously. An Anchor may connect through a cross-Atlas Edge to another Atlas, but it is not authoritative source material.
_Avoid_: Bonfire, Landmark, Hub

**Root Anchor**:
The permanent `.atlas/index.md` Anchor through which an agent enters an Atlas. It carries orientation and additionally catalogs pages not otherwise reachable from an Anchor. A cross-Atlas Edge resolves a tracked Atlas's Atlas Slug, lands at its Root Anchor, and re-anchors there.

**Re-anchor**:
The mandatory re-anchoring checkpoint performed whenever an agent reaches an Anchor. The agent re-reads the Anchor orientation and every active Principle directly connected to it, then restates its active objective and the truths governing the path before continuing.
_Avoid_: Rest

**Source**:
The Atlas's record of one piece of source material or a pointer to it, together with its source metadata, ingestion method, refresh history, freshness dates, immutable revision or digest, and Atlas-assigned Source Authority. A Source is evidence, not synthesized understanding.
_Avoid_: Lore

**Source Refresh**:
The targeted re-Ingest of one existing Source object when its own refresh lifecycle is due. It records the source's latest revision and Source Revision Time, then re-integrates affected knowledge and fully Lints one Atlas Proposal.

**Source Authority**:
An Atlas-configured priority class assigned to Source according to its origin, such as official, first-party, community, or opinion. Conflicting claims resolve first by Source Authority, subject to applicable Principles and Atlas Policies.

**Source Revision Time**:
The update time asserted by the exact cited source revision, such as a Git commit time or captured page metadata. It breaks conflicts between equal-Authority Source when trustworthy and comparable; Ingest time is never a substitute, and unresolved ties require human adjudication.

**Concept**:
Derived understanding of exactly one concept, whose factual claims remain traceable through Citations to the Sources from which they were formed. A page covering several concepts is split into separate Concepts joined by an Anchor. Every Concept carries at least one Edge, so no page is unreachable by traversal.
_Avoid_: Insight

**Citation**:
A claim-level reference to a Source object that supports an agent-managed claim. Concepts, Anchors, and Edges require Citations; Principles are exempt because their truths are established by humans. A claim's effective Source Authority is derived from its cited Source. Citations are not Edges.

**Stale Knowledge**:
Derived knowledge supported by Source whose Atlas-defined refresh date has elapsed. Stale Knowledge remains traversable, but Lint surfaces it and the agentic workflow offers to re-Ingest the supporting Source.

**Edge**:
A first-class Markdown relationship used to traverse Concepts, Principles, Anchors, and Atlas-defined extensions of those archetypes. Zero or one Edge exists per unordered in-Atlas page pair. It has a stable identity, canonical direction, one or more typed semantics, explanatory context, and Citations supporting the asserted relationship. A cross-Atlas Edge instead connects an Anchor to a tracked Atlas identified by its Atlas Slug. Edges do not connect to Sources.
_Avoid_: Thread

**Principle**:
A human-governed, Atlas-local page of individually identified active universal truths that hold across an Atlas. A Principle has a stable identity, explains what it governs, and keeps a Keep a Changelog-style amendment history. Deleting a Principle invalidates all of its active truths and requires its dependent knowledge relationships and governance markers to be reconciled. Agents may help create, modify, or delete a Principle only under explicit human direction and approval.
_Avoid_: Pillar

**Maintainer**:
Any human acting through the Atlas Host Directory's Git governance to direct or approve changes to Principles or Atlas Policies. Maintainer is a contextual authority role, not a permanently named owner.
_Avoid_: Creator, Owner

**Principle Amendment**:
A numbered, dated entry appended to a Principle's amendment history. It records added, changed, or invalidated truths together with the directing or approving human, rationale, and change reference. Meaning-preserving clarification retains a truth's stable identity; semantic replacement invalidates the old truth and adds a linked successor with a new identity.

**Contradiction**:
An Atlas-local claim that contradicts an active Principle truth or violates an Atlas Policy. An accepted Contradiction is marked on its citation and on the containing Concept so agents can preserve it without mistaking it for ordinary knowledge.
_Avoid_: Heresy

**Divergence**:
A non-persistent disagreement surfaced while an agent traverses knowledge from multiple sovereign Atlases. Divergence does not invalidate either Atlas and is presented to the human for clarification.

**Dispute**:
A warning that two cited Concept claims within one Atlas conflict without contradicting a Principle. The Lint workflow surfaces the evidence and Source Authority, then works with a human to reconcile or scope the claims.

**Atlas Policy**:
A human-approved, versioned invariant that governs an Atlas. Each Policy declares its scope, naming the workflows it governs such as Atlas maintenance or publication; its evaluation, either deterministic or semantic and therefore subject to Challenge; and its consequence, either invalidating the Atlas or blocking only the operation it governs. A Policy retains its stable identity while its governing intention remains the same and retires rather than disappears. Agents may propose Policies and amendments but cannot establish them autonomously. Explore is never governed by Policies; it loads an Atlas's Policies once, when traversal first enters that Atlas, as descriptive context.
_Avoid_: Realm Law, Realm Rule

**Ingest**:
The human-facing workflow for ingesting Sources and updating an Atlas's derived knowledge. Ingest runs inside the Atlas's own repository and takes one source per invocation. A source that is itself an Atlas becomes a tracked Atlas and a human-agreed cross-Atlas Edge rather than a Source.
_Avoid_: Gather

**Ingest Scope**:
The human-approved traversal envelope for one Ingest source, including its entry point, depth or stopping rule, included and excluded regions, and relevant authority and freshness assumptions. Crawlers may fully traverse within it but must request approval before expanding beyond it.

**Ingest Type**:
A canonical structured-source contract whose recognizable semantics warrant a reusable Ingest optimization. Its identity follows the source contract rather than its transport, serialization, branding, or subject matter alone.

**Ingest Type Skill**:
A reusable `ingest-<type>` source adapter that makes repeated Ingest operations for one Ingest Type cheaper and more consistent. Whether Framework-provided, downloaded, or learned, it may specialize source handling but never owns Atlas synthesis or governance.

**Crawlers**:
The read-only subagents an Ingest dispatches to crawl one source in parallel. Crawlers report candidates and never writes to an Atlas.
_Avoid_: Fleet

**Candidate Graph**:
The proposed concepts, Edges, and Citations Crawlers return from one source, reconciled against existing knowledge before anything is written. It is working material, not Atlas knowledge.

**Vocabulary Binding**:
The correspondence between one term in this glossary and the identifiers Atlas SDK contracts spell that term with. A term fixes those spellings, so a binding records them and trusted validation verifies both sides agree: a disagreement between the glossary and the product is a reported Finding rather than an unnoticed rename, and an avoided term may never be bound.

**Lint**:
The human-facing workflow for validating an Atlas. Trusted deterministic validation runs before isolated Atlas-owned deterministic checks and semantic verification, and every semantic verdict must survive a Challenge before it counts; pure Lint reports findings without mutating knowledge. Lint also reports what an Atlas is missing, and validates an Atlas's edges into tracked Atlases rather than their contents.
_Avoid_: Weave

**Lint Stamp**:
A deterministic machine-readable attestation that one exact Atlas commit completed a full Lint under identified Framework, schema, check, Policy, and evidence revisions. It is reproducible validation evidence rather than committed Atlas knowledge, and any change to the stamped commit invalidates it.

**Finding**:
One result reported by a Lint, attributed to the check that raised it and to whether that check is trusted Atlas SDK validation or Atlas-owned. A finding is an error, a warning, a suggestion, an inconclusive semantic verdict, or a check skipped because one it depended on failed. An Atlas-owned check may add findings; it may never suppress or downgrade a trusted one.

**Atlas Lint Result**:
The deterministic Lint verdict for one complete Atlas input. It is either a Valid Atlas Lint Result or an Invalid Atlas Lint Result.

**Valid Atlas Lint Result**:
An Atlas Lint Result that confirms no error Finding denies Atlas validity and carries the validated Atlas records a caller may use after Lint.

**Invalid Atlas Lint Result**:
An Atlas Lint Result that carries the stable Findings explaining why the Atlas did not pass Lint and does not present validated Atlas records as usable output.

**Challenge**:
The adversarial review a semantic verdict must survive before it counts. A challenger receives the verdict and its cited evidence and argues against it; disagreement makes the verdict inconclusive and escalates both arguments to a human.

**Operation Result**:
The versioned, machine-readable outcome of one Atlas SDK operation. It carries the operation's completion state, success or non-success disposition, stable operation data, and the Operation Handoff derived from that same outcome.

**Operation Handoff**:
The stable completion summary returned by every Atlas SDK skill. It identifies the operation, Home Atlas and base snapshot, result or proposed changes, unresolved human decisions, validation or degradation state, review link when applicable, and recommended next action.

**Operation Workflow**:
The versioned resumable state machine for one Atlas SDK operation. It consumes typed events and yields typed effects while the deterministic runtime retains authority over state transitions, evidence, allowed writes, and validation gates.

**Atlas View**:
The immutable operation-scoped model parsed from exact Home and tracked Atlas Snapshots. It carries normalized Atlas objects, source locations, file digests, ownership, validation state, and SDK-owned graph indexes.

**Atlas Change Set**:
The typed proposal of intended Atlas file and graph changes against one Atlas View's base digests. A validated Change Set is the only input from which the proposal writer may serialize Atlas changes.

**Operation Workspace**:
The ephemeral repository-local state for one resumable operation, including checkpoints, effect receipts, temporary evidence, locks, and proposal-worktree references. It lives outside Atlas knowledge and may be resumed or explicitly discarded.

**Atlas Readiness Report**:
The Atlas Initialization handoff and pull-request description that explains the proposed Atlas boundary, Guide, governance, founding evidence and graph, integrations, degradations, uninspected areas, first Lint Stamp, and recommended next actions.

**Atlas Proposal**:
The isolated branch, worktree, and pull request through which one knowledge-changing operation or Framework Upgrade proposes changes to a Home Atlas. A Framework Upgrade uses the same reconciliation and full Lint gate without changing Atlas knowledge. An Atlas Proposal is anchored to a base commit and must reconcile against the current target branch before it can merge.

**Stale Atlas Proposal**:
An Atlas Proposal whose target branch has advanced since its last successful reconciliation and full Lint. It cannot merge until Atlas SDK rebases and revalidates it against the new target state.

**Atlas Head**:
The current target-branch commit containing the Home Atlas's authoritative merged state. Every Atlas Proposal must be reconciled and fully Linted against the current Atlas Head before it can merge.

**Proposal Footprint**:
The Sources, Atlas objects, governing truths, schema contracts, and connected knowledge neighborhood on which an Atlas Proposal's meaning depends. Atlas SDK compares this footprint with changes since the proposal's base to decide whether ordinary reconciliation is sufficient or its synthesis must be rebuilt.

**Proposal Reconciliation**:
The process that brings a Stale Atlas Proposal onto the current Atlas Head, resolves permitted mechanical and agent-managed overlaps, rebuilds synthesis when its Proposal Footprint has materially drifted, and requires a new full Lint before merge.

**Explore**:
The human-facing workflow for querying and traversing knowledge through Anchors, Edges, and supporting nodes. Explore searches an Explore Index for relevant entry points, then follows a required Anchor-to-result route through one fixed set of Atlas Snapshots. It reads tracked Atlases only through the Atlas Cache and never modifies them.
_Avoid_: Query, when naming the user-facing skill

**Degraded Explore**:
Best-effort read-only traversal used when an Atlas Snapshot cannot be fully validated. Explore progressively falls back from valid structured objects to partial structure, raw `.atlas/` Markdown, or a cached snapshot while surfacing diagnostics.
