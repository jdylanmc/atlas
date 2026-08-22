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
