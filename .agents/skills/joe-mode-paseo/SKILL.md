---
name: joe-mode-paseo
description: "Human-enabled engineering-team PM for one repository. Set up recurring Paseo coordination; chart the backlog, intake requirements, check worker progress and scope, and dispatch planning and delivery through Joe-mode."
disable-model-invocation: false
user-invocable: true
---

# Joe-mode Paseo

## Atlas integration

Read `AGENTS.md` and `docs/agents/*.md` before activation. Reuse Atlas's GitHub
planning configuration; `/spec` and `/tickets` remain its canonical planning
routes. Preserve the repository's deterministic SDK and adversarial-corpus gates.

Dragon Council is an eligible independent review option when selected by the
authorized delivery driver and supported by the active harness. Follow
`docs/agents/review-cycle.md`: use the existing panel, preserve its configured
models and limits, and do not stack a standalone Roast over the same review.
Reviewers remain read-only; the separate authorized driver owns remediation.
Installing this adapter neither starts a council nor activates recurring work.

Keep the engineering team moving toward the human's goal, not merely a chat
alive. Paseo provides recurring execution and worker lifecycle; Joe-mode provides
prioritization and routing through the existing skills. On each bounded pass,
assess whether agents are progressing **and working on the right thing**, consume
results, unblock authorized work and dispatch the next useful assignments.

**Entry:** Human activation and management only. A matching, previously
human-authorized wakeup job may load only [RUN](RUN.md), not repeat this intake.
Model-loadable metadata permits that bounded continuation, not autonomous
activation. Follow [INVOCATION](../setup/INVOCATION.md) and the human-approved
[intent](intent.md). Installing/discovering the package does not start anything.
Requires the sibling workflow packages; see [runtime gates](RUNTIME.md).

This adapter extends the existing Joe owner board across bounded passes. It does not
activate nested/session Joe-mode, replace delivery owners, or approve/merge PRs.
**V1 supports human approval and merges only.** Block requested automated merge
mode unless the operator explicitly chooses human mode instead. Do not enable
auto-merge, change protected intent or treat future CI ambitions as authorization.

## 1. Resolve and reconcile before setup

Read the chosen repository's instructions and actual Git remotes/common directory,
worktree, branch and planning configuration. Normalize provider-qualified repository
identity; account for separate planning projects, aliases, other clones and hosts.
Display names and common-directory paths alone cannot prove global uniqueness.
Use [WORKSPACE](../ship/WORKSPACE.md): one repository project, one registered
workspace per Git worktree, shared by all agents on that worktree.

Inspect existing controller/Setup ownership, current PM configuration, matching
wakeup job and active/pending runs. Reuse the one compatible board, project and
workspace. If a session Joe owns the repository, join it or obtain its explicit
release and acknowledged transfer into this adapter before enabling. Preserve
the anchor, objective clock, coverage, planning artifacts and pending recovery
episodes. An unresolved other host/clone/owner blocks activation; local locks
cannot fence an independent remote controller.

Run [Setup's completeness check](../setup/SKILL.md#joe-mode-bootstrap-readiness).
Complete content is reused; missing/incomplete content goes through existing
[Setup](../setup/SKILL.md) as this **human-directed** setup subflow. Join active
Setup instead of duplicating it. Resolve real tracker target, authenticated
identity, readiness role, layout and referenced instructions; existence of files
or a setup marker is insufficient. Unsupported choices and access failures are
not reset triggers. Preserve all provider/label choices and exact-file approval
gates. Scheduled RUN never bootstraps or writes configuration.

## 2. Ask a few activation questions

Reuse already settled answers; ask only material missing choices:

1. Which backlog selection (labels, epic, query, assigned identity, or explicit
   tickets), scope and non-goals? Which approved dependency/PR grouping?
2. Confirm **human approval/merge** in V1. Which routine delivery, tracker,
   scheduler and bounded recovery actions are authorized, and where do questions
   return to the actual human?
3. Delivery capacity: **six by default**, or what limit? Reserve resources for
   the single interactive Discovery lane, research, review and finishing work.
4. Which cadence (**five minutes by default**), host/repository worktree, accessible private evidence location and
   existing runtime profiles? What is the explicit child disposition at
   pause/stop, and who accepts results and retires terminal run parents?

Recommend the documented dedicated-PM heartbeat recipe after inspecting host
availability and capabilities below. Runner mechanics are an implementation
choice when the human delegates them; record that delegation and the explained
selection rather than repeatedly asking them to choose APIs. An explicit fresh
runner requirement still wins and cannot silently fall back.
Capacity is delivery-owner lanes, not permission for
unlimited nested workers: each route packet gets a bounded nested resource budget.
Do not hardcode users, repositories, labels, providers or models.

## 3. Establish durable continuity and capabilities

Load [Doctrine](../doctrine/SKILL.md) using [APPLY](../doctrine/APPLY.md);
PR-producing routes require `worktrees`, code review requires `solid`.
Execute [LIFECYCLE](../squadron/LIFECYCLE.md), [DELIVERY](../ship/DELIVERY.md),
[OBSERVATION](../shepherd/OBSERVATION.md) and [RECOVERY](../shepherd/RECOVERY.md)
for their respective responsibilities, not duplicate checklists/approval ledgers.

Choose one owner-controlled, ignored, durable JSON board accessible to every
run and the human. Reuse/migrate the existing Joe board with acknowledged custody;
the helper adds only its `pm` namespace and preserves other top-level fields.
Do not put runtime IDs, permission details or private evidence in committed
configuration. Human-approved declarative choices may reference the private
board without exposing its contents. Verify ignore/access, persistence readback
and cross-worktree discovery of this **same path**, never a new board per tick.
The registry locator belongs in the existing owner/handoff record.

Prepare the exact activation config; after all following capability gates pass,
follow [STATE](STATE.md) to call the bundled helper with `init`. It validates
required evidence references, defaults
capacity to six and initializes **paused**; repeated matching init is a no-op,
changed identity/config is a blocker. The helper cannot grant authority or
validate the truth of runtime evidence. Do not use fixture values as evidence.

Inspect current profiles/notes and provider/tool capabilities through Paseo.
Verify narrow recurring access for backlog/PR/agent/permission/worktree reads,
owned dispatch/return/archive, local board access and mode-specific owned wakeup management.
Record the actual grant, lifetime/until-stopped boundary and human-origin anchor.
Never automatically select allow-all, `auto_accept`, approve prompts or edit
global configuration. Permission failures wait for the missing human approval.
Pass the shared and selected-mode [RUNTIME gates](RUNTIME.md) before job creation.
Once capabilities are known, establish the consented runner:

- **Same-agent heartbeat:** one dedicated or reused PM agent in the correct
  existing workspace receives the configured cron prompts (`*/5 * * * *` by
  default). It returns/idles between bounded passes, retaining team custody,
  pending decisions and wakeup duty. **Recommend this for ongoing team
  coordination**, following [Paseo's recipe](RUNTIME.md#recommended-orchestration-recipe).
  Use a dedicated PM, not this disposable setup conversation.
- **Fresh schedule:** each pass starts a new PM conversation. Available only
  when the deployed runtime proves stable existing-workspace mapping and safe
  workspace lifetime. If the operator insists on fresh mode on an incompatible
  host, fail **before activation**; do not substitute a heartbeat.

Record the selected `wakeupMode`, approved `cron` and `wakeupConsent` decision
reference (including an actual delegation of runner choice),
with the explained conversation/lifetime difference. Previous interest in
fresh mode or “keep going” is not consent to change it. No automatic fallback,
activation or broader permissions. Unavailable required evidence remains a block.

## 4. Create or adopt exactly one owned wakeup

Only after the gates pass and the human authorizes activation: inspect the
matching job by saved ID and full kind/target/prompt/config identity. No match
requires complete observations, not failed queries. Multiple/ambiguous matches
wait for reconciliation. Record the create/adopt intent on the paused board's
existing human setup record **before** the external operation.

**Heartbeat:** first resolve the actual dedicated/reused PM agent and inspect its
identity, human-origin packet and correct existing `workspaceId`, project, cwd
and Git mapping. Reuse a compatible owned agent; if human-authorized setup must
create one, use that existing workspace, not another resource/controller. Record
its actual ID as `pmAgentId` before paused initialization. Convey the original
human decision, board and narrow authority; a bootstrap or reviewer is not the
PM merely because it can call a tool. The **bound PM agent itself**, within this
human setup subflow (not RUN), calls agent-scoped `create_heartbeat`. Its schema
has no target-agent/workspace creation arguments: invoking it from a disposable
setup agent binds the wrong target. Never fake `PASEO_AGENT_ID`, detach, or create
a competing controller to work around that. Use the saved `config.cron`, the approved
timezone/lifetime and bounded RUN prompt. Verify the stored target is this actual
agent, not just the response's job ID. RUN never creates/resumes any wakeup job.

**Fresh:** use the current supported `create_schedule` schema, the saved `config.cron`, explicit
verified `cwd`, local isolation and discovered runtime settings. Prompt it with
the installed absolute RUN path, same private board locator, activation identity,
root human decision path and bounded authority. No undocumented project/workspace
parameters, no unapproved mode substitution, no per-minute worktree creation. Preserve
the approved timezone, lifetime and settings. After uncertain creation, inspect
by the recorded identity before retry; do not create another job.

For either mode, reconcile uncertain create responses by complete owned-job
inspection before any retry. Read back the actual stored job, kind/target,
enabled state, prompt, cron, binding, next
wakeup and configured runtime. Perform an actual initial scoped observation of
backlog/PRs and ownership; record the evidence separately from creation response.
Then call `resume` with that human decision and verified binding. An early tick
sees paused state and must return without dispatch. Verify later recurring
receipts: same bound PM agent for heartbeat, safe actual placement for fresh.
Distinguish **configured / initial observation
verified / recurring operation verified**. Gaps or permission waits are not
working unattended monitoring. Use [SCENARIOS](SCENARIOS.md) for acceptance.

## Inspect, pause, resume, stop

- **Inspect/status:** read the helper and actual owned job/logs, current
  controller, workers, pending permissions and latest observations. No mutation,
  activation or stale cached readiness claim. Report gaps and pending results.
- **Pause:** on human direction call helper `pause` first, recording explicit
  active-child disposition. For fresh mode, use supported `pause_schedule` and
  inspect actual paused state/next-run behavior. For heartbeat, have the bound PM
  agent call `delete_heartbeat` for its exact owned ID and verify absence through
  complete supported inspection. There is no `pause_heartbeat` or heartbeat
  resume MCP operation. Reconcile an already dispatched prompt/run;
  it must not start new work. Existing scoped workers remain owned, not killed.
  Record operation outcomes in the human management record, including failure.
- **Resume:** human only, never a tick/recovery wake. Reconcile ownership,
  children, partial work, mapping, access and job first; observe now. Fresh mode
  uses supported `resume_schedule` on the same verified ID; a deleted fresh job
  requires separately reconciled setup, never the heartbeat replacement path.
  Heartbeat mode requires complete proof the old owned job is absent and the old
  pass lease released or explicitly fenced. Preserve the same PM agent, scope,
  config, prompt, timezone/lifetime/settings, workers and pending results; record
  human recreation intent before that agent calls `create_heartbeat` once.
  Reconcile an uncertain creation before retrying. Read back the new job and call
  helper `resume` with [STATE's exact replacement evidence](STATE.md), including
  old ID and human proof. No board reset, automatic tick resume or target change.
- **Stop:** call `stop` first, then delete the exact owned wakeup and verify
  absence through complete inspection. Stop is not blanket cancellation: obey
  the chosen retain/finish/acknowledged-transfer disposition for each child,
  resolve pending results, and record continuing Shepherd duties or explicit
  monitoring gaps. Preserve artifacts and workspaces. Failed or uncertain deletion
  remains a reported blocker; the stopped board still rejects new claims.
  The heartbeat PM stays alive while deletion, children or reporting remain
  unresolved. Retire it only after verified owned-wakeup absence and accepted
  end/transfer of all duties; pausing alone is not terminal.

Heartbeat control uses MCP **create/delete only**. A CLI period-only update is
not a pause/resume API. Keep the approved cadence on recreation; a cadence change
requires human-authorized paused/fenced reconfiguration, not a tick adjustment. If
supported complete observation/deletion is unavailable, keep the local gate
closed, report uncertainty and do not recreate or claim successful pause/stop.
No wakeup operation automatically cleans Git/UI resources. No automatic
resumption after a human pause. Every modifying owner consults
[Changelog](../changelog/SKILL.md) within its assigned write scope.
