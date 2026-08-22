# Requirements - Atlas SDK v1 fleet delivery

Every entry cites the artifact it came from and the node and cycle that recorded
it. Entries imported from the closed issue corpus were read directly from the
tracker on 2026-08-21; their **substance** is cited, but their **applicability
to the delivery layer** is unverified until a node or a user answer confirms it.

Corpus entries are written in pre-rename vocabulary at their source. Current
`CONTEXT.md` spellings are used here, with the source spelling noted where it
would otherwise be unfindable.

## Confirmed constraints

These are settled by merged code, a merged architecture decision record, or a
repository contract, and this session does not reopen them.

| # | Constraint | Source | Node | Cycle |
| --- | --- | --- | --- | --- |
| C1 | The SDK is a deterministic TypeScript library. It never calls a model. Every agentic step is a Markdown instruction file executed by an external coding agent, re-entering through validated input. | [ADR-0001](../../../docs/adr/0001-sdk-is-a-deterministic-library.md) | n-0000 | c-0001 |
| C2 | `npm run ci` is the complete gate and must pass with no network and no API key. It enforces 100% statements, branches, functions, and lines over `src/**/*.ts`. | [docs/ci.md](../../../docs/ci.md); verified locally 2026-08-21, 340 tests, 100% product coverage | n-0005 | c-0001 |
| C3 | Trusted Atlas SDK validation runs before Atlas-owned checks. An Atlas-owned check may add Findings but may never suppress or downgrade a trusted one. | `CONTEXT.md` (Finding, Lint) | n-0000 | c-0001 |
| C4 | Every pull request requires Deterministic verification plus four council checks: Bolas, Smaug, Balerion, and the Council gate. Fork pull requests fail closed. | [docs/ci.md](../../../docs/ci.md) | n-0005, n-0007 | c-0001 |
| C5 | A review finding is resolved only after `tests/adversarial/` has a permanent reject or accept case exercising it. Existing gate additions should be data-only corpus edits. | [AGENTS.md](../../../AGENTS.md); [docs/ci.md](../../../docs/ci.md) | n-0006 | c-0001 |
| C6 | Issue titles use `type(scope): summary`. A specification is one unlabeled parent issue; an implementation ticket is a reviewed tracer-bullet child carrying `ready-for-agent`. | [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) | n-0002 | c-0001 |
| C7 | A term listed under an `_Avoid_` line in `CONTEXT.md` may never appear in a bound identifier surface, and the check reports disagreement as a trusted Finding. | [docs/ci.md](../../../docs/ci.md); `src/lint/validate_vocabulary_agreement.ts` | n-0004 | c-0001 |
| C8 | Lint ordering is settled vocabulary, not a new decision: trusted deterministic validation runs before isolated Atlas-owned deterministic checks and semantic verification, and every semantic verdict must survive a Challenge. Atlas-owned deterministic checks are the **Check SDK**; human-approved invariants declaring deterministic or semantic evaluation are **Atlas Policies**. | `CONTEXT.md` definitions of Lint, Check SDK, and Atlas Policy | n-0008 | c-0002 |

## Decisions settled by the Maintainer

| # | Decision | Consequence | Node | Cycle |
| --- | --- | --- | --- | --- |
| D1 | Extending the vocabulary gate to every authored surface **blocks** opening the phase 5-12 lanes. Issue #117 is lane zero. | `vocabulary:validate` widens to `scripts/**/*.ts`, `docs/agents/atlas-sdk/**`, and any `.atlas/` templates the Framework Bundle ships, before any phase lane opens. Recorded as n-0008 at priority P0. | n-0004, n-0008 | c-0001 |
| D2 | The 27 closed decision tickets indexed by issue #11 are **immutable historical provenance**, not agent-facing instruction. | No agent is pointed at a closed issue to execute work. Settled substance is extracted into in-repo current-vocabulary requirements, and each `ready-for-agent` ticket is made self-sufficient. Recorded as n-0009 at priority P0. | n-0004, n-0009 | c-0001 |
| D3 | The deterministic vocabulary gate covers **TypeScript surfaces only**. Prose surfaces are out of deterministic scope and belong to the Lint semantic pass. | Widening scope is one `CONTRACT_ROOT` constant (R5). Pointing the existing detector at prose would prove almost nothing (R6), producing a green gate that overclaims - worse than the documented gap. | n-0008 | c-0002 |
| D4 | The context-window bound is a **guideline and design rationale**, not a hard invariant and not an error-severity gate. | An Atlas is kept small enough that one spawned agent can hold it entirely in context for semantic checking. This is one of the underlying principles behind splitting a large knowledge store: smaller Atlases are easier to check non-deterministically and therefore easier to keep at quality. **Unrecorded in `CONTEXT.md`; handoff pending.** | n-0008, n-0000 | c-0002 |
| D5 | Lane zero ships with a **knowingly unprotected prose surface**. Issue #117 closes as explicitly narrowed rather than fully satisfied. | The residual exposure is carried by newly opened work and named in `docs/ci.md`. Recorded as n-0010 at priority P1. Evidence R1 shows the exposure is theoretical today. | n-0008, n-0010 | c-0002 |
| D6 | **Ship narrow issues and close them** rather than holding an issue open until complete. Residual work becomes newly opened issues. | Governs ticket sizing across n-0001 and n-0002, not only n-0008. Interacts with D2: closing an issue removes it from the agent-facing surface, so opening the residual as its own issue is mandatory rather than optional. | n-0001, n-0002, n-0008, n-0010 | c-0002 |

D2 supersedes the implicit assumption behind imported requirements I1 through I7:
those entries remain cited to their source issues, but the source issues are now
provenance rather than instruction, and any conflict between a corpus entry and
merged code resolves in favor of merged code. The first known such conflict is
recorded as evidence R3.

## Imported from the closed corpus - substance cited, delivery applicability unverified

| # | Requirement | Source (pre-rename spelling noted) | Node | Cycle |
| --- | --- | --- | --- | --- |
| I1 | Implementation proceeds through twelve vertical phases, each extending the same executable Framework Bundle across domain, runtime, interface, validation, and acceptance seams. Shared primitives appear only when the next capability needs them. | [#5](https://github.com/jdylanmc/atlas/issues/5) | n-0000 | c-0001 |
| I2 | Phase acceptance requires 100% authored-TypeScript coverage, lint and type checking, behavior/migration/Git/CLI/clean-room tests in the covered suite, justified suppressions that do not lower the threshold, and all required council checks passing. | [#5](https://github.com/jdylanmc/atlas/issues/5) | n-0005 | c-0001 |
| I3 | Phases 5-12 in order: governance maintenance; Ingest one source end to end; complete composed Atlas Initialization; connected Atlases; search acceleration and learned source adapters; concurrency and proposal reconciliation; Atlas Site publication; Framework Upgrade plus clean-clone acceptance. (Source spells these Gather, Realm, Weave.) | [#5](https://github.com/jdylanmc/atlas/issues/5) | n-0000 | c-0001 |
| I4 | Atlas ships ten primary canonical skills beneath `.atlas/skills/`: `init-atlas`, `explore`, `gather`, `weave`, `pillar`, `law`, `refresh-realms`, `prune-realms`, `untrack-realm`, `upgrade-atlas`, plus `gather-session` as the base source adapter. Skill names in the source predate the rename and conflict with current `CONTEXT.md` vocabulary. | [#6](https://github.com/jdylanmc/atlas/issues/6) | n-0004 | c-0001 |
| I5 | Every skill begins with one shared Atlas Entry contract: resolve the working path, select exactly one non-overlapping Atlas, load the Manifest and compatibility declarations, verify tooling and schema support, load required Policies, load the skill's instruction files, record the base commit and operation class, check for upgrades, and classify entry as ready, degraded, or blocked. | [#6](https://github.com/jdylanmc/atlas/issues/6) | n-0000 | c-0001 |
| I6 | Mechanical operations use literal `atlas …` commands; fantasy vocabulary belongs at the human and agent layer only, never in continuous integration, reports, logs, or runtime interfaces. | [#6](https://github.com/jdylanmc/atlas/issues/6) | n-0004 | c-0001 |
| I7 | The corpus declares no unresolved specification fog: issue #11 records "all known in-scope decisions are represented by open tickets". | [#11](https://github.com/jdylanmc/atlas/issues/11) | n-0000 | c-0001 |

## Exclusions - settled out of scope

| # | Exclusion | Source |
| --- | --- | --- |
| X1 | User-level or global Atlas configuration. An Atlas behaves identically for every operator. | [#11](https://github.com/jdylanmc/atlas/issues/11) |
| X2 | Credential handling of any kind. Atlas inherits ambient `git` configuration. | [#11](https://github.com/jdylanmc/atlas/issues/11) |
| X3 | An interactive graphical Atlas application. A read-only published site is in scope. | [#11](https://github.com/jdylanmc/atlas/issues/11) |
| X4 | A centralized Atlas registry. | [#11](https://github.com/jdylanmc/atlas/issues/11); [#75](https://github.com/jdylanmc/atlas/issues/75) |
| X5 | Mandatory vector databases or semantic search services. | [#11](https://github.com/jdylanmc/atlas/issues/11) |
| X6 | Non-Git Atlas storage. | [#11](https://github.com/jdylanmc/atlas/issues/11) |
| X7 | Executing Atlas-supplied code during Explore, or anywhere outside isolated maintenance and continuous integration sandboxes. | [#11](https://github.com/jdylanmc/atlas/issues/11) |
| X8 | Pull-request Atlas Site previews and adversarial visual review. Explicitly post-v1. | [#54](https://github.com/jdylanmc/atlas/issues/54); [#112](https://github.com/jdylanmc/atlas/issues/112) |

## Unresolved requirements

| # | Question | Node | Cycle |
| --- | --- | --- | --- |
| U1 | Maximum concurrent sub-agents, and the isolation mechanism between them. | n-0001 | c-0001 |
| U2 | What a `ready-for-agent` ticket must carry for a cold start, and who verifies it. | n-0002 | c-0001 |
| U3 | The mechanical prevention for the merge trap under parallel branches. | n-0003 | c-0001 |
| U4 | Which authored TypeScript surfaces beyond `scripts/**/*.ts` are in scope for the widened gate. Narrowed by D3: prose surfaces are excluded by design. | n-0008 | c-0002 |
| U10 | Is n-0010 one issue or several, and does it become a phase-5 acceptance criterion, a standalone issue, or both? Blocked: opening it requires a tracker mutation and `tracker-mode` is degraded to `markdown-only`. | n-0010 | c-0002 |
| U11 | Does the conflict between D4's rationale and `CONTEXT.md`'s "multiple Atlases reserved for exceptional monorepo boundaries" change when an Atlas should be split? Staged for domain handoff. | n-0008, n-0000 | c-0002 |
| U5 | Whether the Dragon Council runs in continuous integration or locally, and the wall-clock cost of one slice through the full gate. | n-0005 | c-0001 |
| U6 | Whether the ten open defects against merged slices block, parallel, or defer against new phases. | n-0006 | c-0001 |
| U7 | The Maintainer's bounded review capacity, and which approvals are human-only by design. | n-0007 | c-0001 |
| U8 | Where extracted corpus requirements live, and who verifies extraction fidelity against an authoritative-but-wrongly-spelled source. | n-0009 | c-0001 |
| U9 | Whether the delivery layer is a distinct bounded context that may reuse the retired spelling `Fleet`, or must adopt a different term. Handoff pending. | n-0004 | c-0001 |
