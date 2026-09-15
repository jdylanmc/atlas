# Acceptance scenarios

Local tests prove only the implemented helper and shipped package contracts.
These scenarios require a separately authorized compatible runtime and actual
observations; do not activate anything to make a library PR appear green.
Record each as observed, blocked or unverified with exact evidence.

| Scenario | Required observation |
| --- | --- |
| Install or individually select PM alongside prerequisites | Entrypoint/support copied, no setup output, schedule, workspace or activation |
| Human setup with complete custom configuration | Real contents/identity accepted unchanged; only unsettled activation questions asked |
| Missing setup / ambiguous provider / unavailable human | Existing Setup gates preserved, no reset, no schedule or delivery while blocked |
| Automated merges requested | V1 blocked or explicit human-mode renegotiation; no approval/merge operation |
| Known incompatible upstream fresh mapping, operator insists on fresh | Activation blocked **before** creation; no invented workspace/project parameters, heartbeat or hidden fallback |
| Same incompatible fresh host, heartbeat offered | Explain conversation/lifetime difference after capability inspection, recommend heartbeat, record explicit consent and bound actual PM identity before one owned job creation; refusal leaves inactive |
| Compatible runtime, configured-cadence fresh schedule | Readback of one matching job and existing binding plus safe workspace lifetime; initial observation and later fresh-run receipt distinguished |
| Human delegates runner mechanics | Explain and record dedicated-PM heartbeat recommendation and approved cadence; do not force an API-choice interview or silently reinterpret an explicit fresh-only request |
| Five-minute default or human-selected cadence | Stored job cron matches board config; repeated init/resume cannot change cadence; legacy one-minute board remains unchanged |
| Consented heartbeat with correct existing workspace | Actual job target is dedicated/reused PM agent, not bootstrap/reviewer; complete join to correct project/workspace/cwd; initial observation distinct from later deliveries |
| Multiple actual heartbeat deliveries | Same PM agent receives bounded passes, new fencing token each time, returns/idles between prompts; same delivery/Discovery agents; no new PM agents/workspaces, loops or nested wakeups |
| Wrong target / unknown mode / missing consent | Fail before dispatch; wrong-target creation, if any, is reconciled by the actual owner, not adopted as the PM or replaced blindly |
| Reinvoke after uncertain schedule-create response | Matching operation inspected/adopted, never duplicated; failed query not empty |
| Two ticks / another worktree / live session Joe | One reconciled logical owner and one claimed pass, no duplicate workers; explicit custody transfer from session Joe |
| Previous pass busy or crashed | Busy skip; no age takeover; explicit stopped-owner fencing and descendant/partial-work reconciliation for recovery |
| Sixth/seventh delivery; cancelled parent with live writer | Seventh blocked; pending launches and unreconciled descendants retain capacity; completion/review budget retained |
| Idle Discovery awaiting human across several ticks | Same conversation/lane per repository; second repository may have its own; noninteractive research continues |
| Unaligned recap / unpublished breakdown | No execution shortcut, preserve complete Discovery/Specify artifacts and actual publication approval |
| Approved breakdown publishes children across partial returns | Parent group reserved first; actual returned IDs added monotonically with receipts; all new delivery launches held until full graph/edges/grouping reconciled; retries reuse group, overlapping child reservations rejected, existing workers continue |
| Changed goal or backlog dependencies | One bounded Chart-a-course assignment for current goal/input revision; consume cited critical path and missing-work findings; no identical fresh agent every tick |
| New requirement arrives while deliveries run | Route to the one existing interactive Discovery lane, retain real human questions and full artifacts; independent eligible delivery continues |
| Worker is running but implementing the wrong thing | Compare accepted scope and actual artifacts with current goal/path; issue bounded correction to existing owner, verify receipt, preserve work; no competing writer |
| Completed callback was missed | Next pass accepts preserved result and advances the existing assignment once; no duplicate delivery or artificial activity |
| Worktree placement and shared read-only research | Same repository project; independent deliveries isolated; same-worktree agents share one workspace |
| Long tests, idle review, missing permission, true no-progress | Correct classification by live evidence, not age; permission wait and failure do not spawn replacement storms |
| Repeated recovery notification / target moves | One episode/issue/repair under RECOVERY, actual intake and return acknowledgment; same PR, no second controller |
| Human pause races already-dispatched pass | Local gate first; fresh schedule paused via supported interface or heartbeat deleted by bound owner and absence verified; queued prompts return without dispatch, already-issued effects reconciled |
| Heartbeat human resume after pause/stop | Old owned ID completely absent, prior pass released/fenced, new observed ID targets same PM with unchanged scope/settings/lifetime; exact old-ID/human/reconciliation evidence accepted, workers/config/pending outcomes preserved, old token rejected |
| Heartbeat uncertain deletion or creation / unavailable readback | Remains gated; reconcile complete owned-job observation before retry; no false absence, competing job, repeated create, fabricated pause API or tick resume |
| Fresh schedule resume / stop | Human-only same-ID supported resume; deletion does not use heartbeat replacement exception; stop verifies only owned job absence and preserves work/monitor responsibilities |
| Terminal worker return | Complete result actually accepted, current descendants/duties settled, supported agent archival verified; resources preserved |
| Fresh PM parent with live children or pending self-report | Explicit retention or proven supported acknowledged transfer; no fake detach, orphan assumptions or workspace archive |
| Terminal fresh PM parents with no remaining duties | Next owner actually accepts receipts and archives; no indefinite run-agent accumulation |
| Heartbeat PM at pass end or human pause | Lease released but agent not terminal; retains own wakeup or human-resume duty, children and reporting; no automatic archival |
| Heartbeat PM after explicit stop/end | Owned wakeup absence verified, child/results accepted or handed off and all duties ended before supported agent archival; never archive a shared workspace |
| Host down / denied external reads | Honest observation gap, human-visible narrow permission request, no claimed continued monitoring |
| Dedicated PM errored or terminated | No claim that its heartbeat heals the controller; human-visible observation gap and explicit fenced takeover with preserved workers/results |

Also execute the shared [lifecycle scenarios](../squadron/LIFECYCLE-SCENARIOS.md)
and [observation/recovery scenarios](../shepherd/SCENARIOS.md) for affected
integration contracts. Setup proof and recurring-delivery proof remain separate.
