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
