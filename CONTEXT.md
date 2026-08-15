# Atlas

Atlas is a structured knowledge environment that helps coding agents discover and traverse project-relevant knowledge.

## Language

**Atlas**:
The top-level knowledge boundary through which an agent discovers connected knowledge domains.

**Realm**:
An independently owned, bounded knowledge domain represented by its own Git repository. A Realm can point to other Realms and source material.
_Avoid_: Region

**Realm Repository**:
The Git repository that owns a Realm and stores its knowledge beneath its top-level `.atlas/` directory. Its required `.atlas/index.md` is the Realm's Root Bonfire.

**Realm Manifest**:
The human-authored declaration of a Realm's identity and intended knowledge contract.

**Realm Lock**:
The generated record of the exact schema and content versions resolved for a Realm.

**Realm Chronicle**:
The append-only operational history of Gather and Weave runs, recording when each operation occurred, who performed it, its outcome, high-level metrics, and its report pointer. The Chronicle is audit history, not synthesized knowledge.

**Consumer Repository**:
An Atlas-enabled project repository whose `.atlas/` directory provides an entry point to selected Realms without making the project itself a Realm.

**Bonfire**:
A human-approved, Realm-local conceptual landmark where related ideas strongly intersect. Gather and Weave may recommend Bonfires according to Realm policy, but agents do not establish them autonomously. A Bonfire provides cited orientation and named paths while Insights hold detailed understanding. A Bonfire may connect through a cross-Realm Thread to another Realm, but it is not authoritative source material.

**Root Bonfire**:
The required `.atlas/index.md` Bonfire through which an agent enters a Realm. A cross-Realm Thread targets the Realm repository at a pinned commit, resolves its Root Bonfire, and performs Rest there.

**Rest**:
The mandatory re-anchoring checkpoint performed whenever an agent reaches a Bonfire. The agent re-reads the current Realm manifest, all active Realm Laws, the Pillars connected to that Bonfire, and the Bonfire orientation, then restates its active objective and constraints before continuing.

**Lore**:
Source material or a pointer to source material, together with its source metadata, gathering method, refresh history, freshness dates, immutable revision or digest, and Realm-assigned Source Authority. Lore is not synthesized understanding.

**Source Authority**:
A Realm-configured priority class assigned to Lore according to its origin, such as official, first-party, community, or opinion. Agents use Source Authority to recommend resolutions for conflicting claims, but humans make the final decision.

**Insight**:
Derived understanding whose factual claims remain traceable through Citations to the Lore from which they were formed.

**Citation**:
A claim-level reference to a Lore object that supports an agent-managed claim. Insights, Bonfires, and Threads require Citations; Pillars are exempt because their truths are established by humans. A claim's effective Source Authority is derived from its cited Lore. Citations are not Threads.

**Stale Knowledge**:
Derived knowledge supported by Lore whose Realm-defined refresh date has elapsed. Stale Knowledge remains traversable, but Weave surfaces it and the agentic workflow offers to re-Gather the supporting Lore.

**Thread**:
A first-class Markdown relationship used to traverse Insights, Pillars, and Bonfires. Zero or one Thread exists per unordered in-Realm page pair. It has a stable identity, canonical direction, one or more typed semantics, explanatory context, and Citations supporting the asserted relationship. A cross-Realm Thread instead connects a Bonfire to a pinned Realm repository. Threads do not connect to Lore.

**Pillar**:
A human-governed, Realm-local concept page containing individually identified active universal truths. A Pillar has a stable identity, explains the concept it represents, and keeps a Keep a Changelog-style amendment history. Agents may help modify a Pillar only under explicit human direction and approval.

**Creator**:
Any human acting through a Realm repository's governance to direct or approve changes to Pillars or Realm Laws. Creator is a contextual authority role, not a permanently named owner.

**Pillar Amendment**:
A numbered, dated entry appended to a Pillar's amendment history. It records added, changed, or invalidated truths together with the directing or approving human, rationale, and change reference.

**Heresy**:
A Realm-local claim that contradicts an active Pillar truth or violates a Realm Law. Accepted Heresy is marked on its citation and on the containing Insight so agents can preserve it without mistaking it for ordinary knowledge.

**Divergence**:
A non-persistent disagreement surfaced while an agent traverses knowledge from multiple sovereign Realms. Divergence does not invalidate either Realm and is presented to the human for clarification.

**Dispute**:
A warning that two cited Insight claims within one Realm conflict without contradicting a Pillar. The Weave workflow surfaces the evidence and Source Authority, then works with a human to reconcile or scope the claims.

**Realm Law**:
A human-approved, versioned invariant or policy that governs how agents maintain and use a Realm. Agents may propose Laws and amendments but cannot establish them autonomously. Violating a Realm Law makes the resulting Realm invalid.
_Avoid_: Realm Rule

**Gather**:
The human-facing workflow for ingesting Lore and updating a Realm's derived knowledge.
_Avoid_: Ingest, when naming the user-facing skill

**Weave**:
The human-facing workflow for linting a Realm against structural invariants and Realm Laws.
_Avoid_: Lint, when naming the user-facing skill

**Explore**:
The human-facing workflow for querying and traversing knowledge through Bonfires, Threads, and supporting nodes.
_Avoid_: Query, when naming the user-facing skill
