# Atlas

Atlas is a structured knowledge environment that helps coding agents discover and traverse project-relevant knowledge.

## Language

**Atlas**:
The top-level knowledge boundary through which an agent discovers connected knowledge domains.

**Realm**:
An independently owned, bounded knowledge domain represented by its own Git repository. A Realm can point to other Realms and source material.
_Avoid_: Region

**Realm Repository**:
The Git repository that owns a Realm and stores its knowledge beneath its top-level `.atlas/` directory.

**Consumer Repository**:
An Atlas-enabled project repository whose `.atlas/` directory provides an entry point to selected Realms without making the project itself a Realm.

**Bonfire**:
A Realm-local conceptual landmark where related ideas strongly intersect. Agents navigate from Bonfire to Bonfire, including across Realms through explicit Threads; a Bonfire is not authoritative source material.

**Lore**:
Authoritative source material or a pointer to authoritative source material. Lore is not synthesized understanding.

**Insight**:
Derived understanding that remains traceable to the knowledge from which it was formed.

**Stale Knowledge**:
Derived knowledge whose Realm-defined freshness period has elapsed. Stale Knowledge remains traversable until refreshed or superseded, but agents must surface its status.

**Thread**:
An explicit semantic relationship connecting knowledge nodes.

**Pillar**:
A human-declared baseline truth that forms a structural boundary of a Realm. Only a human can establish or amend a Pillar; agents may propose changes but cannot silently reinterpret or override it.

**Creator**:
The human authority who establishes and amends a Realm's Pillars.

**Pillar Amendment**:
An append-only record of a Pillar change that identifies the previous and new truth, the human author, the rationale, and the time of change.

**Heresy**:
A preserved knowledge claim that contradicts a Pillar. Gather detects Heresy when knowledge enters a Realm, while Pillar creation detects Heresy against knowledge already present.

**Realm Law**:
A versioned invariant or policy that governs how agents maintain and use a Realm. Violating a Realm Law makes the resulting Realm invalid.
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
