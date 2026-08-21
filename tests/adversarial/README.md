# Adversarial corpus

This directory holds permanent gate corpora for review findings. A review
finding is resolved only after this corpus has a reject or accept case that
exercises it.

`vocabulary-agreement.json` currently exercises the `vocabulary-agreement`
gate. Additions for an existing gate should be data-only edits. If a new gate is
needed, register that gate in `tests/adversarial_corpus.test.ts`, add the gate
code, and then add the corpus case that proves the review finding stays covered.
