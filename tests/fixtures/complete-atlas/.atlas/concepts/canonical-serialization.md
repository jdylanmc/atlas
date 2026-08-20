---
sdk:
  atlas-sdk-schema: 1.0.0
  created-at: "2026-08-17T00:00:00Z"
  created-by:
    kind: agent
    name: Fixture Agent
  id: concept:canonical-serialization
  local-atlas-schema: 1.0.0
  tags:
    - lint
    - serialization
  title: Canonical Serialization
  type: concept
  updated-at: "2026-08-17T00:00:00Z"
  updated-by:
    kind: human
    name: Fixture Reviewer
atlas:
  confidence: reviewed
  evidence:
    - .atlas/sources/atlas-sdk-lint
---

# Canonical Serialization

One Atlas page value serializes to exactly one byte sequence, so reserializing a
parsed page reproduces the bytes it was parsed from.[^sdk-lint]

[^sdk-lint]: [[.atlas/sources/atlas-sdk-lint]] Atlas SDK Lint documentation.
