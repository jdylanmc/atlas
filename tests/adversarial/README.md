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

The `installed-consumer` gate is registered and its data validated in
`tests/adversarial_corpus.test.ts`, but its cases execute in
`tests/package_consumability.test.ts` alongside the other packing tests.
Every pack runs `prepack`, which deletes and rebuilds `dist/`; keeping all packs
in one test file prevents concurrent builds from truncating the artifact under
test. The corpus schema check is not the acceptance proof: the external consumer
must invoke installed Initialization, adopt its proposal through Git, and pass
installed Lint and Explore. Add cases to `installed-consumer.json` to extend
this gate without duplicating the installation harness.

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

The `changelog` gate in `changelog.json` is registered here and executes through
`tests/atlas_changelog.test.ts`. It preserves operation entries beneath one
UTC date heading, keeps exact instants as metadata, and protects historical
Markdown from being mistaken for headings. Cases marked `exerciseOperations`
also run in `tests/governance_cli.test.ts`: actual Ingest and Governance CLI
proposals are separately Linted, adopted through Git, and checked together on
the target branch. Schema acceptance alone is not the integration proof.
The delimiter-dense history case also uses the existing paired CPU-growth
assertion at its unchanged threshold while checking exact preserved bytes.
