---
schema-version: 1
session: atlas-sdk-v1-fleet-delivery
state-root: docs/discovery
revision: 2
anchor: https://github.com/jdylanmc/atlas/issues/112
anchor-revision: 2026-08-20T15:57:19Z
anchor-status: unchanged
question-group-size: 12
last-question-group-size: 12
last-cycle: c-0002
cycle-state: complete
state-digest: f909fc70c20c268a5a4eefc986477652746f523887e326c587ffdfe35cf3ad90
root-map-digest: 2119c7816ba22752751423fb5ccc2276391233b8fe3d0409efb55cd61630e629
root-lexicon-digest: 43f26346a999189a67da21852284e8dff1224293fc4c12e2c19133d2940502e8
digest-tool: shasum -a 256
digest-status: verified
state-scope: full
tracker-mode: markdown-only
tracker-tier-map: unmapped
---

# Discovery Session - Atlas SDK v1 fleet delivery

## Anchor

Issue [#112 - Shared Understanding: Atlas SDK v1](https://github.com/jdylanmc/atlas/issues/112),
observed at `updatedAt` `2026-08-20T15:57:19Z`. Its parent specification is
issue [#75](https://github.com/jdylanmc/atlas/issues/75), and its settled build
sequence is issue [#5](https://github.com/jdylanmc/atlas/issues/5).

## Destination

Phases 5 through 12 of the settled twelve-phase sequence land through parallel
coding sub-agents, where each agent can start cold from one ticket and produce a
mergeable, council-passing, fully covered vertical slice, without corrupting
settled vocabulary and without serializing on one human reviewer.

Observable success conditions:

1. Two or more implementation tickets are worked concurrently, land, and neither
   breaks `main` nor requires the Maintainer to re-explain the system.
2. No retired `_Avoid_` term from `CONTEXT.md` reaches any authored surface.
3. The Maintainer's approval load per landed slice is known and bounded.
4. Issue #91's clean-clone acceptance journey has a credible, sequenced path.

Explicitly not in this session: re-deciding what to build. Issues #1 through #52
settled the product domain, and issue #11 records that corpus as closed with no
unresolved fog.

## Session Domain Lexicon

| Term | Status | Definition | Bounded context | Aliases | Source | First seen | Last verified | Related terms | Scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fleet | conflicted | Reading A (retired product term): the read-only subagents an Ingest dispatches, now named Crawlers. Reading B (delivery): parallel coding sub-agents implementing tickets. | Reading A: product. Reading B: delivery. | Crawlers (reading A) | [CONTEXT.md](../../../CONTEXT.md); [#9](https://github.com/jdylanmc/atlas/issues/9) | atlas-sdk-v1-fleet-delivery/n-0004/c-0001 | c-0001 | Crawlers, Lane | session:atlas-sdk-v1-fleet-delivery |
| Lane zero | candidate | The one delivery stream that must land before any phase lane opens. Settled this cycle as the widened vocabulary gate. | Delivery layer | none | decision D1, c-0001 | atlas-sdk-v1-fleet-delivery/n-0008/c-0001 | c-0001 | Lane, Phase | session:atlas-sdk-v1-fleet-delivery |
| Legacy corpus | candidate | The 27 closed decision tickets indexed by issue #11, authoritative on substance and written entirely in pre-rename vocabulary. Fenced as historical provenance by decision D2. | Delivery layer | Wayfinder corpus | [#11](https://github.com/jdylanmc/atlas/issues/11) | atlas-sdk-v1-fleet-delivery/n-0004/c-0001 | c-0002 | Merge trap, Phase | session:atlas-sdk-v1-fleet-delivery |
| Atlas context-window bound | candidate | A guideline, not an invariant: an Atlas is kept small enough that one spawned agent can hold it entirely in context for the semantic half of Lint. One of the underlying principles behind splitting a large knowledge store into smaller Atlases, because a smaller Atlas is easier to check non-deterministically and therefore easier to keep at quality. Not in `CONTEXT.md`; handoff pending. | Atlas SDK product domain | none | Maintainer statement 2026-08-21; decision D4 | atlas-sdk-v1-fleet-delivery/n-0008/c-0002 | c-0002 | Lint, Atlas Host Directory, Check SDK, Atlas Policy | session:atlas-sdk-v1-fleet-delivery |
| Small-issue delivery | candidate | Ship narrow issues and close them rather than holding an issue open until it is complete. Residual work becomes newly opened issues. Under decision D2 a closed issue is provenance rather than instruction, so residual work must be opened or it becomes unreadable to agents. | Delivery layer | none | Maintainer statement 2026-08-21; decision D6 | atlas-sdk-v1-fleet-delivery/n-0008/c-0002 | c-0002 | Tracer-bullet ticket, Legacy corpus | session:atlas-sdk-v1-fleet-delivery |

## Tree

### n-0000 - Atlas SDK v1 delivered by a managed sub-agent fleet

- Parent: none
- Fog: scouted
- Maturity: framed
- Priority: unprioritized
- Outcome: Phases 5-12 land through parallel sub-agents without corrupting settled vocabulary or serializing on one reviewer
- Open questions: none at this level; fog is held by the children
- Evidence: [#112 Shared Understanding](https://github.com/jdylanmc/atlas/issues/112); [#5 build sequence](https://github.com/jdylanmc/atlas/issues/5); [#75 specification](https://github.com/jdylanmc/atlas/issues/75)
- Links: none
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 seeded from the closed #11 corpus and the current repository state

### n-0001 - Fleet operating model

- Parent: n-0000
- Fog: unexplored
- Maturity: vague
- Priority: unprioritized
- Outcome: unknown
- Open questions: How many sub-agents run at once? What isolates them - worktrees, clones, or branches? Who arbitrates when two agents need the same file? Does an agent own a ticket end to end, or hand off at the pull request?
- Evidence: [commit 3e4788c ignores `.worktrees`](https://github.com/jdylanmc/atlas/commit/3e4788c); [#112 "Safe Parallel Lanes"](https://github.com/jdylanmc/atlas/issues/112)
- Links: depends-on n-0003
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 created; c-0002 debt row against n-0008 detected and cleared in the same cycle when n-0008 reached maturity promotion-ready; c-0002 gains decision D6 as a constraint on ticket sizing

### n-0002 - Cold-start ticket contract

- Parent: n-0000
- Fog: unexplored
- Maturity: vague
- Priority: unprioritized
- Outcome: unknown
- Open questions: Do issues #80-#91 carry enough for a fresh context to execute? What must a `ready-for-agent` ticket state about vocabulary, gates, and acceptance? Who verifies a ticket is cold-start-ready before an agent claims it?
- Evidence: [docs/agents/issue-tracker.md planning issue lifecycle](../../../docs/agents/issue-tracker.md); issues #80-#91 all carry `ready-for-agent`
- Links: depends-on n-0009
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 created; c-0001 dependency moved from n-0004 to n-0009 - Q2 settled that a ticket must be self-sufficient, so the constraint is now the extraction, not the containment policy

### n-0003 - Merge and integration discipline under parallelism

- Parent: n-0000
- Fog: unexplored
- Maturity: vague
- Priority: unprioritized
- Outcome: unknown
- Open questions: How is the merge trap prevented mechanically rather than by memory? Are lanes partitioned so two agents never touch one file? Is there a merge queue, and who owns rebase duty?
- Evidence: [#112 "Merge trap"](https://github.com/jdylanmc/atlas/issues/112) records pull request #113 breaking `main` with no merge conflict; [#32 proposal reconciliation](https://github.com/jdylanmc/atlas/issues/32) settles the *product* equivalent but not the repository's own development process
- Links: blocks n-0001
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 created

### n-0004 - Legacy-vocabulary containment

- Parent: n-0000
- Fog: researched
- Maturity: researched
- Priority: P0
- Outcome: The vocabulary gate covers every authored surface before any phase lane opens, and the closed corpus is fenced as historical provenance rather than read as agent instruction
- Open questions: none material. One dependency remains: the term `Fleet` is `conflicted` and its handoff is pending, which blocks this node's promotion but not its understanding
- Evidence: every decision in [#11](https://github.com/jdylanmc/atlas/issues/11) uses Realm, Bonfire, Lore, Thread, Weave, Gather, Pillar, Fleet, Rest, Scout, Heresy, and Chronicle, all now `_Avoid_` entries in `CONTEXT.md`; [docs/ci.md](../../../docs/ci.md) states the vocabulary gate scans `src/**/*.ts` only; [#117](https://github.com/jdylanmc/atlas/issues/117) tracks extending it; [#112](https://github.com/jdylanmc/atlas/issues/112) records that both renames drifted silently past a green `npm run ci`; evidence R1 (zero retired-term occurrences outside `src/` on 2026-08-21); evidence R3 (issue #6 contradicts merged code)
- Links: blocks n-0008; blocks n-0009; relates-to n-0006
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 created and flagged high risk; c-0001 selected by rule 4; c-0001 fog unexplored to scouted to investigating to researched through the ordered states, maturity to researched, priority to P0; c-0001 two decisions settled (D1, D2); c-0001 promotion blocked by conflicted term Fleet

### n-0005 - Quality-gate throughput under fleet load

- Parent: n-0000
- Fog: unexplored
- Maturity: vague
- Priority: unprioritized
- Outcome: unknown
- Open questions: Is the Dragon Council running in continuous integration, or still local-only? What is the wall-clock cost of one slice passing the full gate? Does 100% product coverage hold as a per-slice requirement at fleet volume?
- Evidence: [#112](https://github.com/jdylanmc/atlas/issues/112) states "the CI council is offline; run it locally"; measured suite `npm run test:unit` 340 tests in about 43s, coverage run about 48s, 2026-08-21; [issue #5 per-phase acceptance criteria](https://github.com/jdylanmc/atlas/issues/5)
- Links: none
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 created

### n-0006 - Shipped-slice defect paydown policy

- Parent: n-0000
- Fog: unexplored
- Maturity: vague
- Priority: unprioritized
- Outcome: unknown
- Open questions: Do the ten open defects against merged code block new phases, run in a parallel lane, or wait? Who decides when a bounded gap is acceptable?
- Evidence: open defects #117, #118, #119, #121, #122, #124, #133, #134, #135, #136, #139 all target already-merged slices; [#120](https://github.com/jdylanmc/atlas/issues/120) proposes converting recurring review findings into durable detectors
- Links: relates-to n-0004
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 created

### n-0007 - Human approval bottleneck

- Parent: n-0000
- Fog: unexplored
- Maturity: vague
- Priority: unprioritized
- Outcome: unknown
- Open questions: What is the Maintainer's realistic review capacity per week? Which approvals are genuinely human-only by design, and which are process habit? Can review be batched without weakening the governance guarantee?
- Evidence: `CONTEXT.md` requires human approval for Principles, Atlas Policies, and Anchors; [ADR-0001](../../../docs/adr/0001-sdk-is-a-deterministic-library.md) escalates every inconclusive semantic verdict to a human; [docs/ci.md](../../../docs/ci.md) requires four council checks plus deterministic verification on every pull request
- Links: none
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 created

### n-0008 - Lane zero: extend vocabulary agreement to every authored surface

- Parent: n-0000
- Fog: cleared
- Maturity: promotion-ready
- Priority: P0
- Outcome: `npm run vocabulary:validate` scans every **TypeScript** surface that ships bound vocabulary, not only `src/**/*.ts`. Prose surfaces are explicitly out of deterministic scope and belong to the Lint semantic pass. The adversarial corpus stays data-only because the scope stays TypeScript-shaped
- Open questions: none
- Evidence: [#117](https://github.com/jdylanmc/atlas/issues/117) names `scripts/atlas_sdk_agents.ts` and `docs/agents/atlas-sdk/personas/merlin/persona.md` and states both carry byte-locked content; evidence R5 shows scope is one `CONTRACT_ROOT` constant; evidence R6 shows the detector is TypeScript-shaped and would prove nothing on prose; evidence R7 shows the corpus is TypeScript-source shaped; evidence R1 shows zero current leakage
- Links: depends-on n-0004; blocks n-0001; refines n-0010
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none - existing issue #117 is the promotion target, to be closed as explicitly narrowed
- Divergence: none
- History: c-0001 created from decision D1; c-0001 priority P0; c-0002 decisions D3, D4, D5 settled; c-0002 fog scouted to cleared through the ordered states and maturity to promotion-ready; c-0002 debt row against n-0001 cleared in the same cycle it was detected

### n-0009 - Corpus extraction into current-vocabulary requirements

- Parent: n-0000
- Fog: scouted
- Maturity: framed
- Priority: P0
- Outcome: Every settled decision in the 27 closed corpus tickets exists in-repo in current vocabulary, cited to its source issue, so no agent needs to read a closed issue to execute a ticket
- Open questions: Where do extracted requirements live - this session's `requirements.md`, a repository document, or the SDK Atlas itself once it exists? How are the corpus's factual contradictions with merged code recorded rather than propagated? Who verifies extraction fidelity, given the source is authoritative but wrongly spelled?
- Evidence: [#11](https://github.com/jdylanmc/atlas/issues/11) indexes 27 closed decisions; requirements I1-I7 in this package are a partial extraction already; evidence R3 records issue #6 retiring the `lint` alias against shipped `atlas lint --machine`; 23 of 27 ticket bodies remain unread
- Links: depends-on n-0004; blocks n-0002
- First seen: c-0001
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0001 created from decision D2; c-0001 priority P0 - fencing the corpus makes extraction a precondition for any agent-executable ticket; c-0002 outran n-0002, debt row open

### n-0010 - Residual prose-vocabulary protection

- Parent: n-0000
- Fog: scouted
- Maturity: framed
- Priority: P1
- Outcome: The vocabulary exposure that lane zero knowingly does not close is carried by open, agent-readable work rather than by a byte-lock alone
- Open questions: Is this one issue or several? Does it become a phase-5 acceptance criterion on the semantic pass, a standalone issue, or both? What names the exposure in `docs/ci.md` so the gap stays documented after #117 closes?
- Evidence: decision D5 accepts the exposure knowingly; evidence R6 explains why a deterministic prose check would overclaim; evidence R1 shows the exposure is theoretical today with zero current leakage; `CONTEXT.md` Lint places semantic verification after deterministic validation, so the receiving mechanism is already specified even though it is unbuilt
- Links: refined-by n-0008; relates-to n-0005
- First seen: c-0002
- Former node id: none
- Reinterpreted: c-0002 (intact)
- Promotion key: none
- Tracker: none
- Divergence: none
- History: c-0002 created from decision D5 - closing #117 narrowed removes it from the agent-facing surface under decision D2, so the residual must live in open work or it lives nowhere an agent may read

## Active Frontier

| Node | Fog | Maturity | Priority | Blocked by | Open questions |
| --- | --- | --- | --- | --- | --- |
| n-0000 | scouted | framed | unprioritized | none | none |
| n-0001 | unexplored | vague | unprioritized | n-0003 | 4 |
| n-0002 | unexplored | vague | unprioritized | n-0009 | 3 |
| n-0003 | unexplored | vague | unprioritized | none | 3 |
| n-0004 | researched | researched | P0 | none - promotion blocked by conflicted term Fleet | none material |
| n-0005 | unexplored | vague | unprioritized | none | 3 |
| n-0006 | unexplored | vague | unprioritized | none | 2 |
| n-0007 | unexplored | vague | unprioritized | none | 3 |
| n-0009 | scouted | framed | P0 | n-0004 | 3 |
| n-0010 | scouted | framed | P1 | none | 3 |

n-0008 is fog `cleared` and is therefore no longer on the frontier. It is
maturity `promotion-ready` and awaits a tier map and a promotion preview.

## Priority Debt

| Lower-priority node | Outran (maturity below researched) | Relation | Cause | Detected | Last seen | Status |
| --- | --- | --- | --- | --- | --- | --- |
| n-0002 | n-0009 | n-0009 blocks n-0002 | advanced n-0002 | c-0002 | c-0002 | open |

One row was detected and cleared within c-0002: n-0001 outran by n-0008,
`Cause: advanced n-0001`, detected c-0002, cleared c-0002 when n-0008 reached
maturity `promotion-ready`. Removed from this table under the clear rule and
recorded in both nodes' history and in the c-0002 checkpoint.

## Tracker Synchronization

| Node | Tier | Promotion key | Tracker item | Last synced cycle | Divergence |
| --- | --- | --- | --- | --- | --- |

Nothing promoted. `tracker-tier-map` is `unmapped`, and `tracker-mode` degraded
to `markdown-only` in cycle c-0002 when every composed skill became unavailable.
Promotion requires a restored tracker path, then
`Approve tier map atlas-sdk-v1-fleet-delivery`, then a promotion preview and its
exact approval. n-0008 is maturity `promotion-ready` and waiting on all three.
