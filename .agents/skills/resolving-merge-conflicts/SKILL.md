---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. If they are
   incompatible or the merge's goal is unclear, stop and ask rather than
   choosing a product decision or inventing behavior. Do not abort, reset or
   discard work without explicit approval.

4. Discover the project's **automated checks** and run them, typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish only the authorized operation.** Stage only resolved files owned
   by this task, preserving unrelated changes. Continue a merge/rebase or
   commit only when authorized; otherwise report the prepared state. Never
   infer PR merge, force-push or release permission from passing checks.
   If a new commit message is needed, use the project `caveman-commit` for its
   text only; preserve existing messages when continuing a rebase unless a
   message change is explicitly requested.
