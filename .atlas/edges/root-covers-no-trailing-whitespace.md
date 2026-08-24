---
sdk:
  atlas-sdk-schema: 1.0.0
  created-at: "2026-08-24T22:30:00Z"
  created-by:
    kind: agent
    name: Atlas SDK
  id: edge:root-covers-no-trailing-whitespace
  local-atlas-schema: 1.0.0
  originating-operation: ingest-95263495f14a-c03400f6
  tags: []
  title: Root Covers Avoid Trailing Whitespace
  type: edge
  updated-at: "2026-08-24T22:30:00Z"
  updated-by:
    kind: agent
    name: Atlas SDK
atlas:
  from: anchor:root
  semantics:
    - covers
  to: concept:no-trailing-whitespace
---
# Root Covers Avoid Trailing Whitespace

Entering the Home Atlas leads to the Avoid Trailing Whitespace Concept, drawn from Google's Markdown style guide.[^s1]

[^s1]: [[.atlas/sources/google-markdown-style-guide]] Quoted span "Don't use trailing whitespace. Use a trailing backslash to break lines.".
