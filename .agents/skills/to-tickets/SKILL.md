---
name: to-tickets
description: Compatibility alias for Atlas's /tickets workflow. Prepare approved tracer-bullet implementation tickets and native GitHub blocking edges.
disable-model-invocation: true
---

# To Tickets

Invoke the project `tickets` skill with the same conversation and arguments.
Its canonical instructions are [../tickets/SKILL.md](../tickets/SKILL.md). If
the harness cannot resolve that project skill, read and follow that file
directly; do not substitute a similarly named global skill.

Do not publish until the user explicitly approves the breakdown. All repository
checks, label ownership, duplicate guards, and native relationship verification
belong to `tickets`; this alias does not create a separate planning process.
