# Evidence - Atlas SDK v1 fleet delivery

Every claim used in a decision traces to an entry here. Entries record the
source, the revision or read date, and any limitation on what the evidence
supports.

## Repository evidence

| # | Source | Revision / read date | Finding | Limitation |
| --- | --- | --- | --- | --- |
| E1 | `git log`, `main` | `3e4788c`, read 2026-08-21 | 146 commits. Head is `chore: ignore .worktrees (#125)`. Working tree clean before this session's writes. | None |
| E2 | `git ls-files` | read 2026-08-21 | 134 tracked files. `src/` holds 28 TypeScript files totalling 6,088 lines across `domain`, `atlas`, `graph`, `lint`, `operations`, `platform`, `framework`, `interfaces`. `src/adapters/` exists but is empty. | None |
| E3 | `npm run test:unit` and `npm run test:coverage:product` | executed 2026-08-21 | 340 tests, 0 failures, 0 skipped. Unit run about 43.4s; coverage run about 48.0s. `src/**/*.ts` at 100% statements, branches, functions, and lines. | Measured on one machine, once. Not a fleet-load measurement. |
| E4 | `grep -ril` over `src/` for glossary concepts | 2026-08-21 | No source match for Ingest, Crawlers, Candidate Graph, Atlas Cache, Atlas Slug, Atlas Policy, Challenge, Contradiction, Dispute, Divergence, Reconciliation, QMD, Upgrade, or Atlas Site. | Absence of a term is not proof of absence of the capability, but combined with E2 and the open issue set it is strong. |
| E5 | Repository root | 2026-08-21 | No `.atlas/` directory exists. Atlas SDK does not yet host its own Atlas; only fixtures under `tests/fixtures/` do. | None |
| E6 | `docs/ci.md` | read 2026-08-21 | The vocabulary agreement check scans `src/**/*.ts` only. The document itself names `scripts/atlas_sdk_agents.ts` and `docs/agents/atlas-sdk/personas/` as surfaces that ship bound vocabulary but are **not** scanned, and points at issue #117. | This is the repository's own stated gap, not an inference. |
| E7 | `CONTEXT.md` | read 2026-08-21 | About 90 defined terms. `_Avoid_` entries include Realm, Bonfire, Landmark, Hub, Rest, Insight, Lore, Thread, Pillar, Fleet, Scout, Weave, Gather, Heresy, Realm Chronicle, Realm Law, Creator, Owner, and Query (conditional). | The Query entry carries a lower-case qualifier and is therefore advisory only, per `docs/ci.md`. |
| E8 | `docs/adr/0001-sdk-is-a-deterministic-library.md` | read 2026-08-21 | The SDK never runs a model; agentic steps are Markdown executed externally. Stated cost: a semantic verdict is not reproducible from the repository alone, so it must cite evidence, survive a Challenge, and escalate to a human when inconclusive. | None |

## Research performed for cycle c-0001, node n-0004

Gathered read-only before the question group, so the Maintainer's budget was
spent on decisions rather than lookups.

| # | Method | Date | Finding | Limitation |
| --- | --- | --- | --- | --- |
| R1 | Whole-word `grep -rIl` for Realm, Bonfire, Lore, Thread, Pillar, Weave, Gather, Heresy, Scout, Fleet, and Chronicle across `scripts/`, `.cacophony/`, `docs/agents/`, `.agents/`, and `.github/` | 2026-08-21 | **Zero retired product-term occurrences.** The only two hits are ordinary English section headings: "Gather the complete decision context" (`.agents/skills/tickets/SKILL.md:47`) and "Gather only relevant evidence" (`.agents/skills/spec/SKILL.md:23`). The gap issue #117 describes is real but currently unexploited; remediation cost is zero today. | Whole-word search only. A retired term embedded inside a compound identifier, or split across a line break, would not match. Directory `docs/discovery/` was excluded as this session's own state, which itself contains the terms in quotation. |
| R2 | `docs/ci.md` close read | 2026-08-21 | The vocabulary gate scans `src/**/*.ts` only. The document names `scripts/atlas_sdk_agents.ts` and `docs/agents/atlas-sdk/personas/` as surfaces that emit product text carrying Core Archetype terms into user Atlases, and states a rename "would leave those prompts stale with the gate still green". | This is the repository's own stated gap, not an inference drawn from it. |
| R3 | Cross-check of corpus decisions against merged code | 2026-08-21 | Issue #6 states "the earlier internal `ingest`, `lint`, and `query` aliases are retired before implementation". The shipped command is `atlas lint --machine` (#111), and **Lint** is the canonical `CONTEXT.md` term. A sub-agent faithfully executing #6 would rename a merged, tested, gated command. | One instance found by targeted comparison, not by exhaustive audit. The other 23 unread ticket bodies may contain more. This is the evidence basis for decision D2. |

Conclusion carried into the question group: the corpus is not merely
old-spelled, it is in at least one place **factually wrong** about the current
system. That distinction is what separated "annotate" from "fence" in Q2.

## Research performed for cycle c-0002, node n-0008

| # | Method | Date | Finding | Limitation |
| --- | --- | --- | --- | --- |
| R4 | Issue #117 body, read directly | 2026-08-21 | Names the two unscanned surfaces precisely: `scripts/atlas_sdk_agents.ts` and `docs/agents/atlas-sdk/personas/merlin/persona.md`. States the defect class exactly - rename a Core Archetype consistently in `CONTEXT.md` and `src/domain/core_archetype.ts`, and the shipped prompt keeps the superseded term while continuous integration stays green. States a hard constraint: the script holds a byte-locked string literal and the persona file is byte-locked. | None |
| R5 | `scripts/vocabulary_agreement.ts` | 2026-08-21 | Scan scope is a single `CONTRACT_ROOT` constant consumed by `collectContracts(root, CONTRACT_ROOT)`. Widening the scope is a one-constant change. | Scope is the cheap half; detection is the expensive half. |
| R6 | `src/lint/validate_vocabulary_agreement.ts` behavior via `docs/ci.md` | 2026-08-21 | The detector is TypeScript-shaped. Page-ID prefixes, page types, and Finding messages are read **only inside single-line string and template literals**, precisely because those shapes occur in prose. Only `ATLAS_*` codes and `.atlas/<directory>/` references are read anywhere. **A Markdown persona has no string literals**, so pointing the existing checker at it would detect essentially nothing - including nothing about the stale-term case #117 exists to prevent. | This is the decisive finding for D3. A widened scope without a changed detector would be a green gate that proves nothing. |
| R7 | `tests/adversarial/vocabulary-agreement.json` and `tests/adversarial_corpus.test.ts` | 2026-08-21 | Thirteen cases, each `{name, expectation, gate, codes\|messages, input: {glossaryAvoidance, source}}`, with the loader asserting `gate == "vocabulary-agreement"` and both input fields as strings. The corpus is **TypeScript-source shaped**. A prose case needs a new field or gate identifier. | Under D3 the scope stays TypeScript-shaped, so corpus additions stay data-only and the `AGENTS.md` collision dissolves rather than needing resolution. |

## Limitations discovered in cycle c-0002

- The byte-lock mechanism named by #117 was searched for in
  `tests/atlas_sdk_agents.test.ts` and **not located by that search**. #117's
  claim is taken as accurate; the mechanism itself is unverified.
- Cycle c-0001 wrote a duplicate `Active Frontier` table into `discovery.md`
  through a heading-consuming edit, and its verification did not detect it
  because that verification checked content presence rather than structural
  validity. Repaired in c-0002 under `Approve session setup`. The c-0001
  checkpoint's `exit-state-digest` describes the pre-repair, schema-invalid
  bytes and is not rewritten, because a published checkpoint is immutable.
- All five composed skills and this loop's own `discovery-loop` directory were
  absent from `/Users/dylan/.agents/skills/` from 18:08 onward and were still
  absent when re-verified at 19:09. `tracker-mode` is degraded to
  `markdown-only`; no tracker mutation is possible through the sanctioned path.

## Tracker evidence

| # | Source | Read date | Finding | Limitation |
| --- | --- | --- | --- | --- |
| T1 | Issue [#11](https://github.com/jdylanmc/atlas/issues/11), closed, label `wayfinder:map` | 2026-08-21 | The canonical Wayfinder map. Carries Destination, Notes, 27 indexed closed decisions, an explicit out-of-scope list, and `## Not yet specified` reading "No unresolved fog remains; all known in-scope decisions are represented by open tickets." | Written entirely in pre-rename vocabulary. Historical provenance, not current-vocabulary state. |
| T2 | Issue [#5](https://github.com/jdylanmc/atlas/issues/5), closed | 2026-08-21 | The twelve-phase vertical sequence with per-phase scope and shared acceptance criteria. Phases 1-4 correspond to the merged work. Phase 2 text says "deliver `atlas weave --json`"; the shipped command is `atlas lint --machine`. | The command-name divergence is a rename artifact, not a design change. |
| T3 | Issue [#6](https://github.com/jdylanmc/atlas/issues/6), closed | 2026-08-21 | Ten packaged skills, the literal `atlas …` command surface, and the shared Atlas Entry contract. Explicitly retires the earlier `ingest`, `lint`, and `query` aliases before implementation. | The retired-alias decision predates the rename that made `lint` canonical. Direct conflict with shipped `atlas lint`; needs reconciliation. |
| T4 | Issue [#112](https://github.com/jdylanmc/atlas/issues/112), open | 2026-08-21 | Records the rename mapping table, the `sdk-core` versus `atlas-owned` trust axis, working agreements, and the merge trap: pull request #113 was squash-merged after its content had been carried forward, reintroducing deleted paths and breaking `main` with no merge conflict. Also states the continuous integration council is offline and must be run locally. | Last updated 2026-08-20; the offline-council claim may be stale. Unverified. |
| T5 | `gh issue list --state all` | 2026-08-21 | 31 open issues. 12 carry `ready-for-agent` (#80-#91 plus #120). Ten open defects target already-merged slices: #117, #118, #119, #121, #122, #124, #133, #134, #135, #136, #139. | None |
| T6 | Issue [#9](https://github.com/jdylanmc/atlas/issues/9), closed | 2026-08-21 | Settles the Ingest workflow under the name Gather, and introduces "Fleet" as the read-only crawling subagents - now `Crawlers`, with `Fleet` an `_Avoid_` term. | This is the origin of the live "Fleet" collision recorded in `domain-model.md`. |

## Limitations of this evidence set

- The 27 closed decision tickets were indexed from issue #11 and sampled
  directly for #5, #6, #9, and #11. The remaining 23 were read only through
  #11's one-line summaries. Full bodies are unread.
- No measurement exists for concurrent agent load, review latency, or merge
  contention. Every claim about throughput in this session is currently
  inference, not evidence.
- Issue #112's claim that the council is offline has not been checked against
  recent workflow runs.

## Historical provenance

Issue [#11](https://github.com/jdylanmc/atlas/issues/11) and its 27 closed
decision tickets are the prior discovery corpus for this product. They were
imported as seed material for this session on 2026-08-21 under the legacy
artifact rule. The originals were not modified.
