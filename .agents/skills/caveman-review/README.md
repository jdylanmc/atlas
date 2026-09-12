# caveman-review

Read-only Standards/Spec review with concise findings. Location, problem, fix.

## What it does

The local adaptation collects committed or working-tree evidence, including
new files, and assesses repository standards and the approved spec separately.
It reports findings in `L<line>: <severity> <problem>. <fix>.` format, preserving
exact locations and symbols. Severity: 🔴 bug, 🟡 risk, 🔵 nit, ❓ question.
It can also format completed findings supplied explicitly by another workflow
without repeating that analysis.

Auto-clarity: drops terse mode for CVE-class security findings, architectural disagreements, and onboarding contexts where the author needs the *why*. Resumes terse for the rest.

Read-only — does not change code, approve, request changes, or run linters.

## How to invoke

```
/caveman-review
```

Also triggers on "review this PR", "code review", "review the diff".

## Example output

```
L42: 🔴 bug: find() can return undefined. Guard user before reading email.
L88-140: 🔵 nit: 50-line fn does 4 things. Extract validate/normalize/persist.
L23: 🟡 risk: no retry on 429. Wrap in withBackoff(3).
L107: ❓ q: why drop the cache here? Reads on next request will miss.
```

## See also

- [`SKILL.md`](./SKILL.md) — full LLM-facing instructions
- [`REVIEW-PROCESS.md`](./REVIEW-PROCESS.md) — scope, evidence and two-axis analysis
- [Upstream Caveman README](https://github.com/juliusbrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/README.md) — source overview, not additional installation instructions
- [Local packet guide](../README.md) — repository routing and boundaries
