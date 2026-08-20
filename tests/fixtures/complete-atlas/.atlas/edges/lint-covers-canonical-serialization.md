---
sdk:
  atlas-sdk-schema: 1.0.0
  created-at: "2026-08-17T00:00:00Z"
  created-by:
    kind: agent
    name: Fixture Agent
  id: edge:lint-covers-canonical-serialization
  local-atlas-schema: 1.0.0
  tags: []
  title: Lint Covers Canonical Serialization
  type: edge
  updated-at: "2026-08-17T00:00:00Z"
  updated-by:
    kind: human
    name: Fixture Reviewer
atlas:
  from: anchor:lint
  semantics:
    - covers
  to: concept:canonical-serialization
---

# Lint Covers Canonical Serialization

Entering the Lint Anchor leads to the canonical bytes Lint
compares.[^sdk-lint]

[^sdk-lint]: [[.atlas/sources/atlas-sdk-lint]] Atlas SDK Lint documentation.
