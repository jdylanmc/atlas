---
workflow: governance-maintenance
atlas-sdk-schema: 1.0.0
adr: docs/adr/0001-sdk-is-a-deterministic-library.md
---

# Governance maintenance

Use this instruction file when a Maintainer asks to create, amend, retire, or
verify a Principle or Atlas Policy.

The Atlas SDK is deterministic. Do not ask it to produce semantic judgment. When
judgment is needed, return a structured semantic verdict with cited Atlas
evidence and a Challenge. The SDK accepts only verdicts whose evidence resolves
to real Atlas locations. If the verdict and Challenge disagree, report the
disagreement as inconclusive and escalate to the Maintainer.

Do not delete governance knowledge. To remove force, retire or amend the
Principle or Atlas Policy, invalidate affected truths, reconcile dependent
relationships and governance markers, append an operation-identified Atlas
Changelog entry, run full Lint, and wait for human approval before merge.

The deterministic command seam for this workflow is `atlas govern --machine
--request PATH [--atlas-host-directory PATH]`. Author the request as JSON with
the `action`, `subject`, the Maintainer approval metadata (`approvedBy`,
`approvedAt`), the authored `changes`, the drafted `changelog` prose, and any
semantic Policy verdict. The command validates and commits one reviewable Atlas
Proposal; it never supplies approval or a verdict itself, so an agent may propose
but never establish a Principle or Atlas Policy autonomously.

## Who authors what

The request carries only knowledge and judgment; Atlas SDK derives all
bookkeeping. Do not attempt to supply a base snapshot digest, a target head, or
the operation ID — there is no field for them, and Atlas SDK reserves the
`.atlas/CHANGELOG.md` entry for itself.

| Who | Supplies |
|---|---|
| Maintainer (human) | the truth or rule itself, the intent, and approval (`approvedBy`, `approvedAt`) |
| Agent | the authored `changes` — the Principle or Atlas Policy page, including a Principle's amendment history — and the drafted `changelog` prose |
| Atlas SDK | the base snapshot digest, the target head, the Atlas Changelog entry's stable operation ID, identity derivation, and validation |

Each authored change is `{ path, content }` against a canonical `.atlas/` path.
A new Principle page uses the deterministic path-derived identity, and Principle
maintenance preserves the `## Amendments` history. The `changelog` field is
prose only: Atlas SDK stamps it with the stable operation ID, heads it with the
approval date, and appends it to the existing Atlas Changelog. If the Atlas Head
advances while the operation runs, Atlas SDK detects the drift against its own
captured snapshot and refuses before writing, so a stale proposal is never
committed.
