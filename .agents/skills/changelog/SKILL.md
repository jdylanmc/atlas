---
name: changelog
description: "Internal helper for every modifying agent. Curate notable human-facing changes using Keep a Changelog; respect write scope and one integration owner. No direct human command or automatic release."
disable-model-invocation: false
user-invocable: false
---

# Changelog

**Entry:** internal to authorized modifying work, under the
[invocation contract](../setup/INVOCATION.md). Reuse the caller's scope and
permissions; this helper never independently authorizes edits or publication.
Preserve applicable [doctrine selections](../doctrine/APPLY.md); `documentation`
may inform curation. A PR-bound edit inherits the delivery's required `worktrees`.

Every modifying agent uses this helper, including agents changing tests,
documentation, configuration, and skills. Use it once for a meaningful change
and revisit when the outcome changes, not after every edit or tool call.

## Resolve the record and owner

Read the repository's changelog/release guidance and the actual scoped diff or
artifacts. Resolve the relevant project, package, component, or skill changelog.
Do not assume every change belongs in the root file. Clarify an ambiguous
destination; do not create a second history beside an established one.

Follow [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/):
curated notable changes for people, grouped by release and change type, not
commit messages copied into a file. Its
[source project](https://github.com/olivierlacan/keep-a-changelog) owns the
convention; this skill owns the integration procedure.

For a new authorized file, use `# Changelog`, a short statement of convention
and the project's actual versioning policy, then `## [Unreleased]` with a
resolvable link when a meaningful comparison exists (otherwise `## Unreleased`).
Use only applicable `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and
`Security` subsections. Newest releases come first; release headings carry real
versions and `YYYY-MM-DD` dates. Keep sections linkable and use verified
comparison/tag links when available. Never invent a version, date, tag, or
Semantic Versioning policy.

For an existing incompatible format, propose a bounded adoption decision to the
owner; do not silently rewrite history. Pending that decision, preserve the
existing file and return categorized entry candidates. Maintain any established
release-note automation input rather than creating a conflicting second source.
Keep released entries unchanged unless a specific correction is authorized.

## Curate and consolidate

Identify the human-visible outcome, who it affects, and any required action.
Use evidence from the final change, issue, or PR; labels and commit titles are
leads, not proof. Preserve deprecation versus removal, breaking behavior,
migration requirements, and scope limits. Do not publish secrets or private
incident details in a public changelog.

Add or revise one concise `Unreleased` entry per notable outcome. Prefer
outcome-level wording across related commits. Check existing entries to avoid
duplicates, contradictions, or recording an intermediate design as the shipped
behavior. Include traceable references where useful without overwhelming prose.

Whitespace-only changes, temporary probes, unchanged generated output, and
incidental scratch artifacts normally need no entry. Return **no notable entry
needed** with a short reason to the owner; consultation does not require noise.
A changelog-only edit does not create a changelog entry about itself.

Only the authorized owner edits a shared changelog. An isolated worker may
update its own copy when assigned that ownership; otherwise return proposed
category, wording, target, and evidence with the change. The integration owner
consolidates proposals against the integrated diff before final review.
Re-read current content before applying; preserve concurrent human edits.
If a file write fails or ownership is unresolved, report the unapplied proposal,
not success.

## Return to delivery

Read back the resulting entries and compare them with the current change.
Check category, accuracy, destination, links, duplicate outcomes, and breaking
change visibility. Include an applied entry in the same reviewed delivery.
Return the target and applied/proposed/no-entry status with the evidence basis.

Do not commit, push, release, tag, choose versions, or move `Unreleased` into a
release independently. The delivery owner handles its already-authorized
publication; a human retains release and final approval decisions.
