# Adversarial corpus

This directory holds permanent gate corpora for review findings. A review
finding is resolved only after this corpus has a reject or accept case that
exercises it.

`vocabulary-agreement.json` currently exercises the `vocabulary-agreement`
gate. Additions for an existing gate should be data-only edits. If a new gate is
needed, register that gate in `tests/adversarial_corpus.test.ts`, add the gate
code, and then add the corpus case that proves the review finding stays covered.

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
request, fragment, and workflow boundaries. The optional governance change in
`installed-consumer.json` exercises one malformed Principle through installed
`atlas govern` after Initialization and Git adoption, requiring each distinct
Finding exactly once and no proposal or target mutation.
