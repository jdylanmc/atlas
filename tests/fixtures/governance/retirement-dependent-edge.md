---
sdk:
  atlas-sdk-schema: 1.0.0
  created-at: "2026-08-22T00:00:00Z"
  created-by:
    kind: agent
    name: Fixture Agent
  id: edge:retirement-dependent
  local-atlas-schema: 1.0.0
  tags: []
  title: Retirement Relationship
  type: edge
  updated-at: "2026-08-22T00:00:00Z"
  updated-by:
    kind: human
    name: Fixture Maintainer
atlas:
  from: concept:retirement-dependent
  semantics:
    - covers
  to: "{document-id}"
---

# Retirement Relationship

The fixture claim is connected to its governing document.[^fixture]

[^fixture]: [[.atlas/sources/retirement-evidence]] Synthetic fixture evidence.
