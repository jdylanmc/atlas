---
workflow: ingest-source
atlas-sdk-schema: 1.0.0
adr: docs/adr/0001-sdk-is-a-deterministic-library.md
---

# Ingest one repository source

Use this instruction file when a human asks to Ingest one local repository
source into the Home Atlas. Ingest takes one source per invocation.

The Atlas SDK is deterministic and never invokes a model. This workflow, not the
SDK, dispatches the read-only Crawlers. The SDK owns only the deterministic
half: the typed Ingest Scope it hands you, the exact Candidate Graph shape it
accepts back, the correspondence that returned graph must survive, and the one
deterministic reconciliation into an Atlas Change Set and Atlas Proposal.

## Steps

1. **Agree the Ingest Scope with the human.** Record the source entry point, the
   depth or stopping rule, the included and excluded regions, the Source
   Authority class, the freshness window, and the observation time. Capture the
   approving human and time. Crawlers may fully traverse within this envelope but
   must request approval before expanding beyond it.

2. **Dispatch read-only Crawlers.** They crawl the one source in parallel and
   report candidates. Crawlers never write to the Atlas. For each Source they
   return the captured content bytes at the cited revision, the asserted Source
   Revision Time, and the Atlas-assigned Source Authority. For each Concept they
   return its single claim and its claim-level Citations, each quoting the exact
   text it relies on from a cited Source. For each Edge they return its endpoints,
   typed semantics, and supporting Citation.

3. **Return one Candidate Graph as validated input.** Do not ask the SDK for
   semantic judgment. Hand the SDK the `AtlasIngestRequest` (Ingest Scope plus
   Candidate Graph). The SDK reconciles deterministically and rejects anything
   whose correspondence it cannot verify:
   - a Citation whose quote does not appear in the cited Source revision content;
   - a Concept with no claim, no Citation, or no Edge;
   - an Edge whose endpoint does not exist or that connects to a Source;
   - a candidate whose locator lies outside the approved Ingest Scope, which
     pauses for human approval rather than being ingested;
   - an accepted Contradiction that does not name an active Principle truth, or a
     contradiction not yet accepted by a human;
   - an equal-authority Dispute that Source Revision Time cannot settle, which
     escalates to a human.

4. **Review the one Atlas Proposal.** On success the SDK produces one Atlas
   Proposal with a source-revision-aware Source, cited derived knowledge, one
   appended Atlas Changelog entry, and a full Lint pass. Merge it through Git
   governance. Stale Knowledge is surfaced for optional re-Ingest but does not
   block the merge.
