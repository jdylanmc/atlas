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

**Realm Entry**:
The shared preflight through which an Atlas skill selects one active Realm, verifies tooling and schema compatibility, and loads only the instructions and context required by that operation. Entry classifies the Realm as ready, degraded, or blocked before the skill proceeds.

**Realm Locator**:
The normalized Git repository URL, branch, and Realm-relative path that identifies a tracked Realm. Normalization settles syntax only, never identity: host case, `.git` suffixes, trailing separators, embedded credentials, and equivalent SSH and HTTPS forms of one repository resolve together, while owner, repository, branch, and path remain significant.

**Realm Slug**:
The reference name of a tracked Realm, derived deterministically from its Realm Locator rather than chosen by a human. It combines host, owner, repository, and Realm-relative path, and names the branch only when it is not the repository default.

**Realm Cache**:
The generated, Git-ignored store beneath a Realm's `.atlas/` holding read-only working copies of tracked Realms, one flat entry per Realm Locator, materialized on first entry. Realm Cache entries are disposable, never edited, and never a place from which a Realm is maintained.

**Realm Snapshot**:
The exact Git commit of a Realm used during one operation. A snapshot records observed context but is not the Realm's logical identity.

**Realm Manifest**:
The human-authored declaration of a Realm's intended knowledge contract and local configuration.

**Realm Schema**:
The versioned extension contract that adds Realm-specific page types, fields, relationship semantics, and validation while inheriting and preserving Atlas core archetype behavior.

**Realm Lock**:
The generated, local record of resolved schema versions, tracked Realm Snapshots, fetch times, and other reproducibility state. Realm Lock is replaceable cache state rather than committed Realm knowledge.

**Realm Refresh**:
The pull that returns a Realm Cache entry to its tracked branch tip. Refresh happens automatically when an entry is older than the freshness window its declaration allows, and on demand when a human asks for it. Refresh never merges: divergent upstream history replaces the cached copy outright.

**Realm Chronicle**:
The curated, human-readable history of notable knowledge changes in a Realm, kept as `.atlas/CHANGELOG.md`. One entry records one merged knowledge-changing operation. The Chronicle is history a newcomer can read, not an operational ledger and not synthesized knowledge.

**Bonfire**:
A human-approved, Realm-local conceptual landmark where related ideas strongly intersect. Gather and Weave may recommend Bonfires according to Realm policy, but agents do not establish them autonomously. A Bonfire provides cited orientation and named paths while Insights hold detailed understanding. A Bonfire may connect through a cross-Realm Thread to another Realm, but it is not authoritative source material.

**Root Bonfire**:
The permanent `.atlas/index.md` Bonfire through which an agent enters a Realm. It carries orientation and additionally catalogs pages not otherwise reachable from a Bonfire. A cross-Realm Thread resolves a tracked Realm's Realm Slug, lands at its Root Bonfire, and performs Rest there.

**Rest**:
The mandatory re-anchoring checkpoint performed whenever an agent reaches a Bonfire. The agent re-reads the current Realm manifest, all active Realm Laws, the Pillars connected to that Bonfire, and the Bonfire orientation, then restates its active objective and constraints before continuing.

**Lore**:
Source material or a pointer to source material, together with its source metadata, gathering method, refresh history, freshness dates, immutable revision or digest, and Realm-assigned Source Authority. Lore is not synthesized understanding.

**Source Authority**:
A Realm-configured priority class assigned to Lore according to its origin, such as official, first-party, community, or opinion. Agents use Source Authority to recommend resolutions for conflicting claims, but humans make the final decision.

**Insight**:
Derived understanding of one concept, whose factual claims remain traceable through Citations to the Lore from which they were formed. Every Insight carries at least one Thread, so no page is unreachable by traversal.

**Citation**:
A claim-level reference to a Lore object that supports an agent-managed claim. Insights, Bonfires, and Threads require Citations; Pillars are exempt because their truths are established by humans. A claim's effective Source Authority is derived from its cited Lore. Citations are not Threads.

**Stale Knowledge**:
Derived knowledge supported by Lore whose Realm-defined refresh date has elapsed. Stale Knowledge remains traversable, but Weave surfaces it and the agentic workflow offers to re-Gather the supporting Lore.

**Thread**:
A first-class Markdown relationship used to traverse Insights, Pillars, Bonfires, and Realm-defined extensions of those archetypes. Zero or one Thread exists per unordered in-Realm page pair. It has a stable identity, canonical direction, one or more typed semantics, explanatory context, and Citations supporting the asserted relationship. A cross-Realm Thread instead connects a Bonfire to a tracked Realm identified by its Realm Slug. Threads do not connect to Lore.

**Pillar**:
A human-governed, Realm-local concept page containing individually identified active universal truths. A Pillar has a stable identity, explains the concept it represents, and keeps a Keep a Changelog-style amendment history. Agents may help modify a Pillar only under explicit human direction and approval.

**Creator**:
Any human acting through the Realm Host Directory's Git governance to direct or approve changes to Pillars or Realm Laws. Creator is a contextual authority role, not a permanently named owner.

**Pillar Amendment**:
A numbered, dated entry appended to a Pillar's amendment history. It records added, changed, or invalidated truths together with the directing or approving human, rationale, and change reference.

**Heresy**:
A Realm-local claim that contradicts an active Pillar truth or violates a Realm Law. Accepted Heresy is marked on its citation and on the containing Insight so agents can preserve it without mistaking it for ordinary knowledge.

**Divergence**:
A non-persistent disagreement surfaced while an agent traverses knowledge from multiple sovereign Realms. Divergence does not invalidate either Realm and is presented to the human for clarification.

**Dispute**:
A warning that two cited Insight claims within one Realm conflict without contradicting a Pillar. The Weave workflow surfaces the evidence and Source Authority, then works with a human to reconcile or scope the claims.

**Realm Law**:
A human-approved, versioned invariant or policy that governs how agents maintain and use a Realm. Agents may propose Laws and amendments but cannot establish them autonomously. Violating a Realm Law makes the resulting Realm invalid. Because a Law is evaluated by a model, both its failures and its passes must survive a Challenge.
_Avoid_: Realm Rule

**Gather**:
The human-facing workflow for ingesting Lore and updating a Realm's derived knowledge. Gather runs inside the Realm's own repository and takes one source per invocation. A source that is itself a Realm becomes a tracked Realm and a human-agreed cross-Realm Thread rather than Lore.
_Avoid_: Ingest, when naming the user-facing skill

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
The stable completion summary returned by every Atlas skill. It identifies the operation, active Realm and base snapshot, result or proposed changes, unresolved human decisions, validation or degradation state, review link when applicable, and recommended next action.

**Explore**:
The human-facing workflow for querying and traversing knowledge through Bonfires, Threads, and supporting nodes. Explore reads tracked Realms only through the Realm Cache and never modifies them.
_Avoid_: Query, when naming the user-facing skill

**Degraded Explore**:
Best-effort read-only traversal used when a Realm Snapshot cannot be fully validated. Explore progressively falls back from valid structured objects to partial structure, raw `.atlas/` Markdown, or a cached snapshot while surfacing diagnostics.
