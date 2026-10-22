# Prose Lint is a bundled, mandatory Vale run configured inside each Atlas

Atlas SDK's Lint checked an Atlas's structure but nothing about how its pages read,
and the closest thing it had to an editorial rule was an accident: a 1 MiB per-file
and 16 MiB total byte budget that capped page size as a side effect of bounding
capture. We decided every Lint runs the Atlas's own [Vale](https://vale.sh) prose
rules, that Vale is bundled rather than optional, that its configuration lives
entirely inside `.atlas/`, and that the byte budgets are removed in favor of an
Atlas-owned page-length rule.

## Considered options

**Vale as an optional extension**, like `atlas-qmd`: present when installed and
configured, skipped otherwise. Rejected because a prose rule that silently does not
run is indistinguishable from one that passed. An error-level Vale alert must stop an
Atlas from being pushed, so a Lint whose prose rules did not run is not completed.

**Vale from the operator's `PATH`.** Rejected because Vale's output depends on its
version, so one Atlas could pass on one machine and fail on another, and because an
operator's global Vale configuration or `VALE_*` environment could change a verdict.

**Reimplementing prose rules in TypeScript.** Rejected: Vale already parses markup
into scopes, counts Unicode words, and gives an Atlas a well-known rule language its
maintainers can edit. Atlas SDK keeps only checks Vale cannot express: structure,
citations, governance references, identity, and line endings (Vale treats a lone
carriage return as a line break, so it cannot report one).

**A host-root `.vale.ini`.** Rejected because an Atlas is the unit of portability
(ADR-0002): its prose rules must travel with its knowledge.

## Consequences

**Vale is a pinned native dependency.** Atlas SDK pins one Vale release and verifies
every downloaded asset against its SHA-256. Each supported platform receives the
binary through an exact-version optional dependency, `@jdylanmc/atlas-vale-<os>-<cpu>`,
the pattern native-tool npm packages use; Atlas SDK refuses a binary that reports a
different version. This is the first native executable Atlas SDK runs. It does not
contradict ADR-0001: Vale is deterministic, invokes no model, and runs with an empty
environment over a private copy of exactly the text Lint loaded. Unsupported
platforms cannot complete Lint, and installing with optional dependencies omitted
leaves Lint incomplete.

**Every Atlas carries `.atlas/.vale.ini` and `.atlas/vale/`.** Initialization seeds
the Atlas SDK default prose style; the Atlas owns it from then on and Atlas SDK does
not rewrite it. An Atlas without its configuration fails Lint. `vale` is a reserved
`.atlas/` directory name.

**Vale findings are Atlas-owned.** They carry `atlas-owned`, untrusted attribution,
so they may add findings but never suppress or downgrade a trusted one. Their
severity is the rule's own: errors deny validity, warnings and suggestions do not.

**Byte budgets are gone.** Atlas SDK no longer refuses an Atlas file or snapshot for
its size, in Lint, Explore, the Atlas Cache, or proposal workflows, and the
changelog-capacity warning that existed only to forecast that limit is removed.
Page length is the default style's `AtlasSDK.PageLength` rule (1,000 prose words,
error). File-count, traversal-depth, Markdown parser nesting and markup bounds, and
command request-file limits remain: they bound parser cost and caller input, not
Atlas knowledge.

**Line-ending failures name their files.** Removing the anonymous whole-Atlas load
failure, Lint reports each file containing a non-canonical line terminator at its
first offending line and column.
