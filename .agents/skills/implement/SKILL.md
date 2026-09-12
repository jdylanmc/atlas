---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Read `AGENTS.md` and `docs/agents/issue-tracker.md` before acting. Confirm the
assigned worktree, approved scope, native issue blockers, and validation ownership.
Do not implement new features just because a ticket is labeled ready.

Capture `git rev-parse HEAD` before editing as the review base. Preserve unrelated
local changes and identify any relevant pre-existing changes in the review scope.

Use /tdd at pre-agreed seams, with TypeScript and the existing Node test runner. Run the
smallest relevant canonical checks during iteration and the full verification
gate required by the task before reporting completion. Honor authoring-only
phases; documentation-only work needs only applicable documentation checks.
Keep the SDK deterministic and model-free. A durable review finding requires
an accept or reject case in `tests/adversarial/`; prefer data-only additions
when an existing gate covers the behavior.

Once done, use /caveman-review in working-tree mode against the captured base,
including new files. Fix in-scope findings and repeat affected checks. A
committed-only diff cannot review work that has not been committed yet.

Use the project /caveman-commit to draft the message for an authorized commit.
It does not stage files or run git. Stage only this task's files and commit only
when authorized. A request to
implement does not itself authorize pushing, merging, releasing or closing
issues. Report any pending gate rather than treating a commit as completion.
