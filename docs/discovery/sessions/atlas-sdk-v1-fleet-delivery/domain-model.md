# Domain Model - Atlas SDK v1 fleet delivery

## Confirmed Domain Model

Empty. No domain handoff has completed for this session, so nothing here is
mirrored from a canonical artifact yet.

The repository's authoritative product glossary is `CONTEXT.md` at the
repository root, and its architecture decision records live in `docs/adr/`, as
declared by `docs/agents/domain.md`. Those artifacts are the source of truth for
confirmed product vocabulary. This section will mirror only explicitly confirmed
results, each citing the artifact it came from.

## Candidate and Unconfirmed

### Live term collision: "Fleet"

Two readings are in simultaneous use in this repository.

- **Reading A - retired product term.** `CONTEXT.md` defines **Crawlers** as
  "the read-only subagents an Ingest dispatches to crawl one source in
  parallel", and marks `_Avoid_: Fleet`. Issue #9 settled this concept under the
  old name. Any occurrence of `Fleet` in `src/**/*.ts` now fails
  `npm run vocabulary:validate`.
- **Reading B - delivery term.** The Maintainer's request of 2026-08-21 uses
  "fleet of sub-agents" to mean parallel coding agents implementing tickets.
  This is a delivery-layer concept with no product meaning.

The readings are unrelated in meaning but identical in spelling, and the product
reading is explicitly retired. Status `conflicted`. Blocks promotion of any node
that depends on the term being unambiguous - currently n-0004.

Candidate resolution paths, none chosen: pick a distinct delivery term such as
"squad" or "lane group"; keep "fleet" as delivery-only with an explicit recorded
distinction; or avoid the word entirely in authored surfaces.

### Bounded context boundary: product domain versus delivery layer

`CONTEXT.md` governs the Atlas SDK product domain. This state root governs how
that product is built. The two are separate bounded contexts that currently
share a vocabulary namespace with no boundary marker, which is what made the
"Fleet" collision possible and invisible.

Open question: should the delivery layer declare an explicit bounded context so
its vocabulary is checked against, rather than merged into, the product
glossary? Unconfirmed.

### The legacy corpus is authoritative on substance, retired on spelling

The 27 closed decision tickets indexed by issue #11 record settled product
decisions in pre-rename vocabulary throughout: Realm, Bonfire, Lore, Thread,
Weave, Gather, Pillar, Fleet, Rest, Scout, Heresy, Chronicle, Realm Law, and
Creator. Issue #112 carries the rename mapping table, and issue #11 carries a
mapping note.

**Resolved by decision D2 in cycle c-0001**, at the delivery layer only: the
corpus is fenced as immutable historical provenance and is never read as agent
instruction. That decision is the Maintainer's and is recorded in
`requirements.md`. It is deliberately **not** mirrored into the confirmed
section here, because it is a delivery-process decision rather than a confirmed
product-domain meaning, and no canonical domain artifact was written for it.

Evidence R3 sharpens the original framing: the corpus is not only old-spelled,
it is in at least one place factually wrong about merged code. Issue #6 retires
the `lint` alias; `atlas lint --machine` is shipped and `Lint` is canonical.

### Artifact ownership is ambiguous between two domain skills

`docs/agents/domain.md` names `CONTEXT.md` and `docs/adr/` as the canonical
domain artifacts. This repository ships a `/domain-modeling` skill whose stated
purpose is writing them. The Discovery Loop composes `/domain-mapping`, which
also claimed the same artifacts.

**Resolved by elimination in cycle c-0002, not by decision.** `/domain-mapping`
was absent from disk when re-verified at 19:09, so `/domain-modeling` is
unambiguously the writer of those artifacts. The handoff is now blocked by the
composed skill's absence rather than by contested ownership.

### Candidate: the Atlas context-window bound

**Status: candidate. Not in `CONTEXT.md`. Handoff staged, not invoked.**

An Atlas is kept small enough that one spawned agent can hold it entirely in
context for the semantic half of Lint. Settled by the Maintainer in cycle c-0002
as a **guideline and design rationale**, not a hard invariant and not an
error-severity gate: it is one of the underlying principles behind splitting a
large knowledge store into smaller Atlases, because a smaller Atlas is easier to
check non-deterministically and therefore easier to keep at quality.

A negative search of `CONTEXT.md` for context window, size, fit, and token
language returned no match. `Atlas` is defined as "a sovereign, **bounded**
knowledge domain rooted in one Atlas Host Directory", where bounded scopes it to
a directory rather than to an agent's context window.

**Unresolved conflict with a settled term.** `CONTEXT.md` Atlas Host Directory
states that "Repository root is the encouraged default, with multiple Atlases
reserved for **exceptional** monorepo boundaries." The rationale above makes
splitting a routine, quality-driven decision. Two readings of when an Atlas
should be split are now in use. This is a change to the meaning of a settled
term and belongs to the domain skill; it is not reconciled here.
