# Scoped fix review

Use this reference when Roast is asked to verify a particular fix wave. It supplements the single Roast findings contract; it is not another review/approval protocol.

## Inputs and scope

Receive the original findings, relevant requirements/standards, the previously reviewed revision, the fix-base/result or artifact snapshots, and the implementer's report. Identify missing inputs rather than assuming `HEAD~1` captures the fix.

Read the actual fix and enough surrounding context to check the mechanism. Verify each original finding and inspect the fix for new breakage. A supplied diff/report is evidence to inspect, not a ban on checking source when it is incomplete or stale.

Do not repeat an unchanged whole-artifact review solely because a fix exists. If the fix changes the contract or invalidates earlier coverage, identify the affected scope and request the needed broader review. The owner still needs the full integrated-deliverable review; a scoped fix check does not replace it.

## Evidence and output

For every original finding, report **ADDRESSED**, **NOT ADDRESSED**, or **UNVERIFIED**, with a locator and decisive evidence. Attempted remediation is not resolution. Mark what could only be inspected and what was actually executed.

Reuse applicable, current validation evidence; inspect that it covers the changed behavior. Run permitted focused checks when a material doubt remains, following Roast's execution boundaries. Neither rerun every suite automatically nor forbid a necessary check just because the implementer reported success.

Lead with one prioritized list of remaining flaws and new breakage, using Roast's complete finding fields. Append the per-finding verification results and coverage limits. Do not produce a second Standards/Spec approval rubric or a "safe to merge" verdict.

Keep incidental out-of-scope observations separate and route them to the owner. Do not silently fix them or expand the implementation task. If an observation invalidates the fix's claimed correctness, make that consequence explicit rather than automatically declaring it non-blocking.

No source mutations, nested reviewers, automatic repairs, accepted-risk rulings, or human sign-off. Return to Ship or the requesting owner for the next authorized step.
