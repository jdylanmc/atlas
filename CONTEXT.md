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
The human-facing workflow that proposes a new minimal Realm for one Realm Host Directory. It establishes the Realm's orientation and baseline governance in an isolated Git worktree, may derive a small amount of cited founding knowledge, and ends in one reviewable pull request.

**Agent Persona**:
An optional named identity, display profile, and avatar that shape an agent's conversational voice, tone, and visual or editorial flavor without changing semantic meaning. A Persona carries no behavioral or governance authority, does not shape the authored voice of Insights or Pillars, and remains separate from the agent's Directive.

**Agent Directive**:
The literal statement of an agent role's objectives, responsibilities, allowed actions, constraints, and required handoffs. An Atlas-owned baseline may be specialized by a separate Realm-owned layer that cannot weaken the baseline, Framework contracts, or Realm Laws. A Directive is precise instruction, not character prose.

**Agent Composition**:
The declarative pairing of exactly one Agent Persona with an ordered set of Agent Directives. Directives remain authoritative and determine behavior; the Persona shapes only eligible presentation, cannot change semantic meaning, and loses every conflict with a Directive.

**Realm Guide**:
The Realm-owned caretaker and Realm Site chief marketing officer that guides navigation, narrates Rest, drafts Chronicle entries, and proactively stewards the knowledge store under human governance. The Home Realm Guide supplies the human-facing voice for Atlas responses even when their knowledge comes from another Realm; source identity and evidence remain explicit. It may propose precise provisional terminology for unnamed concepts, but reviewed adoption is required before a term becomes canonical. Its Directive defines the work and proposal authority; its optional Agent Persona defines the flavor.

**Realm Entry**:
The shared preflight through which an Atlas skill identifies the Home Realm for the current Realm Host Directory, verifies tooling and schema compatibility, and loads only the instructions and context required by that operation. Entry classifies the Home Realm as ready, degraded, or blocked before the skill proceeds.

**Home Realm**:
The Realm owned by the current Realm Host Directory and identified by Realm Entry. Its committed maintenance code is trusted at the same level as its host repository; every other Realm is connected through cross-Realm Threads and remains read-only cached data.

**Atlas SDK Realm**:
The canonical upstream Home Realm of the Atlas repository, displayed as **Atlas SDK** and identified by the Realm Slug `atlas-sdk`. It maintains cited knowledge about Atlas's purpose, architecture, implementation, onboarding, operation, and use, while Framework Releases carry its enforceable core contracts into sovereign Realms. Its deployed Realm Site is the canonical destination linked by other Realms when explaining Atlas. Merlin is its designated Realm Guide.

**Framework Bundle**:
The Atlas-owned, portable baseline committed inside a Realm. Its manifest-owned files are complete immutable units containing the instructions, contracts, and maintenance tooling that make the Realm operable without joining the host application's dependency ecosystem.

**Framework Release**:
One exact version of the Atlas-owned runtime, core contracts, packaged skills, templates, and adapters from which a Realm's Framework Bundle is derived. A Home Realm pins one Framework Release while its Realm Schema evolves independently.

**Framework Release Manifest**:
The immutable inventory and compatibility contract for one Framework Release. It identifies every complete Atlas-owned file and digest, supported environments and Realm contracts, and the explicit migration paths to and from other supported releases.

**Framework Upgrade**:
The governed workflow that replaces a Home Realm's pinned Framework Release as one isolated, fully Woven Realm Proposal while preserving Realm-owned state. A completed upgrade operation has proposed the change for review; the target release becomes active only when that proposal merges.

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
The generated, local record of resolved schema versions, tracked Realm Snapshots, fetch times, and the lazily materialized Realm dependency graph. It records which Bonfire gateway and cross-Realm Thread introduced each dependency. Realm Lock is replaceable cache state rather than committed Realm knowledge.

**Realm Refresh**:
The pull that returns a Realm Cache entry to its tracked branch tip. Refresh happens automatically when an entry is older than the freshness window its declaration allows, and on demand when a human asks for it. Refresh never merges: divergent upstream history replaces the cached copy outright.

**Scout**:
The read-only workflow that expands a Realm Cache by one graph layer. Scout follows the selected Realm Snapshot's Bonfire gateway Threads, materializes its directly related Realms with human approval, and refreshes generated Lock and search state without changing Realm knowledge.

**Explore Index**:
The generated, disposable search state owned by one Realm Host Directory. It indexes that Realm and its materialized reachable Realm Snapshots behind a replaceable provider interface while Atlas retains responsibility for graph reachability, routing, validation, and context.

**Realm Chronicle**:
The curated, human-readable history of notable knowledge changes in a Realm, kept as `.atlas/CHANGELOG.md`. One entry, identified by its stable operation ID, records one merged knowledge-changing operation and can be correlated with Git history. The Chronicle is history a newcomer can read, not an operational ledger and not synthesized knowledge.

**Realm Site**:
An optional, read-only static projection through which humans browse one Home Realm's published knowledge, governance, history, and evolution. It is derived from validated Realm state and is neither a raw `.atlas/` mirror nor an interactive Atlas runtime.

**Publication Policy**:
The human-authored declaration that enables a Realm Site and governs which Realm knowledge, Lore, locators, Persona assets, and connected-Realm links may be exposed. Publication-specific validation enforces it independently of Persona presentation.

**Knowledge Health**:
The Realm Site's current evidence-linked view of whether the published Realm Head passes a full Weave and how fresh its supporting Lore is. Structural, governance, and connection diagnostics explain those two headline signals without collapsing them into a composite score.

**Knowledge Evolution**:
The Realm Site's reconstruction of how a Realm's knowledge, evidence, graph, and governance changed across Chronicle operation IDs in Git history. It describes durable understanding rather than agent or contributor productivity.

**Bonfire**:
A human-approved, Realm-local conceptual landmark where related ideas strongly intersect. Gather and Weave may recommend Bonfires according to Realm policy, but agents do not establish them autonomously. A Bonfire provides cited orientation and named paths while Insights hold detailed understanding. A Bonfire may connect through a cross-Realm Thread to another Realm, but it is not authoritative source material.

**Root Bonfire**:
The permanent `.atlas/index.md` Bonfire through which an agent enters a Realm. It carries orientation and additionally catalogs pages not otherwise reachable from a Bonfire. A cross-Realm Thread resolves a tracked Realm's Realm Slug, lands at its Root Bonfire, and performs Rest there.

**Rest**:
The mandatory re-anchoring checkpoint performed whenever an agent reaches a Bonfire. The agent re-reads the Bonfire orientation and every active Pillar directly connected to it, then restates its active objective and the truths governing the path before continuing.

**Lore**:
Source material or a pointer to source material, together with its source metadata, gathering method, refresh history, freshness dates, immutable revision or digest, and Realm-assigned Source Authority. Lore is not synthesized understanding.

**Lore Refresh**:
The targeted re-Gather of one existing Lore object when its own refresh lifecycle is due. It records the source's latest revision and Source Revision Time, then re-interweaves affected knowledge and fully Weaves one Realm Proposal.

**Source Authority**:
A Realm-configured priority class assigned to Lore according to its origin, such as official, first-party, community, or opinion. Conflicting claims resolve first by Source Authority, subject to applicable Pillars and Realm Laws.

**Source Revision Time**:
The update time asserted by the exact cited source revision, such as a Git commit time or captured page metadata. It breaks conflicts between equal-Authority Lore when trustworthy and comparable; Gather time is never a substitute, and unresolved ties require human adjudication.

**Insight**:
Derived understanding of one concept, whose factual claims remain traceable through Citations to the Lore from which they were formed. Every Insight carries at least one Thread, so no page is unreachable by traversal.

**Citation**:
A claim-level reference to a Lore object that supports an agent-managed claim. Insights, Bonfires, and Threads require Citations; Pillars are exempt because their truths are established by humans. A claim's effective Source Authority is derived from its cited Lore. Citations are not Threads.

**Stale Knowledge**:
Derived knowledge supported by Lore whose Realm-defined refresh date has elapsed. Stale Knowledge remains traversable, but Weave surfaces it and the agentic workflow offers to re-Gather the supporting Lore.

**Thread**:
A first-class Markdown relationship used to traverse Insights, Pillars, Bonfires, and Realm-defined extensions of those archetypes. Zero or one Thread exists per unordered in-Realm page pair. It has a stable identity, canonical direction, one or more typed semantics, explanatory context, and Citations supporting the asserted relationship. A cross-Realm Thread instead connects a Bonfire to a tracked Realm identified by its Realm Slug. Threads do not connect to Lore.

**Pillar**:
A human-governed, Realm-local concept page containing individually identified active universal truths. A Pillar has a stable identity, explains the concept it represents, and keeps a Keep a Changelog-style amendment history. Deleting a Pillar invalidates all of its active truths and requires its dependent knowledge relationships and governance markers to be reconciled. Agents may help create, modify, or delete a Pillar only under explicit human direction and approval.

**Creator**:
Any human acting through the Realm Host Directory's Git governance to direct or approve changes to Pillars or Realm Laws. Creator is a contextual authority role, not a permanently named owner.

**Pillar Amendment**:
A numbered, dated entry appended to a Pillar's amendment history. It records added, changed, or invalidated truths together with the directing or approving human, rationale, and change reference. Meaning-preserving clarification retains a truth's stable identity; semantic replacement invalidates the old truth and adds a linked successor with a new identity.

**Heresy**:
A Realm-local claim that contradicts an active Pillar truth or violates a Realm Law. Accepted Heresy is marked on its citation and on the containing Insight so agents can preserve it without mistaking it for ordinary knowledge.

**Divergence**:
A non-persistent disagreement surfaced while an agent traverses knowledge from multiple sovereign Realms. Divergence does not invalidate either Realm and is presented to the human for clarification.

**Dispute**:
A warning that two cited Insight claims within one Realm conflict without contradicting a Pillar. The Weave workflow surfaces the evidence and Source Authority, then works with a human to reconcile or scope the claims.

**Realm Law**:
A human-approved, versioned invariant or policy that governs how Gather and Weave maintain a Realm. A Law may govern resulting Realm state or observable maintenance procedure, and any exception must be explicit, enforceable doctrine within the Law itself. A Law retains its stable identity while its governing intention remains the same and retires rather than disappears. Agents may propose Laws and amendments but cannot establish them autonomously. Violating an active Realm Law makes the resulting Realm invalid. Because a Law is evaluated by a model, both its failures and its passes must survive a Challenge. Explore is never governed by Laws, though it may optionally read them as descriptive Realm context.
_Avoid_: Realm Rule

**Gather**:
The human-facing workflow for ingesting Lore and updating a Realm's derived knowledge. Gather runs inside the Realm's own repository and takes one source per invocation. A source that is itself a Realm becomes a tracked Realm and a human-agreed cross-Realm Thread rather than Lore.
_Avoid_: Ingest, when naming the user-facing skill

**Gather Type**:
A canonical structured-source contract whose recognizable semantics warrant a reusable Gather optimization. Its identity follows the source contract rather than its transport, serialization, branding, or subject matter alone.

**Gather Type Skill**:
A reusable `gather-<type>` source adapter that makes repeated Gather operations for one Gather Type cheaper and more consistent. Whether Framework-provided, downloaded, or learned, it may specialize source handling but never owns Realm synthesis or governance.

**Fleet**:
The read-only subagents a Gather dispatches to crawl one source in parallel. A Fleet reports candidates and never writes to a Realm.

**Candidate Graph**:
The proposed concepts, Threads, and Citations a Fleet returns from one source, reconciled against existing knowledge before anything is written. It is working material, not Realm knowledge.

**Weave**:
The human-facing workflow for linting a Realm. Trusted deterministic validation runs before isolated Realm-owned deterministic checks and semantic verification; pure Weave reports findings without mutating knowledge. Weave also reports what a Realm is missing, and validates a Realm's edges into tracked Realms rather than their contents.
_Avoid_: Lint, when naming the user-facing skill

**Finding**:
One result reported by a Weave, attributed to the check that raised it and to whether that check is trusted Atlas validation or Realm-owned. A finding is an error, a warning, a suggestion, an inconclusive semantic verdict, or a check skipped because one it depended on failed. A Realm-owned check may add findings; it may never suppress or downgrade a trusted one.

**Challenge**:
The adversarial review a semantic verdict must survive before it counts. A challenger receives the verdict and its cited evidence and argues against it; disagreement makes the verdict inconclusive and escalates both arguments to a human.

**Operation Handoff**:
The stable completion summary returned by every Atlas skill. It identifies the operation, Home Realm and base snapshot, result or proposed changes, unresolved human decisions, validation or degradation state, review link when applicable, and recommended next action.

**Realm Proposal**:
The isolated branch, worktree, and pull request through which one knowledge-changing operation proposes changes to a Home Realm. A Realm Proposal is anchored to a base commit and must reconcile against the current target branch before it can merge.

**Stale Realm Proposal**:
A Realm Proposal whose target branch has advanced since its last successful reconciliation and full Weave. It cannot merge until Atlas rebases and revalidates it against the new target state.

**Realm Head**:
The current target-branch commit containing the Home Realm's authoritative merged state. Every Realm Proposal must be reconciled and fully Woven against the current Realm Head before it can merge.

**Proposal Footprint**:
The Lore sources, Realm objects, governing truths, schema contracts, and connected knowledge neighborhood on which a Realm Proposal's meaning depends. Atlas compares this footprint with changes since the proposal's base to decide whether ordinary reconciliation is sufficient or its synthesis must be rebuilt.

**Proposal Reconciliation**:
The process that brings a Stale Realm Proposal onto the current Realm Head, resolves permitted mechanical and agent-managed overlaps, rebuilds synthesis when its Proposal Footprint has materially drifted, and requires a new full Weave before merge.

**Explore**:
The human-facing workflow for querying and traversing knowledge through Bonfires, Threads, and supporting nodes. Explore searches an Explore Index for relevant entry points, then follows a required Bonfire-to-result route through one fixed set of Realm Snapshots. It reads tracked Realms only through the Realm Cache and never modifies them.
_Avoid_: Query, when naming the user-facing skill

**Degraded Explore**:
Best-effort read-only traversal used when a Realm Snapshot cannot be fully validated. Explore progressively falls back from valid structured objects to partial structure, raw `.atlas/` Markdown, or a cached snapshot while surfacing diagnostics.
