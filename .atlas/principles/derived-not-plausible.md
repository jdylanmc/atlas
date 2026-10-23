---
sdk:
  atlas-sdk-schema: 1.0.0
  created-at: "2026-08-24T21:40:00Z"
  created-by:
    kind: human
    name: Dylan McCurry
  id: principle:derived-not-plausible
  local-atlas-schema: 1.0.0
  tags: []
  title: A Detector Must Prove Derivation, Not Plausibility
  type: principle
  updated-at: "2026-10-23T17:11:56Z"
  updated-by:
    kind: human
    name: Dylan McCurry
atlas: {}
---

# A Detector Must Prove Derivation, Not Plausibility

## Active truths

- `truth:derived-not-plausible` A detector must prove that a value is actually derived from its claimed source, not merely that it looks correct; a plausible fabricated value has defeated review where an implausible one has not.

## Amendments

### 1 - 2026-08-24

Added `truth:derived-not-plausible` under Maintainer approval. Established after fabricated stamp revisions resembling real SHA-256 digests survived five review rounds while obviously fake values were caught immediately.

### 2 - 2026-10-23

Editorial: removed the hyphen after "obviously" in Amendment 1's rationale under the `Google.LyHyphens` prose rule. No truth changed.
Maintainer: Dylan McCurry
Rationale: Adopting the Google Vale style as the Atlas default made that wording a Lint error.
Change reference: https://github.com/jdylanmc/atlas/pull/269
