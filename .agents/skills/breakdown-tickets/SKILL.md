---
name: breakdown-tickets
description: "Human or scoped agent use after Specify. Break a full requirements specification into actionable tickets; obtain human approval before publication."
disable-model-invocation: false
user-invocable: true
---

# Breakdown Tickets

**Entry:** Human or scoped agent use after Specify. Break a full requirements specification into actionable tickets; obtain human approval before publication. Follow the [invocation contract](../setup/INVOCATION.md).

Use [doctrine selection and application](../doctrine/APPLY.md), preserving the parent deliverable's choices. With none, consider `sequencing` and `documentation` for dependency-aware, durable work packets. Carry scoped selections and required IDs into implementation handoffs. A separately authorized PR for local ticket files requires `worktrees`; tracker publication alone does not.

After [Specify](../specify/SKILL.md), break its completed requirements specification into **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it. A human or coordinating agent may invoke this workflow; both preserve human approval before publication. A raw conversation, exploratory plan, or unfinished Discovery artifact is not a requirements specification.

Read the configured tracker and triage vocabulary. Only GitHub, Azure DevOps, and local Markdown are supported. If configuration is missing or unsupported, report it and tell the human to invoke `/setup` to choose a supported destination. Do not run Setup or replace existing configuration automatically.

## Process

### 1. Gather context

Require the completed specification as an accessible artifact or tracker item. Read its complete body, relevant comments and linked requirements, including any approved full-spec attachment; record the canonical source, revision, and owner. Confirm acceptance criteria, non-goals, agreed testing expectations, and unresolved decisions. If requirements are incomplete or unaligned, return the gaps to Specify's owner rather than inventing them or starting a discovery interview.

Carry existing acceptance IDs exactly into slices. If the source has no IDs, cite its exact criteria/section anchors and request stable IDs from the specification owner when needed; do not fabricate IDs or quietly edit the spec.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through the relevant layers (for example schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Propose prefactoring first only when evidence shows it enables the accepted outcome; keep its verification and scope explicit

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. No blockers means dependency-unblocked, not automatically ready or authorized to start.

Tie every slice to real specification acceptance criteria and agreed verification. Record only evidenced blocking edges; distinguish a true prerequisite from a preferred work order. Check coverage, cycles, and what is available on each delivery's base. Unknown dependency identities remain unresolved references, not invented issue numbers.

**Wide mechanical refactors may need a coherent batch instead of vertical slices.** Do not force independently unshippable pieces into separate deliveries. An ordinary coordinated refactor does not by itself justify compatibility scaffolding. Consider the internal [Migration](../migration/SKILL.md) helper only when there is evidence the application is in production and this change actually requires a migration (such as persisted data, deployed consumers, or rollout overlap). Pre-1.0 prototypes normally skip that ceremony; versions alone do not prove absence of users/data. Unknown production or migration need is a question for the owner. If eligible, propose safe stages and real dependencies; later contraction requires agreed scope. Otherwise keep the ordinary change coherent and green without speculative expand–contract layers.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work
- **Acceptance and verification**: exact source criteria/IDs covered and the agreed proof
- **Readiness and gaps**: whether it is fully specified, any human-owned decisions, and genuine prerequisites
- **Delivery grouping and assignment**: one specification-owned PR or intentionally separate deliveries; include the proposed assignee policy when Joe-mode is scoped to assigned-to-me work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup` configured; the tickets are the same either way, only the shape of the blocking edges changes:

- **Local Markdown** → write one file per ticket at the configured paths (default `.scratch/<feature-slug>/issues/<NN>-<slug>.md`), numbered from `01` for a new graph in dependency order (blockers first). Preserve existing files and numbering when continuing a graph. Each file's "Blocked by" lists the actual numbers/titles it depends on. Include these exact paths and writes in approval. Use the per-ticket file template below: one ticket per file, never a single combined file.
- **GitHub or Azure DevOps** → publish one item per ticket in dependency order (blockers first) using the configured planning scope, work-item type, and required fields. Resolve actual returned IDs before writing native parent/dependency relationships or "Blocked by" references. Never turn draft slice numbers into presumed tracker IDs. Use the approved assignee policy rather than silently reassigning work.

Apply the configured `ready-for-agent` mapping only to fully specified, actionable slices without unresolved human-owned requirements. Ticket creation is not readiness by construction. A slice may be specified but blocked by another delivery; retain its real edges and do not dispatch it until those prerequisites are available. Keep incomplete approved drafts explicitly non-ready using the configured convention, preserving unrelated labels/tags and provider workflow states.

For local files, substitute the configured role value in the status field below too. For Azure DevOps use the [provider reference](../setup/issue-tracker-azure-devops.md), not GitHub commands or assumed process fields.

For authorized local ticket writes use [Changelog](../changelog/SKILL.md) in the correct repository/component: curate notable `Unreleased` entries under Keep a Changelog 1.1.0, or report no entry needed. Include proposed entries in write approval; do not write during proposals/reviews, dump commits, create versions/releases, or add recursive entries for changelog-only changes. Use an isolated PR worktree only when separately authorized to deliver these local files in a PR; external tracker publication does not require one.

Return the source revision, all created IDs/URLs/paths, acceptance coverage, dependency edges, readiness, and grouping to the coordinating owner. In Joe-mode, reserve the parent specification before publication and reconcile the entire graph before dispatch: either one Ship owns the spec and its children or the parent is suppressed from dispatch while intentionally independent child deliveries run. Do not launch both or start Joe-mode just because tickets exist. After uncertain publication, reconcile actual tracker results before retrying; report partial graphs instead of duplicating tickets.

Work the **frontier**: any ready, owned ticket whose blockers are complete and available on its delivery base, not merely green on an unmerged branch. For a purely linear chain that means top to bottom.

Do NOT close or rewrite any parent issue. Only the explicitly approved parent/child relationship operations may touch its links.

<local-ticket-template>

# <NN>: <Ticket title>

**Specification:** <canonical path/URL and revision>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None".

**Status:** <configured role value matching actual readiness>

**Acceptance:** <exact source IDs or criterion/section references>

- [ ] <Source criterion and this slice's observable coverage>

**Verification:** <agreed tests/checks and expected evidence>

**Open decisions:** <owner and blocking impact, or none>

</local-ticket-template>

<issue-template>

## Parent

A reference to the actual parent specification on the tracker, when present. Always identify the canonical specification location and revision even if it is a document rather than a tracker parent.

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective, not layer-by-layer implementation.

## Acceptance criteria

- [ ] <Exact source criterion ID/reference and this slice's observable coverage>

## Verification and readiness

Agreed tests/checks and expected evidence. State unresolved decisions, their owners,
and blocking impact, or none; distinguish readiness from dependency availability.

## Blocked by

- A reference to each blocking ticket, or "None".

</issue-template>

In either form, avoid specific file paths or code snippets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.
