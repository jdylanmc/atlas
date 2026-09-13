---
name: specify
description: "Human or scoped agent use after Discovery. Consume the full aligned Discovery artifact and produce a complete requirements specification; missing decisions return to Discovery, not invention."
disable-model-invocation: false
user-invocable: true
---

# Specify

**Entry:** Human or scoped agent use after Discovery. Consume the full aligned Discovery artifact and produce a complete requirements specification; missing decisions return to Discovery, not invention. Follow the [invocation contract](../setup/INVOCATION.md).

Follow [doctrine selection and application](../doctrine/APPLY.md), preserving the originating task's choices. With none, consider `documentation`, `domain`, and `test-seams` for the relevant portions of the spec. If separately authorized to prepare a documentation PR, require `worktrees` before its changes. Publishing a tracker item alone is not PR creation or implementation permission.

# Specify

Humans and coordinating agents may invoke Specify after [Discovery](../discovery/SKILL.md). It synthesizes a complete product requirements specification from an actual accessible, human-aligned Discovery artifact. Current conversation alone, an agent's assertion of alignment, or an inaccessible link is not sufficient intake. This is specification, not another discovery interview or implementation.

Read the configured tracker and triage vocabulary. Only GitHub, Azure DevOps, and local Markdown are supported. If configuration is missing, tell the human to invoke `/setup`; do not run it automatically. If it names an unsupported destination, report that and ask the human to choose a supported destination through Setup without changing the existing configuration.

## Process

### 1. Validate the Discovery source

Read the complete artifact and relevant linked evidence, decisions, and comments. Identify its location, owner, and revision (commit, tracker revision, or timestamp/content identity as available), and the human alignment evidence for that scope. State inaccessible evidence or revision uncertainty rather than claiming it was read. Separate confirmed requirements and agreed choices from assumptions, open questions, and superseded ideas.

If the artifact is absent, materially incomplete, stale in a way that affects scope, or not human-aligned, return the specific gaps to the Discovery owner for completion. A direct human can use Discovery to supply that source. Do not turn Specify into a substitute interview, infer missing human decisions, or publish an incomplete artifact as ready.

### 2. Ground requirements and testing expectations

Read relevant domain vocabulary, architectural decisions, and implementation evidence where needed to verify feasibility or current behavior. Product choices belong to the aligned source, not to whatever the code currently does. Surface conflicts rather than silently replacing the human's choices. Include agreed technical decisions only; label new suggestions as proposals.

Recover agreed testing expectations. Prefer existing high-level behavioral seams, and propose new seams only where evidence requires them. Check with the human that any new or changed testing expectations match their intent. Material scope/decision gaps return to the Discovery owner; focused confirmation of a testing proposal is not a new discovery loop.

### 3. Produce the complete specification

Use the outline below, scaled to the actual product, not an arbitrary story count. Cover all confirmed requirements without inventing features or quality targets to fill headings. Explicitly mark an inapplicable section with its reason. Keep unresolved nonblocking questions visible with owners and impact; unresolved decisions that prevent implementation block readiness.

```markdown
# <Product/feature>: Requirements specification

## Source and alignment
Discovery artifact location, owner, revision, human alignment evidence, and
relevant supporting sources. State which revision this specification derives from.

## Purpose and outcomes
Problem, intended outcome, and agreed success measures (unknown measures remain
unknown, not invented targets).

## Users and scenarios
Relevant users/actors, their goals, primary scenarios, and confirmed edge,
failure, or recovery scenarios.

## Functional requirements
Required observable behavior, linked to scenarios and source decisions.

## Nonfunctional requirements
Agreed performance, security/privacy, accessibility, reliability, operability,
and other quality requirements that apply. Record unknowns and owners explicitly.

## Constraints and agreed decisions
Product, compatibility, platform, dependency, rollout, or technical constraints;
agreed contracts/architecture and rationale. Distinguish proposals from decisions.

## Non-goals
Explicit exclusions and boundaries from the aligned source.

## Acceptance criteria
- [ ] AC-01: <observable criterion, with relevant requirement/source references>
Use stable IDs where criteria will be referenced by tickets or tests. Preserve
existing source IDs; allocate new spec IDs deliberately, not as tracker IDs.

## Testing and verification expectations
Agreed behavioral tests, relevant existing seams/prior art, manual checks where
needed, evidence expected for acceptance, and any limitations.

## Assumptions and unresolved decisions
Clearly labeled assumptions, remaining questions, owners, impact, and whether
each blocks implementation/readiness. Never present a hypothesis as agreed fact.

## Traceability
Map requirements and acceptance criteria to source decisions/scenarios and
agreed verification. Record meaningful source conflicts or coverage gaps.
```

Avoid an implementation walkthrough that will drift. Include a precise source path or a decision-rich prototype excerpt only when needed to identify evidence or preserve an agreed contract; label its provenance and revision. Do not replace the full requirements with a tiny dispatch summary.

Before publication, check the complete spec against the source: scope and decisions preserved, no invented requirements, acceptance coverage complete, references accessible, and testing expectations agreed. Surface human-owned gaps rather than marking them settled.

### 4. Publish within the configured scope

Publish the complete spec to the configured planning tracker using its provider/type/required-field conventions: [GitHub](../setup/issue-tracker-github.md), [Azure DevOps](../setup/issue-tracker-azure-devops.md), or [local Markdown](../setup/issue-tracker-local.md). Preserve the calling task's publication permissions; a review-only request stops at the proposal. Confirm the exact path and write for local files, or any replacement of an existing artifact. Do not fabricate required provider fields.

If the complete spec exceeds a tracker limit, obtain approval for an accessible attachment/document destination and link that complete artifact from the item. Verify access and completeness; do not truncate, invent a mandatory summary/full-document split, or silently write repository files.

Apply the configured `ready-for-agent` role only when requirements are complete and actionable, with no unresolved human-owned scope decisions. Otherwise report the blocker to the owner and withhold readiness; a requested draft remains explicitly incomplete. Preserve unrelated metadata and distinguish Azure DevOps tags from workflow states.

For authorized local artifact changes use [Changelog](../changelog/SKILL.md) in the correct repository/component: curated notable `Unreleased` entries following Keep a Changelog 1.1.0, or no entry needed. Include any proposed entry within write approval. No writes for proposals/reviews, commit dumps, automatic versions/releases, or recursive changelog-only entries.

Return the actual ID/URL/path, source revision, completeness/readiness, and any open decisions to the caller. Reconcile uncertain publication before retrying. When Joe-mode coordinates the work, return scope and planned breakdown to that owner; it reserves the specification delivery group before ticketing so a ready parent cannot race its children. Publishing a spec does not dispatch Ship, start Joe-mode, or approve [Breakdown Tickets](../breakdown-tickets/SKILL.md).
