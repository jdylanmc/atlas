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

The sender retains custody until the receiver acknowledges the assignment and
actual workspace/PR state. Do not imply that writing or sending the packet
transferred ownership, stopped a monitor, or scheduled work. Never leave two
writers on one branch or two Joe controllers for one repository.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

Consult [Changelog](../changelog/SKILL.md) for any authorized persistent change;
an ordinary temporary handoff is not a notable product change and creates no
changelog edit.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
