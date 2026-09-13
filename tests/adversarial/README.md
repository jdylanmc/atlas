# Adversarial corpus

This directory holds permanent gate corpora for review findings. A review
finding is resolved only after this corpus has a reject or accept case that
exercises it.

`vocabulary-agreement.json` currently exercises the `vocabulary-agreement`
gate. Additions for an existing gate should be data-only edits. If a new gate is
needed, register that gate in `tests/adversarial_corpus.test.ts`, add the gate
code, and then add the corpus case that proves the review finding stays covered.

Directory-reference cases include whole and bare paths, decoded and Windows
literals, constant aliases, template/concatenation forms, Node path constructors,
shadowing, and legitimate Core Archetype/reserved-directory controls. Cycles and
bounded-analysis refusals are pinned as data rather than executing fixture code.
Partial-value cases preserve known directories around runtime hosts and filenames
without guessing unknown names. Comment and nested-literal cases prevent folding
from hiding other contract references.

Changelog-capacity cases in `atlas-cli.json` generate committed UTF-8 history
with a byte-order mark at and one byte below the default warning threshold.
They require a visible warning without invalidity at the threshold, no warning
below it, unchanged history bytes and Git state after the actual CLI runs, and
successful default Git snapshot capture of the same history.
Explore runs before and after the capacity fixture is committed, requiring
unchanged reachable IDs/routes, complete structure and passed validation while
Lint retains its maintenance warning.

The `explore-ranking` cases also resolve route `reanchorIndex` references
against the emitted checkpoint table. Literal expected Anchor IDs cover the
SDK Atlas and the complete fixture's Root -> Lint Anchor -> Concept route,
including the entry step's absent reference and the incoming-hop checkpoint
at an Anchor transition. Missing, dangling, negative or incorrect references
fail the black-box CLI gate.

The `installed-consumer` gate is registered and its data validated in
`tests/adversarial_corpus.test.ts`, but its cases execute in
`tests/package_consumability.test.ts` alongside the other packing tests.
Every pack runs `prepack`, which deletes and rebuilds `dist/`; keeping all packs
in one test file prevents concurrent builds from truncating the artifact under
test. The corpus schema check is not the acceptance proof: the external consumer
must invoke installed Initialization, adopt its proposal through Git, and pass
installed Lint and Explore. Add cases to `installed-consumer.json` to extend
this gate without duplicating the installation harness.

The optional `ingestPlan` probes exercise approved and refused Scopes through
the installed CLI before an Atlas exists. They use the same Operation Result
parser as installed Initialize, Lint, Explore, and Governance, pin the complete
Assignment payload, and require no Git or Atlas mutation. Fixture attestations
are synthetic test input, not claims of production human approval.

`governance-request-types.test-d.ts` is the compiler-backed governance contract
corpus. The registered test in `tests/adversarial_corpus.test.ts` compiles it
with the repository TypeScript settings, and ordinary `npm run typecheck`
includes it too. Its expected-error cases reject unapproved mutations and
attested verification; positive cases exercise approved mutations, unattested
verification, action narrowing, and the public workflow signature. Missing
expected errors fail the gate rather than silently accepting weaker types.

`governance.json` also carries data-driven `merge` and `assembly` cases executed
by `tests/governance_operation.test.ts`. They pin Finding identity, attribution
and severity precedence, distinct ranges, and deduplication at the public
request, fragment, and workflow boundaries. The merge corpus also mutates
caller-owned ranges after merging to ensure generated trusted refusal ranges
remain distinct and deeply immutable without freezing the caller's input.

The optional governance change in `installed-consumer.json` exercises one
malformed Principle through installed
`atlas govern` after Initialization and Git adoption, requiring each distinct
Finding exactly once and no proposal or target mutation.
