---
schema-version: 1
state-root: docs/discovery
sessions: 1
last-updated-cycle: atlas-sdk-v1-fleet-delivery/c-0002
---

# Primary Discovery Map - Atlas SDK

## Product Idea and Destination

Atlas SDK is a structured knowledge environment that lets coding agents discover
and traverse project-relevant knowledge from a Git-backed, directory-scoped
`.atlas/` domain, with no central registry and no mandatory semantic-search
service.

Destination: Atlas SDK v1 as specified by issue #75, sequenced by the twelve
vertical phases settled in issue #5, and proven by the clean-clone SDK Atlas
acceptance journey in issue #91.

Phases 1 through 4 are merged. Phases 5 through 12 are unstarted and are the
subject of the sessions below.

## Verticals and Cross-Cutting Domains

| Session | Kind | Priority | Maturity | Active fog | Major blockers | Package |
| --- | --- | --- | --- | --- | --- | --- |
| atlas-sdk-v1-fleet-delivery | cross-cutting | P0 | researched | Fleet operating model, cold-start ticket contract, merge discipline, gate throughput, defect paydown, and review capacity remain unexplored; n-0008 is cleared and promotion-ready | Promotion blocked: tracker-mode degraded to markdown-only, tier map unmapped, term `Fleet` conflicted with two pending domain handoffs | [discovery.md](./sessions/atlas-sdk-v1-fleet-delivery/discovery.md) |

## Typed Session Links

| From | Link | To | Why |
| --- | --- | --- | --- |

No cross-session links exist yet; this state root holds one session.

## Shared Actors and Constraints

- Maintainer (human) - the only approver of Principles, Atlas Policies, and merges. A structural throughput limit by design, not an accident.
- Coding sub-agent - executes one tracer-bullet ticket from a fresh context, with no memory of prior sessions.
- Dragon Council (Bolas, Smaug, Balerion, Fletcher) - adversarial review gate required on every pull request.
- `npm run ci` - the complete gate. 100% statements, branches, functions, and lines over `src/**/*.ts`, no network, no API key.
- The twelve-phase vertical sequence in issue #5 is settled. This state root sequences delivery; it does not re-litigate the sequence.
- `CONTEXT.md` is the authoritative product glossary. Its `_Avoid_` entries are enforceable through `npm run vocabulary:validate`.
