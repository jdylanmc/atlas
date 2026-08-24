---
sdk:
  atlas-sdk-schema: 1.0.0
  created-at: "2026-08-24T21:40:00Z"
  created-by:
    kind: human
    name: Dylan McCurry
  id: principle:deterministic-no-model
  local-atlas-schema: 1.0.0
  tags: []
  title: The SDK Is Deterministic and Never Invokes a Model
  type: principle
  updated-at: "2026-08-24T21:40:00Z"
  updated-by:
    kind: human
    name: Dylan McCurry
atlas: {}
---

# The SDK Is Deterministic and Never Invokes a Model

## Active truths

- `truth:deterministic-no-model` Atlas SDK's core is a deterministic library that never invokes a language model at runtime; semantic judgment is carried only as a structured verdict supplied by a caller, never produced internally.

## Amendments

### 1 - 2026-08-24

Added `truth:deterministic-no-model` under Maintainer approval. Restates ADR-0001 (docs/adr/0001-sdk-is-a-deterministic-library.md) as governed knowledge inside the Atlas so the constraint is enforceable and re-discoverable through Re-anchor, not only recorded in a design document.
