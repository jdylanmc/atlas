# Keep a Changelog Pattern for Pillars

Researched against `olivierlacan/keep-a-changelog` commit
`bb8a60462d3f0c760ee56df312fcfdc60cf6e2f2` on 2026-08-15.

## Relevant upstream conventions

- A changelog is a curated, chronological list of notable changes.
- The latest entry appears first, with an optional `Unreleased` section above it.
- Released entries use an identifier and ISO 8601 date.
- Changes are grouped under a small fixed vocabulary: `Added`, `Changed`,
  `Deprecated`, `Removed`, `Fixed`, and `Security`.
- Empty categories are omitted.
- Semantic Versioning is optional; the document may declare another numbering
  scheme.
- Reference links may connect entries to the exact change that produced them.

## Atlas adaptation

Each Pillar keeps its current active truths near the top and an amendment
history at the bottom. Pillar amendments use monotonically increasing
amendment numbers and ISO dates rather than software versions. The applicable
categories are `Added`, `Changed`, and `Removed`; removal means a truth was
invalidated. Each amendment also records the directing or approving human,
rationale, and change reference.

Atlas does not need a permanent `Unreleased` section because a proposed
amendment is finalized in its pull request before it becomes part of the
Realm. Git comparison links are optional because the portable change reference
may point to a pull request, commit, or equivalent repository record.

## Primary sources

- [Keep a Changelog 2.0.0 source](https://github.com/olivierlacan/keep-a-changelog/blob/bb8a60462d3f0c760ee56df312fcfdc60cf6e2f2/source/en/2.0.0/index.html.md)
- [Keep a Changelog's own changelog](https://github.com/olivierlacan/keep-a-changelog/blob/bb8a60462d3f0c760ee56df312fcfdc60cf6e2f2/CHANGELOG.md)
