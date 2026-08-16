# Keep a Changelog Pattern

Researched against `olivierlacan/keep-a-changelog` commit
`bb8a60462d3f0c760ee56df312fcfdc60cf6e2f2` on 2026-08-15, covering the
Keep a Changelog 2.0.0 specification released 2026-06-07.

## Relevant upstream conventions

- A changelog is a curated, chronological list of notable changes, written
  *for humans*. There is deliberately no separate machine format.
- Open with a `# Changelog` heading and a fixed preamble stating what the file
  is, which format it follows, and which versioning scheme it uses. Pin the
  format link to the version followed.
- Name the file `CHANGELOG.md`; a predictable name makes it findable.
- The latest entry appears first. Every version has an entry with an ISO 8601
  date. Versions and sections are linkable.
- Six change types, and they do not grow: `Added`, `Changed`, `Deprecated`,
  `Removed`, `Fixed`, `Security`. Empty categories are omitted. `Fixed` means
  the behavior was wrong and is now correct; `Changed` means it worked as
  intended and now works differently.
- Semantic Versioning is optional; declare whichever scheme applies.
- **Curate, don't accumulate.** A changelog records notable changes, and
  deciding what is notable is human judgment. It is not a sorted commit log.
- **Machines can draft, humans curate.** A model may write the first draft
  given the same brief as a contributor: summarize notable changes, sort each
  into one of the six types, explain the reason in the text, mark breaking
  changes, never paste a diff, and cut anything not worth reading. Record that
  brief where agents read it.
- Keep continuous integration in a supporting role: mechanics only. Do not
  make a changelog edit a required check on every change, because that
  produces noise written to pass the check.
- Prefer portable references. Pull request numbers belong to one host; commits
  and tags stay with the repository. Collect pointers as reference-style links
  at the bottom so prose stays readable.
- A withdrawn release is marked `## [0.0.5] - 2014-12-13 [YANKED]` rather than
  hidden.
- Rewriting an entry after the fact is legitimate; note the date it was
  updated.
- Unrelated projects sharing a repository each keep their own changelog. Only
  one product split into components also keeps a central summary.

## Atlas adaptation

### Realm Chronicle

Each Realm keeps `.atlas/CHANGELOG.md`. The Realm is versioned by dated
knowledge revisions rather than software versions, and its preamble says so.
One entry records one merged knowledge-changing operation, headed by its date
and a short operation slug. There is no permanent `Unreleased` section,
because the pull request is already the review gate.

All six change types apply unchanged. Operations that changed no knowledge —
failed, cancelled, no-change, and verification-only continuous integration
runs — produce no entry at all, which also prevents an operation from
modifying the pull request that verifies it.

The operation drafts its entry inside its pull request and a human curates it
during the same review that approves the knowledge change. Realms are
sovereign, so a repository holding several Realms keeps one Chronicle per
Realm and no central roll-up. Knowledge later adjudicated false is marked
`[RETRACTED]` rather than deleted.

### Page amendment histories

Pillars, Laws, and Lore keep their own in-file amendment histories, which
answer a different question than the Chronicle: the provenance of one
governed truth rather than the notable history of the Realm. Amendments use
monotonically increasing amendment numbers and ISO dates rather than software
versions, and Lore uses refresh numbers. Each amendment records the directing
or approving human, the rationale, and a change reference.

## Primary sources

- [Keep a Changelog 2.0.0 specification](https://github.com/olivierlacan/keep-a-changelog/blob/bb8a60462d3f0c760ee56df312fcfdc60cf6e2f2/source/en/2.0.0/index.html.md)
- [Keep a Changelog's own changelog](https://github.com/olivierlacan/keep-a-changelog/blob/bb8a60462d3f0c760ee56df312fcfdc60cf6e2f2/CHANGELOG.md)
