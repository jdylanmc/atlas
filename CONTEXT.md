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

**Realm Manifest**:
The human-authored declaration of a Realm's identity and intended knowledge contract.

**Realm Lock**:
The generated record of the exact schema and content versions resolved for a Realm.

**Consumer Repository**:
An Atlas-enabled project repository whose `.atlas/` directory provides an entry point to selected Realms without making the project itself a Realm.

**Bonfire**:
A human-approved, Realm-local conceptual landmark where related ideas strongly intersect. Gather and Weave may recommend Bonfires according to Realm policy, but agents do not establish them autonomously. A Bonfire provides concise orientation and named paths while Insights hold detailed understanding. Bonfire-to-Bonfire Threads are the only relationships that may cross Realm boundaries; a Bonfire is not authoritative source material.

**Rest**:
The mandatory re-anchoring checkpoint performed whenever an agent reaches a Bonfire. The agent re-reads the current Realm manifest, Realm Laws, Pillars, and Bonfire orientation, then restates its active objective and constraints before continuing.

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
