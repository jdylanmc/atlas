# Prose Lint is a mandatory, pinned Vale run configured inside each Atlas

Atlas SDK's Lint checked an Atlas's structure but nothing about how its pages read,
and the closest thing it had to an editorial rule was an accident: a 1 MiB per-file
and 16 MiB total byte budget that capped page size as a side effect of bounding
capture. We decided every Lint runs the Atlas's own [Vale](https://vale.sh) prose
rules, that Vale is required rather than optional, that Atlas SDK downloads one
pinned official Vale release per machine rather than redistributing it, that Vale's
configuration lives entirely inside `.atlas/`, and that the byte budgets are removed
in favor of an Atlas-owned page-length rule.

## Considered options

**Vale as an optional extension**, like `atlas-qmd`: present when installed and
configured, skipped otherwise. Rejected because a prose rule that silently does not
run is indistinguishable from one that passed. An error-level Vale alert must stop an
Atlas from being pushed, so a Lint whose prose rules did not run is not completed.

**Redistributing Vale** as per-platform npm packages under the Atlas SDK scope.
Rejected: it makes Atlas SDK a Vale distributor that must republish six packages for
every Vale release, for no benefit over fetching the identical official asset.

**The community `@vvago/vale` npm wrapper.** Rejected: it installs the binary from a
`postinstall` script, so any install that skips lifecycle scripts — this repository's
own `.npmrc` and CI, and pnpm's default — silently has no Vale.

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

**Vale is a pinned, machine-scoped tool runtime.** Atlas SDK pins one Vale release
and the SHA-256 of each platform's official asset. On first need it downloads the
asset, verifies the digest, and atomically places the binary under
`${XDG_CACHE_HOME:-~/.cache}/atlas/tool-runtimes/vale/<version>/<os>-<cpu>/`, beside
the other Atlas SDK tool runtimes; it refuses a binary reporting another version.
Atlas Initialization prepares it before writing anything, because the proposal's
own Lint and the first Ingest's Lint both run Vale. This is the first native
executable Atlas SDK runs and its first network fetch outside Git. It does not
contradict ADR-0001: Vale is deterministic, invokes no model, and runs with an empty
environment over a private copy of exactly the text Lint loaded. Offline first use
and unsupported platforms cannot complete Lint.

**Every Atlas carries `.atlas/.vale.ini` and `.atlas/vale/`.** Initialization seeds
the Atlas SDK default prose style — `AtlasSDK.PageLength` plus the vendored
`vale-cli/Google` style at its own severities, with `Google.Quotes` lowered to a
warning because Ingest's verbatim citation format places punctuation outside quotes
— and the Atlas owns it from then on; Atlas SDK does not rewrite it. An Atlas without its configuration fails Lint. `vale` is a reserved
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
