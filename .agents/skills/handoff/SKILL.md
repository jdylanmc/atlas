---
name: handoff
description: "Human direction for cross-session or machine transfer; scoped agent-to-agent handoffs allowed. Transfer accessible evidence, permissions, doctrine, and explicit ownership without duplicating controllers."
argument-hint: "What will the next session be used for?"
disable-model-invocation: false
user-invocable: true
---

# Handoff

## Atlas integration

Use the private session artifact directory for portable handoff documents unless
the caller approved another private destination. Never write handoff state into
the repository. Atlas's active harness delegation limits and ownership rules
remain authoritative over this imported workflow.

**Entry:** human direction for cross-session/machine transfers, or scoped
agent-to-agent work under the [invocation contract](../setup/INVOCATION.md).
Confirm destination/access and what is actually being transferred. A request
for a portable document does not authorize starting another Joe-mode.

Follow [doctrine selection and application](../doctrine/APPLY.md); `context` is a candidate when none was preselected. Preserve the task/delivery's doctrine packet in the handoff: operator choices, required and assigned IDs, reasons, accessible source locations, pinned digests, and any missing/load/application status. Do not copy every doctrine body; the receiving agent retrieves verified text before applying it.

For portable transfer, write a uniquely named handoff document in the session
workspace or OS-temporary directory, not the repository; report its lifetime.
For a live worker, send the bounded packet through the actual supported agent
interface instead of requiring a redundant document.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Respect each suggested skill's caller contract. Carry objective and original
start evidence, permissions and pending human decisions, parent/controller IDs,
delivery route and PR/worktree owner, dependencies, current evidence, and stop/
return conditions. Source paths must be accessible at the destination; summaries
do not replace unavailable originals. Keep status-report event identities when
transferring a controller so resumption does not duplicate reports.

Load/execute [LIFECYCLE](../squadron/LIFECYCLE.md) for observed acceptance,
cancellation recovery, retirement; use [WORKSPACE](../ship/WORKSPACE.md) for placement.
Keep the existing packet, no new ledger. Sender retains custody until receiver
inspects actual artifacts/worktree/PR and acknowledges scope, state, duties.
Sending/self-authored ownership proves none; no two branch writers, PR monitors,
or repository Joe controllers.
For Shepherd, load/carry [OBSERVATION](../shepherd/OBSERVATION.md):
per-PR snapshot/streak, exact wakeup/binding, desired/observed cadence, gaps.
For issue-backed continuation, load [RECOVERY](../shepherd/RECOVERY.md): carry
episode/issue, kickoff grant, controller/human path, pending operation,
write release/receiver acknowledgment. Links/scheduled wakes neither prove
accepted intake nor permit another controller.

After acknowledgment, retire terminal owned senders/workers with evidence
preserved and duties completed/transferred under LIFECYCLE. Parent retires the
sender/worker when self-retirement would interrupt safe reporting. If transfer
or archival cannot complete: report blocker/retained responsibility, never delete workspaces,
worktrees, or branches to retire agents.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

Consult [Changelog](../changelog/SKILL.md) for any authorized persistent change;
an ordinary temporary handoff is not a notable product change and creates no
changelog edit.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
