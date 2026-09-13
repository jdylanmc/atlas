---
name: shepherd
description: "Human or scoped delivery-agent use. Maintain one existing PR with independent review, green checks, and rebase on target-base advancement; invoke conflict resolution internally and leave final sign-off/merge human-owned."
disable-model-invocation: false
user-invocable: true
---

# Shepherd

Own one published pull request (PR), not a one-time green snapshot. Follow the common [invocation policy](../setup/INVOCATION.md) for human invocation or machine handoff. A human may invoke `/shepherd` on a conflicted PR; the resolver is an internal helper, not the human entry point. Observe, rebase whenever the target advances, and return functional work to the existing Ship, Patch, or Refactor route owner. Never merge, approve, enable auto-merge, accept product risk, or delete the delivery branch. See the human-authored [intent](intent.md).

Preserve the delivery's [doctrine selection](../doctrine/APPLY.md) through maintenance and repair handoffs. **Require `worktrees` before preparing PR changes** and use the [workspace procedure](../ship/WORKSPACE.md) to reuse the owned delivery workspace. Invocation/handoff grants bounded maintenance within established ownership; an explicit observation-only request does not. Load the standards you apply; pass metadata and pinned digests to the route owner rather than requiring the monitor to read every worker doctrine.

## Take ownership

Read repository guidance and resolve the PR, provider, delivery branch/worktree, requirements, and declared validation. Reuse the [delivery packet](../ship/DELIVERY.md#one-delivery-packet-one-owner), including owner route, return owner, source/target refs and doctrine digests. A missing old handoff is not a reason to refuse a PR that can be inspected now. Recover the route from original scope and live evidence; ask Joe-mode/the human when unclear rather than defaulting to Ship. Reconstruct target from the actual PR (usually main, or its explicit target), not a guessed default branch.

Ensure no other agent is actively implementing or maintaining this same delivery branch. If its route is still building, wait for its transfer rather than competing with it. If another live Shepherd owns it, confirm and return that owner's status instead of starting a duplicate loop. A stale progress file is not proof of a live owner; uncertain worker status needs resolution before starting competing work.

Use the harness's session storage for a small progress file, or an approved repository-local ignored session location when unavailable. Do not commit it or silently change ignore rules. Report its absolute path. Record the PR URL, route/return owner, maintenance owner, worktree, creation time, last observation, observed base/head, validation/review coverage and invalidations, pending human signoff, handled findings, active repair, and next observation time. Keep credentials and private log bodies out of it.

Read back updates to this record. If persistence fails, report the error; do not claim resumability. On a resumed run, inspect live state first, record the observation gap, and check whether a previously dispatched repair is still running before redispatching. If the old record is unavailable, reconstruct from the PR and report the reduced history.

## Observe the PR

Use the provider's available read operations to inspect:

- Open, merged, or closed state; draft status; current base/head; mergeability and repository branch policy.
- Required checks, including pending, failed, cancelled, and unavailable results.
- Review decisions, general comments, and inline review feedback.

For GitHub, resolve `REPO` as `owner/repo` and `PR` as its number, then use:

```sh
gh pr view "$PR" --repo "$REPO" --json url,state,isDraft,createdAt,headRefName,baseRefName,headRefOid,baseRefOid,mergeable,mergeStateStatus,reviewDecision
gh pr checks "$PR" --repo "$REPO"
gh pr view "$PR" --repo "$REPO" --comments
gh api --paginate "repos/$REPO/pulls/$PR/comments"
```

Read check details/logs when a result needs diagnosis. A nonzero `gh pr checks` status can mean checks failed or remain pending; inspect its output rather than calling it a provider outage.

For Azure DevOps, use the configured integration and the [provider reference](../setup/issue-tracker-azure-devops.md). Inspect the code-project PR's `status`, `isDraft`, `mergeStatus`, reviewer votes, threads, PR statuses, and applicable blocking policy evaluations. `active` is open, `completed` is merged, and `abandoned` is closed without merge. A successful merge calculation or an empty check list is not approval. Inspect live refs where the last merge-calculation commits lag, and distinguish missing policy evidence from success. Report pre-existing auto-completion rather than silently relying on human-only merging. For another host, use equivalent configured operations; report missing capabilities instead of guessing endpoints.

Compare with the last observation. An unchanged check failure or previously handled comment is not new repair work. Reopen it only when new evidence warrants it; a failed remedy becomes an explicit blocker, not a fresh identical dispatch.

Use [the shared current-base readiness gate](../ship/DELIVERY.md#current-base-readiness-and-real-custody). Do not call unknown mergeability, pending checks, missing required evidence, or an old-base head ready. No check results is not proof of success: establish what the repository requires. Separate **ready for human signoff** from actual approval/merge eligibility; report outstanding human votes without casting them. Blocking findings/reviews or other unmet policies prevent readiness. Immediately before promotion/announcement, reread actual remote source and target refs plus provider state; if either changed, invalidate the claim and reconcile again. Report the observed head/base/time, not a guarantee against the next base race, and continue watching after green.

## Act on meaningful changes

| Observation | Action |
| --- | --- |
| PR merged or closed | Record the terminal state and stop. |
| Open with no meaningful changes, or only pending checks | Record the observation and wait for the next interval. |
| Target advanced, even while PR remains mergeable/policy-compliant | Rebase the owned branch onto the latest fetched target; invalidate stale proof and refresh it below. |
| Conflicted/unmergeable, or policy needs maintenance | Perform bounded branch maintenance; invoke the internal resolver for actual conflicts. |
| Unexpected source-head movement or target retarget/rewrite | Reconcile actual ownership and intent before mutation; do not overwrite concurrent work or silently replay onto a different target. |
| In-scope review feedback or check failure requiring code/test changes | Return to the existing route's feedback continuation on this same PR. |
| Cancelled check, missing runner/tool, or service outage | Distinguish infrastructure from code failure. Report the blocker; use only authorized provider recovery actions. |
| Changed requirements, architecture, scope, accepted risk, or a semantic conflict | Present the decision to the human and stop. |
| Provider access, branch ownership, or required evidence becomes unavailable | Record what is known, report the blocker, and stop rather than claim readiness. |

### Branch maintenance

1. Inspect Git status, worktrees, any in-progress operation, branch ownership, and provider source/target repositories and refs (including forks). Resolve the actual push remote; do not assume `origin` is the PR source. Record the live remote source head as the **expected head** before rewriting and fetch source/target explicitly. Reconcile local commits against that head and the packet. Unknown divergence, competing writers, changed ownership, or a moved source during maintenance stops automatic mutation; do not reset, stash, discard, or overwrite someone else's work.

2. In the owned isolated workspace, rebase onto the newest fetched PR target whenever it advances, even if the provider says mergeable and no policy demands it. An already-contained target is a verified no-op, not a reason for an empty rewrite. Reconcile an unexpected retarget or rewritten target with the owner/human before replaying onto a different intent. Preserve pre-rebase head/ref evidence and unrelated work; dirty or uncertain state must be resolved safely before starting.

3. For actual conflicts, **invoke [conflicts](../conflicts/SKILL.md) internally** with the PR, operation, scoped paths, both sides, maintenance authority, and return owner. It may make only mechanical, unambiguous resolutions. Regenerate derived output from its source; for independent validation registrations, preserve both additions and every trusted-base check, then run complete repository validation. Semantic conflicts return both sides to the human without staging guesses. Owner-directed abort is allowed only when it preserves work. No silent ours/theirs choice, new product fix, or blanket staging.

4. Invalidate pre-rebase head/base check results and independent review coverage; old green and approvals are not proof of the rebased candidate. Every modifying agent/helper uses [changelog](../changelog/SKILL.md). The maintenance/integration owner alone consolidates proposals before fresh review; reuse/deduplicate existing meaningful entries. Record notable maintenance consequences, not one entry per rebase or regeneration. No recursive changelog-only entry or automatic release/version bump.

5. Run affected and repository-required validation and [Verify](../verify/SKILL.md), including complete validation for combined registrations. Obtain fresh independent [Roast](../roast/SKILL.md) coverage (`solid` for code) for the rebased candidate including the consolidated changelog; use scoped fix-review when justified, recording how whole-deliverable coverage is preserved. Mechanical maintenance stays here, not a new route invocation. Functional failures return to the existing route owner.

6. Recheck remote source against the recorded expected head before publishing. For rewritten history on an explicitly owned branch, use an explicit expected-head lease, for example `git push --force-with-lease="<source-ref>:<expected-head>" <source-remote> HEAD:<source-ref>` with resolved full ref and literal recorded commit ID. Never blind `--force`, an unspecified tracking-ref lease, or a newly refreshed lease used to overwrite concurrent commits. If the source changed or the lease fails, preserve local work, report the race, and stop for ownership reconciliation rather than retrying forcefully. Use normal fast-forward push for non-rewritten updates.

7. Re-observe provider checks/policies for the published head; rerun required provider checks when needed and supported, never reuse old-head successes. Reread live source/target before readiness. If target moved again, withdraw readiness and repeat maintenance/proof, not a stale green handoff. If provider access or safe update capability is unavailable, report the blocker and stop.

Use the [shared commit-message policy](../setup/COMMIT-STYLE.md) for newly authored maintenance messages. Preserve existing messages during replay/rebase; formatting does not broaden maintenance authority.

### Feedback repair

Call the existing owner route—[Ship](../ship/SKILL.md), [Patch](../patch/SKILL.md), or [Refactor](../refactor/SKILL.md)—with this same PR, its original requirements/kind, new evidence, current source/target, workspace, validation, doctrine packet, and this Shepherd as return owner. Record the repair worker before waiting. Do not concurrently modify the branch or start another repair for the same findings.

The route classifies evidence, performs bounded implementation and independent review, validates, and updates the same PR. It never invokes Ship as a generic finish or starts a nested Shepherd. On return, reconcile actual head, review coverage, check state, and addressed findings before resuming observation. A missing result, failed repair, or human-owned decision is reported explicitly and ends safe automatic remediation. If the finding requires another kind of delivery, return to Joe-mode/the human for routing, not an automatic route switch.

If a draft's outstanding delivery work needs completing, return it to its existing route under the same ownership rule. Do not promote while acceptance, independent review, current-base proof, or required checks remain incomplete. A blocked draft is not the final handoff.

## Observation rhythm

Choose the interval from the PR's age since creation, not the number of checks or the time this session started:

| PR age | Interval |
| --- | --- |
| Under 1 hour | 2 minutes |
| 1 to under 2 hours | 5 minutes |
| 2 to under 3 hours | 10 minutes |
| 3 to under 4 hours | 15 minutes |
| 4 to under 5 hours | 30 minutes |
| 5 hours onward | 60 minutes |

Observe once immediately when taking or resuming ownership. Between observations, use an interruptible wait or a supported scheduled wakeup; do not busy-poll. Bound each wait to the next interval and check for stop requests before acting again. An active repair is supervised through its worker lifecycle, not duplicated by the observation clock.

Stay attached to the session unless the human explicitly authorizes a persistent external monitor. Never schedule a wakeup or promise continued monitoring unless the runtime can actually deliver it. If it cannot wait or continue, record the stopped state and report the limitation.

On meaningful changes, report the PR, checks/readiness, action taken, and next observation. On merge, closure, human decision, operator stop, or runtime loss, leave the latest truthful record. A crash ends observation; the last green result does not prove monitoring continued. Stop only run-owned waits/workers when safe, preserve unfinished work, and report any worker whose termination is uncertain.
