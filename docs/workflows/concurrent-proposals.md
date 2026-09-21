---
workflow: concurrent-proposals
atlas-sdk-schema: 1.0.0
---

# Rebase concurrent Atlas Proposals

Atlas Proposals use ordinary Git concurrency. When two Proposals start from the
same Atlas Head, the first merged Proposal establishes the new Head. Every
remaining Proposal is stale until it is rebased onto that Head, fully Linted,
and reviewed again at the rebased commit.

## Procedure

1. Prepare each Proposal through its normal Atlas SDK workflow. Keep each
   returned proposal branch and Operation Workspace intact for review.
2. Merge the first approved Proposal through the Atlas Host Directory's normal
   Git governance.
3. Update the target branch locally, then rebase the remaining Proposal from
   its Operation Workspace:

   ```sh
   git -C <proposal-workspace> rebase <target-branch>
   ```

4. Resolve conflicts as ordinary Git conflicts. Preserve both accepted
   knowledge changes. For `.atlas/CHANGELOG.md`, retain each operation's
   complete stamped entry and stable operation ID; do not replace either entry
   with a synthesized summary.
5. Stage each resolution and continue the rebase:

   ```sh
   git -C <proposal-workspace> add <resolved-paths>
   git -C <proposal-workspace> rebase --continue
   ```

6. Record the rebased commit, then run full Atlas Lint against that exact
   Operation Workspace:

   ```sh
   git -C <proposal-workspace> rev-parse HEAD
   atlas lint --machine --atlas-host-directory <proposal-workspace>
   ```

   A Lint result from before the rebase does not validate the rebased Proposal.

7. Re-run the repository's required checks and human review for the rebased
   commit. If the proposal branch was already published, update that same branch
   with an explicit observed-SHA lease rather than an unguarded force push.
8. Merge only after the target has not advanced again and the current rebased
   commit has the required validation and approval.

Rebase does not decide semantic conflicts, renew approval, or reconstruct
knowledge. Escalate unresolved product or governance choices to the Maintainer.
No Atlas-specific scheduler or publication helper is required.
