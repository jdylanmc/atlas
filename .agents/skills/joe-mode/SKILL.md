---
name: joe-mode
description: "Human-only activation, one controller per repository. Loop backlog, discovery, planning, and delivery until stopped; aggressively use Squadron for distinct delivery and Shepherd assignments, with event status snapshots."
disable-model-invocation: true
user-invocable: true
---

# Joe-mode

Hand the human pull requests to review. Loop the existing skills; do not replace their workflows with a second implementation process. The human-authored [intent](intent.md) defines the purpose.

Use [Doctrine](../doctrine/SKILL.md) under the [common application contract](../doctrine/APPLY.md). Scope explicit selections to the named delivery, not every unrelated backlog item. With none preselected, choose appropriate doctrines per worker from catalog metadata; each work packet carries IDs, required flags, reasons, source locations, and digests. Applying workers retrieve the texts. Require `worktrees` for each PR-producing lane and preserve role-specific requirements such as `solid` for code Roast.

Joe-mode starts only when requested and stays active in this session until paused or stopped. Apply its routing to subsequent turns within the anchor. A side question does not silently stop the work; an explicit redirection does. A worker dispatched for a bounded task must not activate another Joe-mode controller. Follow the [invocation contract](../setup/INVOCATION.md): one controller per repository, not one per issue, branch, worktree, or selected scope.

Kickoff authorizes ordinary delivery of selected in-scope work, including repairs, commits, PR publication, review, and shepherding. Do not ask again at each routine transition. Preserve explicit narrower requests, human product decisions, scope changes, and each planning/recording approval gate. Human approval and merging are never delegated.

## 1. Resolve the anchor

Accept an idea, folder, repository, issue, specification, backlog, or another concrete reference. Identify the goal and exclusions. Resolve a containing or explicitly linked Git repository when one exists; do not require an idea to arrive as a ticket.

Read repository guidance and existing `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and domain configuration when present. Inspect Git remotes read-only. GitHub remotes normally identify an owner/repository; Azure DevOps remotes identify an organization/project/repository. Code hosting does not prove where planning lives: honor configured separate planning projects or trackers.

Establish the backlog selection from the request and configuration:

- A named issue or specification anchors that deliverable and its relevant relationships, not the whole repository backlog.
- A full-backlog request means the selected repository/project/area/query, never the entire organization by inference.
- An assigned-to-me request adds the authenticated provider user's assignee filter; Git commit identity is not proof of that identity.
- A folder or idea may need a repository and backlog scope clarified. Ask the smallest material question rather than silently choosing full backlog.

Resolve ambiguous remotes, planning scopes, and identities before dispatch. Inspect actual configuration against [Setup's completeness criteria](../setup/SKILL.md#joe-mode-bootstrap-readiness), not file existence or a remembered setup run. Record absent/incomplete configuration for the bootstrap in step 2; do not invoke Setup before repository-wide ownership is established. Its [GitHub](../setup/issue-tracker-github.md), [Azure DevOps](../setup/issue-tracker-azure-devops.md), and [local Markdown](../setup/issue-tracker-local.md) references describe the supported mechanisms. Unsupported or ambiguous existing configuration needs a human choice, not an automatic reset or migration.

If the anchor has no repository yet, discovery can start without one. Report backlog/provider discovery as unresolved and defer tracker publication and delivery until their destinations are agreed. An unavailable tracker is not an empty backlog.

## 2. Establish one controller and a work board

Use harness session storage or a uniquely named session/OS-temporary artifact, not a new repository planning file. Record the repository identity, controller ID, anchor and actual objective start evidence, provider and planning scope, assignee filter, mapped readiness role, permissions, active owners and parent relationships, worktree/branch locations, covered item IDs, dependencies, evidence pointers, human questions, PR status, cycle boundaries, and reported event identities.

Reconcile any prior board with live agents and provider state before reusing it. Resolve the common Git directory and normalized repository/provider identity so another worktree or clone is not mistaken for a different repository. Do not duplicate another active Joe-mode owner even for disjoint scopes in that repository: join the current controller or arrange explicit transfer. If visibility or ownership is uncertain, resolve it before dispatch rather than racing another session. A local board is coordination state, not a cross-session lock. An idea without a repository may begin discovery; check repository-wide ownership when its repository is resolved.

Read [runtime guidance](RUNTIME.md) before dispatch. Confirm the harness supports the requested agents and background work. Use a bounded capacity appropriate to available tools and resources; retain capacity for the human-facing discovery path and for completion/review work rather than filling every slot with new implementation.

### Bootstrap missing setup under this owner

Before any Setup invocation, reconcile active Setup ownership for this repository
as well as the Joe controller, including other worktrees/sessions. Join or resume
the existing Setup owner and route its questions through the controller; do not
start a second run. Uncertain visibility or ownership is a blocker, not permission
to dispatch. Record the Setup owner, workspace, actual configuration gaps, pending
decisions, and outcome on the existing board. Provider/scope fields may remain
unresolved while setup is pending; they are not permission to broaden the anchor.

If setup is complete, reuse it without rerunning Setup. If required configuration
is absent/incomplete and no Setup owner is active, automatically attempt the
current local [Setup](../setup/SKILL.md) as this human-started controller's bounded
bootstrap subflow. Use the actual harness skill invocation when registered; when
not registered, directly read and follow its local `SKILL.md` and required
references as the subflow if repository guidance permits. Do not merely recommend
`/setup`. If neither route is available, report the missing package or
invocation/read capability; do not
install a package or substitute an upstream workflow.

Carry the repository, original anchor/exclusions, objective-start evidence,
controller/Setup ownership, configuration gaps, and existing human choices into
Setup. Its provider/label decisions and exact-file write approval remain human
gates, not routine delivery permissions. If the human is unavailable or declines,
or invocation fails, record an explicit waiting/blocker state and the needed
action. Reconcile any partial writes; do not retry unchanged failures in the
loop or treat an invocation acknowledgement as success.

After Setup returns complete, re-read the actual repository guidance and
configuration using its completeness criteria. If its approved workspace differs,
coordinate availability through its owner; do not copy unapproved files into this
checkout or claim unseen configuration is usable. Resolve remaining gaps or
conflicting/unsupported choices with the human and wait on affected paths.
Resume the original anchor and step 3 only with usable configuration: refresh
the provider scope, identity filter, and readiness-role mapping without widening
the backlog, marking issues ready, restarting the controller, or resetting the
objective clock. Independent work not needing setup may continue within scope.

### Dispatch through the controller

Joe-mode owns routing and the human conversation. Use [Squadron](../squadron/SKILL.md) aggressively to dispatch independent investigations, planning, and distinct Ship/Patch/Refactor deliveries or Shepherd assignments. Keep useful capacity occupied without splitting dependent work or manufacturing agents for trivial tasks. Each delivery route retains its own workers and integration; Shepherd retains its one PR monitor. Do not launch competing workers underneath those owners or delegate the Joe controller itself.

## 3. Refresh the relevant backlog

Query only the anchored selection, with the configured `ready-for-agent` role mapping. It may be a GitHub label, an Azure DevOps tag, or a configured local equivalent. Do not invent a second readiness checklist, hardcode a replacement label, or silently mark existing issues ready.

Use narrow queries, pagination, and batch detail retrieval. Load full requirements, dependencies, existing PR associations, and ownership only for candidates or related items needed for scheduling. Distinguish a complete empty result from a failed or truncated query. A failed query cannot justify generating a replacement backlog.

Readiness is eligibility, not a bypass of dependencies or ownership. Exclude closed/completed items, work reserved by an active delivery, and items blocked by prerequisites absent from their intended base. Do not steal assignments or treat "assigned to me" as proof no other agent is working on the item.

Recheck candidates and known PRs immediately before reserving and dispatching. Use the configured shared claim mechanism if available and authorized; preserve existing ownership. If reliable exclusive ownership cannot be established, report that limit and resolve it before overlapping work. Never claim a session-only reservation protects against every external actor.

### Choose non-overlapping deliveries

Use provider-qualified item identities and record the full coverage of each delivery group, not just its parent ID.

- **One specification, one PR:** reserve the specification and its child graph for one Ship owner. Ship schedules its internal frontier; Joe-mode does not also launch child Ship jobs.
- **Intentionally separate deliveries:** reserve non-overlapping ticket groups, suppress the spec parent as an implementation candidate, and observe cross-delivery dependencies. Choose this only when the slices are intentionally separate PRs.

Reserve a spec's group before starting ticket breakdown: `specify` may already have applied the readiness label. Newly published children must not race a parent delivery or be dispatched before the approved graph and grouping are recorded. If grouping is materially ambiguous, ask.

A dependency across separate PRs is satisfied only when the required changes are available on the consumer's agreed base, normally after the prerequisite merges. A green but unmerged PR or a closed tracker item alone is insufficient. Inside one Ship graph, Ship's integrated-commit and validation rules govern.

## 4. Run concurrent paths through the existing flow

Fill available capacity with independent work. Do not stop all delivery while the next slice is being discovered. Do not wait for the whole backlog to be specified before dispatching known work.

| Situation | Route and return contract |
| --- | --- |
| Unsettled question; no defined backlog yet | [discovery](../discovery/SKILL.md): aligned findings, domain understanding, frontier, full foundation and compact handoff. It can request [research](../research/SKILL.md) or [poc](../poc/SKILL.md); those return evidence, not product changes. |
| A focused human question | [interrogate](../interrogate/SKILL.md): actual human answers. During discovery, use its conversation-only intake and let discovery own the alignment gate. |
| Aligned terminology or a consequential architectural choice needs a record | [domain-modeling](../domain-modeling/SKILL.md): glossary and Architecture Decision Records (ADRs) when its criteria warrant one. Distinguish proposals from human decisions; do not generate ceremonial ADRs for every ticket. |
| An aligned Discovery artifact is ready | [specify](../specify/SKILL.md): consume the full accessible foundation and evidence, then produce the full requirements specification. A conversation summary is not a substitute; missing source decisions return to Discovery. |
| An approved spec needs actionable slices | [breakdown-tickets](../breakdown-tickets/SKILL.md): human-approved vertical slices, blocking edges, and configured readiness labels. Reserve the delivery group before publication and reconcile the resulting IDs afterward. |
| External requests need classification | [triage](../triage/SKILL.md): apply the configured workflow to incoming external work. Do not retriage generated, already-ready tickets. |
| A feature, behavior change, or spec graph is ready | [ship](../ship/SKILL.md): scoped implementation and integration through reviewed delivery. A human may ship one issue; Joe may assign several independent deliveries, never overlapping graphs. |
| A bug or regression is ready | [patch](../patch/SKILL.md): reproduce, establish cause, repair, review, publish, and shepherd. Planned behavior changes belong to Ship. |
| A behavior-preserving structural change is ready | [refactor](../refactor/SKILL.md): preserve the contract while restructuring, then review, publish, and shepherd. |
| A published PR needs attention | Its existing [Shepherd](../shepherd/SKILL.md): observe checks/reviews/policies, rebase on base advancement even if mergeable, and return functional feedback to its recorded delivery owner on that same PR. Join the current owner rather than starting another monitor. |
| New evidence invalidates a slice | Return to its owner: defect diagnosis within the current delivery, or Discovery for unsettled requirements. Explicit diagnosis-only scope stays read-only; do not spawn another Patch PR for the same work. |

These are paths through the decision tree, not a mandatory global sequence. When specifications are needed, the order is Discovery artifact, Specify requirements, then Breakdown Tickets. A small, understood issue need not create another spec, ADR, or discovery run. Choose the delivery route by kind, scope, and size; Patch and Refactor are peer routes, not mandatory wrappers around Ship. All share [reviewed delivery completion](../ship/DELIVERY.md), independent [Roast](../roast/SKILL.md), [Verify](../verify/SKILL.md), and mandatory Shepherd. Once a route yields its required output, automatically reevaluate within existing permissions.

Keep one human-facing discovery/planning conversation moving while delivery agents work. A discovery worker returns its real questions and waits; Joe-mode presents them to the human and sends the actual answers back. Do not let an agent simulate the human's side or let several workers ask competing questions simultaneously.

ADRs and domain documents are repository changes, not incidental scratch notes. Give their worker an agreed isolated documentation/delivery workspace, serialize shared-file edits, and carry approved records into the corresponding reviewed PR or an explicitly scoped documentation PR. Every modifying worker uses [Changelog](../changelog/SKILL.md); the integration owner consolidates notable entries instead of letting workers race on the shared file. Do not let planning workers edit a live delivery worktree concurrently. Where a downstream skill needs repository files before publication, arrange that workspace explicitly rather than copying unapproved documents into the product checkout.

An anchor spanning ready and uncertain work should have both paths active when capacity and human availability allow. When no work is defined, discovery feeds specification and ticketing first. When the human is unavailable, pause only the paths needing their decisions; independently authorized delivery continues.

## 5. Reconcile outcomes and keep looping

Each worker receives the anchor subset, concrete inputs and evidence paths, selected skill, owner and workspace, permitted mutations, dependencies, stop conditions, and return contract. Returns must identify produced artifacts/provider IDs, observed checks, unresolved decisions, blockers, and any active child or monitor ownership.

On a completion, human answer, PR event, or meaningful backlog change:

1. Read the result and verify its decisive artifacts or provider state. A worker's "done" is not proof of a published PR, human approval, or completed prerequisite.
2. Reconcile owned item coverage, dependencies, permissions, and pending questions. Record partial writes before retrying; inspect the provider after uncertain publication to avoid duplicate specs, tickets, or PRs.
3. Route newly ready work and release capacity only when ownership is actually transferred or the work ends. Reuse existing workers for follow-up where the harness supports it.
4. Surface review-ready PRs and material human questions; keep unrelated work moving.

If new findings contradict an active delivery, notify its owner and pause affected work at a safe boundary. Reconcile scope with the human; do not mutate the worker's requirements under it or restart the entire backlog. Preserve unrelated progress.

Auto-transition is not blanket approval. Preserve alignment, ticket-breakdown, and explicitly retained recording/publication gates; do not reintroduce a separate permission prompt for routine delivery already authorized at kickoff. Coordinate meaningful approval requests with the proposed change. Never accept product risk, supply a human decision, merge, approve, or enable auto-merge on their behalf.

Use completion notifications or the runtime's documented wait mechanism. Refresh the scoped backlog after relevant events and at an appropriate bounded interval only while a real observer is running. Do not busy-poll, spawn idle agents, or imply a final response leaves an unscheduled loop executing.

### Status at full-cycle and major-merge boundaries

Track a finite cycle: refresh the selected backlog, record that pass's actionable
cohort and planning questions, dispatch eligible work, then reconcile each
assignment's outcome or explicit blocked/human-wait state. A reviewed current
PR with confirmed continuing Shepherd custody is a reconciled outcome; do not
wait for its monitor to terminate. A launch acknowledgement or still-running
implementation is not a completed assignment.

After that full cycle completes, request one [Status Report](../status-report/SKILL.md)
before returning to the start. Supply the controller's objective, original start
evidence, known descendants, outcome evidence, and cycle identity. Do not equate
every poll or notification with a cycle, or repeat reports for an unchanged
empty/blocked board.

Also request a snapshot after a **confirmed major-feature merge** in scope.
Establish significance from the agreed feature/spec, not every PR label or
agent claim; verify merged state with the provider. Deduplicate by repository,
PR, and merge identity, and by completed cycle ID. If both events coincide,
one snapshot may cover both. Record successful reporting only after a snapshot
returns; retry failures against the same event, without resetting the objective
clock. Reporting is read-only and never becomes another controller.

## 6. Hand over PRs, not just progress

For each delivery, surface the actual PR URL, covered issue/spec references, concise change summary, acceptance/check evidence, outstanding decisions, and confirmed Shepherd owner/status. Distinguish **draft/in progress**, **blocked**, and **ready for human review** using the shared delivery contract and current provider state. The final ready handoff is reviewed, GREEN, and rebased/current with latest main or the explicit target, with checks tied to the current head and a freshly observed base. "PR created", mergeable, or yesterday's green result does not mean ready. Human final sign-off remains outstanding.

Every PR handed to the human must have a Roast covering its current candidate, whether produced by this run or supplied by a coworker. Reuse a still-applicable review; otherwise route to Roast without taking over the PR's delivery owner or silently authorizing edits. Review a draft's available candidate with its incomplete scope explicit. Missing review capability requires reporting the gap and seeking direction, not a clean-review or review-ready claim.

Bring human feedback to the same owner and PR. A review-ready PR does not end Joe-mode or stop discovery. After merging/closure, reconcile the backlog and dependencies before dispatching more work; do not manufacture follow-up work or close unrelated tracker items.

When no path can progress, explain what is awaited and remain active for the next event or user turn. Do not invent tickets to keep agents busy. When paused or stopped, stop new dispatch, coordinate an explicit pause/transfer for active owners, preserve their work and monitoring state, and report any owner still running. Never silently abandon a Shepherd or pretend it persists after runtime shutdown.

On re-anchoring, settle active ownership first. Do not silently expand the old scope or cancel its workers. On context pressure, use [phase-boundary guidance](PHASE-BOUNDARIES.md) and preserve the board, decisions, evidence pointers, pending questions, and monitor ownership. Resume by reconciling real state, not replaying stale instructions.

## Other requests inside Joe-mode

For commit-message drafting, apply the [shared commit-message policy](../setup/COMMIT-STYLE.md) directly. No separate formatter skill or Caveman chat mode is needed. Drafting grants no Git mutation authority; if the human separately requests synthesis, preserve that workflow's own input/altitude rules.

Select a permitted relevant skill rather than forcing every turn through delivery.
[Evolve Architecture](../evolve-architecture/SKILL.md) can propose an evidenced
improvement; Migration requires actual production migration obligations.
Synthesize requires supplied sources, output purpose, and altitude.
Agent-to-agent Handoff preserves current scope; cross-session or machine
transfer is human-directed. Do not automatically invoke human-only Automate-this,
Caveman session mode, ELI5, Retro, or Wait-what. They run only when the
human requests them. Setup's only automatic entry is the owned missing/incomplete
configuration bootstrap in step 2; it is not a general routing option.
Codebase-health findings can feed Discovery only within
the anchor; ask before expanding scope. Communication preferences grant no
additional work authority.

Read and use the current local skill for the route, not a remembered or upstream workflow. Prefer process guidance appropriate to the actual problem, but do not force Discovery for already-ready work or call every loosely related skill. Missing skills or capabilities are explicit blockers for their route, not permission to invent tools or silently remove required review.
