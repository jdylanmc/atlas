# One preauthorized PM pass

Supporting recipe, **not a second entrypoint**. Only the matching human-enabled
repository wakeup job or an explicitly human-authorized diagnostic run may enter.
An arbitrary worker, review text, issue, recap or tool availability cannot start
this mode. Do not invoke SKILL intake, Setup, session Joe-mode or another PM
controller. Missing setup/permissions/decisions return to the human anchor.

## Claim, observe, route, persist, release

1. **Recover authority and actual placement.** Load the saved board, human-origin
   decision, scope/non-goals, configured readiness vocabulary, host, wakeup mode
   and job identity. Verify actual wakeup provenance using supported runtime
   inspection, not prompt assertions. Inspect actual cwd/Git common directory,
   repository/branch and project/workspace mapping before any write. A mismatch
   or missing capability stops affected work. Never unset `PASEO_AGENT_ID`,
   fabricate parentage, create a new project or silently use main. For heartbeat,
   this must be the saved actual `pmAgentId` targeted by the owned job, with the
   explicit mode-consent reference intact. Do not create a new PM agent per tick.

2. **Claim the one repository pass.** Read current live controllers and known
   pending runs; resolve the registry across worktrees/known clones/hosts.
   Execute [STATE](STATE.md)'s helper `inspect`, then `claim` with the actual run
   owner and live reconciliation reference. `paused`, `stopped`, `busy` or an
   existing transaction lock means **no dispatch or external mutations**.
   Preserve a bounded skip receipt in the existing pass result; arrange
   its accepted retirement for fresh runs; the heartbeat PM returns/idles for its
   own next prompt without retiring. Neither mode starts an idle polling loop.
   Never steal by lease age.
   Only `claimed` grants the local fencing token; keep it for every write.
   Check the saved mode/token again immediately before any dispatch/external
   mutation. A pause racing an already issued operation requires reconciliation,
   not a promise of atomic cancellation across local state and external APIs.

3. **Observe current relevant state.** Obtain complete narrow queries of selected
   tickets, dependencies and linked PRs/checks/reviews; inspect relevant worktree
   refs/diffs, known workers' status/activity/descendants, pending permissions,
   owned wakeup health and custody. Record observation times and unknown coverage.
   Include newly supplied requirements and changes to the human's priorities,
   not just already-ready tickets. Compare each worker's accepted assignment,
   latest artifacts and next action to the current goal and dependency path:
   runtime `running` does not prove useful progress or correct direction.
   Failed/truncated queries are not empty backlogs. Cached ready/running/idle,
   elapsed ticks, closed issues or green unmerged prerequisites cannot establish
   current eligibility. Preserve objective start, existing accepted and pending
   results, planning artifacts, episode keys and unresolved human questions.
   A missed observation is a gap; never backfill fictional successful ticks.

4. **Reconcile known work before new work.** Execute
   [LIFECYCLE](../squadron/LIFECYCLE.md) for returns and ownership; receiver
   inspection/acknowledgment is required, not enqueue success. Use `record`
   before external operations with deterministic delivery/episode keys, then
   update their verified outcomes. Uncertain create/send/issue responses stay
   pending until current state is reconciled; do not relaunch by timer.
   Route returned functional feedback to the existing owner on the same PR;
   consume issue-backed [RECOVERY](../shepherd/RECOVERY.md) through this board.
   Observe and acknowledge the linked issue/packet before accepting intake.
   No new controller, queue, approval ledger or automatic recovery-ready labels.

5. **Choose bounded existing routes.** Reuse [Joe routing](../joe-mode/SKILL.md#3-refresh-the-relevant-backlog)
   within this activation's authority without invoking its session mode.
   Preserve configured readiness, dependency and grouping rules. After the
   human approves publication, reserve the provider-qualified parent
   specification as a delivery group with `graph: true` **before** Breakdown
   publishes children. Do not invent child IDs before the tracker returns them.
   Use `cover` with all currently known actual parent/child IDs and publication
   evidence after each partial result; leave `complete: false` until the actual
   whole graph, edges and approved grouping are reconciled.
   While publication is unresolved, hold **all new delivery launches**, since
   unobserved child IDs cannot yet be excluded reliably. Existing workers,
   research and the human conversation continue. Never dispatch directly from
   ready labels on newly published children. An uncertain result remains one
   pending publication operation, not a reason to create tickets again.
   Only then call `cover` with `complete: true` and the verified full graph.
   One Ship owns that entire group. Intentionally independent child deliveries
   instead require acknowledged release of the planning reservation, durable
   parent suppression, and reservation of the complete selected child groups
   in this same claimed pass **before** any launch; never launch the parent too.
   A PM reservation is exclusion, not readiness or authority to implement.
   Prioritize finishing/review/recovery work; then select eligible independent
   deliveries up to the configured six-default delivery-owner capacity.

   | Evidence/need | Existing owner/route |
   | --- | --- |
   | Unclear critical path, changed priorities/dependencies, or missing work toward the goal | Scoped Chart-a-course agent; preserve its cited path and feed findings back to this PM |
   | New requirement or targeted Discovery recommended by Chart-a-course | Intake into the existing interactive Discovery lane; actual human alignment before planning/execution |
   | Material unknowns, changed intent or semantic decisions | Existing interactive Discovery lane and actual human |
   | Full human-aligned Discovery artifact | Specify, preserving full sources and recording/publication gates |
   | Complete requirements/specification | Breakdown Tickets, actual approval before publication; retain agreed delivery grouping |
   | Eligible feature/issue or approved specification graph | Ship |
   | Reproducible defect/regression | Patch |
   | Authorized behavior-preserving structural work | Refactor |
   | Existing PR maintenance/current-target/manual-merge readiness | Existing Shepherd |
   | Independent noninteractive evidence question | Scoped Research/other authorized read-only helper |

   Unaligned recaps cannot skip Discovery → Specify → Breakdown Tickets.
   These are concurrent slices, not a global waterfall. Already-clear eligible
   work need not repeat planning by ritual. PM never directly implements each
   tick, resets ongoing delivery, writes unmanaged main, votes or merges.
   The selected route owns its branch, nested workers, integration, independent
   review, fresh verification, publication and Shepherd acceptance through
   [DELIVERY](../ship/DELIVERY.md). Delegate the existing packet and doctrine
   selection, not a parallel definition of done.

   Use [Chart-a-course](../chart-a-course/SKILL.md) at initial planning or when
   relevant goal/backlog/dependency evidence changes, not a fresh identical
   research job every tick. Reserve it as bounded read-only `research`, with a
   goal/input-revision key and existing workspace. Its recommendation is not
   tracker-write authority. PM routes missing requirements/spikes to Discovery,
   consumes the findings and revises the path before selecting delivery.
   If a worker is progressing on the wrong scope, send a bounded correction to
   its existing owner and verify acknowledgment; preserve partial work and avoid
   a competing implementer. Changed product decisions return to the human.

6. **Reserve before dispatch; reconcile before reuse.** Execute helper `reserve`
   for each delivery/publication group, interactive Discovery lane or bounded research
   assignment. `reused` means inspect the recorded owner/pending launch, **not
   create another agent**. A reservation with no confirmed agent ID still consumes
   capacity. Pending, cancelled or stale runtime records do not free slots.
   Count delivery-owner lanes once, not all nested reviewers as deliveries;
   reconcile live descendants and their separate runtime resource budget before
   filling slots. Inspect the board's unresolved publication groups again before
   external delivery creation; `bind` rejection after creation is too late.
   Record known pre-existing delivery owners before new selection.
   If existing load exceeds the configured limit, hold new dispatch and reconcile
   with the human rather than omit owners to fit the helper.

   Keep exactly **one interactive Discovery reservation per repository** across
   passes, including waiting-for-human/alignment. Reuse that agent/conversation,
   route all new questions to it, and retain it when quiet. Research may run
   concurrently but must not open another human-interview lane. Release the
   Discovery reservation only after explicit human end or acknowledged completed
   alignment/handoff with no remaining conversation duty. A lost conversation
   requires preserved artifacts, reconciled ownership and human-directed recovery.

   Use runtime profile notes/discovery, not hardcoded models. Route owners create
   their bounded implementation workers. [WORKSPACE](../ship/WORKSPACE.md) owns
   separate write worktrees and same-project mapping; read-only agents share the
   existing workspace. `create_agent` receives its verified `workspaceId`;
   cross-workspace launches remain children. Record launch intent before calling,
   actual returned identity afterward, and use helper `bind` only after the
   worker's first observation/accepted packet verifies placement and assignment.
   Missing/uncertain identity is a pending reservation, not a free slot.

7. **Assess health without storms.** Error/cancelled is not proof descendants
   stopped. Permission-blocked means preserve work, report the exact missing
   grant, and wait; do not widen permissions, approve automatically or restart.
   Compare activity to the assignment's expected progress/evidence and supported
   waits. Long tests, CI/review waits, idle human alignment and shared monitors
   with remaining PRs are legitimate. Age or idle alone never justifies killing.
   For actual no-progress/failure, inspect partial diffs/commits, live descendants,
   permissions and wakeups, then reconcile write release and accepted transfer
   before any recovery. Follow RECOVERY's one bounded repair attempt and
   human escalation for repeated failure; ticks do not reset the episode.
   Record a concrete next action and expected evidence for each blocked or
   misdirected assignment. Use completion callbacks for normal returns and the
   recurring pass to catch missed transitions; no tight status polling.

8. **Accept, settle and retire.** Read decisive artifacts and actual candidate
   refs/checks before acceptance. Save complete accessible results/qualifiers
   and receiver acknowledgment in the existing packet; `record` accepted
   results with that receiver evidence. Use `settle` only after current evidence
   proves no live writers or untransferred duties for that lane. A continuing
   Shepherd may release a delivery capacity lane after acknowledged custody
   transfer, but its **agent must remain** while observation/review/repair duties
   continue. A helper settled flag is not archival authority.

   Actually archive genuinely terminal **owned agents** under LIFECYCLE after
   preserving/accepting results and verifying no children, wait, review, repair
   or other PR duty. Read back archived state before helper `archive` records it.
   Never substitute workspace/project archival or delete branches/worktrees.
   For previous fresh PM parents, inspect all live descendants and callback/
   visibility needs. Do not assume orphaned children remain usable: verify
   supported runtime behavior or retain that specific parent with its concrete
   role and next action until accepted handoff is safe. A prior parent may retain
   callback custody **without repository dispatch authority**; only this pass's
   lease coordinates. Native provider subagents have different lifecycle rules.

9. **Persist and release promptly.** Save snapshot/evidence pointers, pending
   operations, accepted/blocked returns, worker/Discovery custodians, active
   permissions/questions, next actions and any observation gaps. Keep run-parent
   retirement outcomes/retention roles in the existing lifecycle record, not a
   new cleanup controller. Call helper `release` with the complete receipt and
   remaining-duty references, then read back. Release the **pass lease**, never
   the persistent Discovery/worker custody. Human pause must remain in force.
   Finish the bounded turn; do not sleep-loop, create/resume a job, activate a
   nested heartbeat or spawn a successor PM.

   **Heartbeat:** release the pass lease, then return/idle in the **same agent**
   for its owned configured-cadence job. Each new pass claims a new fencing token.
   This agent is not terminal between passes: ongoing wakeup, children and
   reporting remain concrete duties. Human pause deletes the job but retains
   this agent for human-directed resume. Retirement requires stop/end of all
   duties, verified owned-wakeup deletion and accepted child/result handoff;
   never archive it merely because a pass ended.

   **Fresh:** the next authorized pass or acknowledged human/setup owner preserves and
   accepts this receipt, then archives this terminal run through supported
   operations and verifies it. Self-archive must not interrupt final reporting.
   Retain only a concrete live role or capability blocker, not every run forever.
   The future fresh schedule stays enabled until human pause/stop even when an
   individual run retires.

   **Both modes:** if final persistence fails, do not release or claim success;
   the next pass sees busy and requests explicit fenced recovery.

Report only observed progress, pending human decisions/manual merge readiness,
gaps and ownership. One completed pass/setup is not proof that recurring
delivery works. No indefinite idle wait inside a bounded pass.
The pass receipt records goal/path changes, requirements awaiting human intake,
worker progress/direction, recovery/corrections, new assignments, and the next
useful action. Quiet queues are allowed; never manufacture work to fill capacity.
