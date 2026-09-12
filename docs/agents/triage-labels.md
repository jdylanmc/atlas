# Triage Labels

These are the five default triage roles approved for Atlas. Skills use the
tracker label in this table when referring to a role.

| Role | Tracker label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate the request |
| `needs-info` | `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, independently verifiable implementation work |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

This mapping does not create or apply GitHub labels. Before an authorized
transition, check which labels exist; follow the missing-label preflight in
[issue-tracker.md](issue-tracker.md). Preserve an existing label's metadata.

Triage applies to incoming requests, not the unlabeled parent specifications,
Wayfinder maps/decision tickets, milestone or umbrella records, or reviewed
implementation tickets produced by Atlas's planning workflows.
`/spec` and `/tickets` do not depend on this mapping; `/tickets`
continues to own creation of the existing `ready-for-agent` label.

Scope labels such as `mvp`, `post-mvp`, and `non-mvp` are not triage states.
Preserve them and all native issue relationships. A deferral is not `wontfix`;
a ready label neither clears blocking dependencies nor authorizes execution,
merging, or release.
