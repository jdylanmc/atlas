---
sdk:
  atlas-sdk-schema: 1.0.0
  created-at: "2026-08-24T21:40:00Z"
  created-by:
    kind: human
    name: Dylan McCurry
  id: principle:unrepresentable-invalid-state
  local-atlas-schema: 1.0.0
  tags: []
  title: Prefer Unrepresentable Invalid States
  type: principle
  updated-at: "2026-08-24T21:40:00Z"
  updated-by:
    kind: human
    name: Dylan McCurry
atlas: {}
---

# Prefer Unrepresentable Invalid States

## Active truths

- `truth:unrepresentable-invalid-state` An invalid state is made unrepresentable by construction wherever possible, rather than guarded against after the fact; every defect hardened this way has survived direct attack, while every defect guarded by a remembered rule has failed.

## Amendments

### 1 - 2026-08-24

Added `truth:unrepresentable-invalid-state` under Maintainer approval. Established from repeated evidence in this repository (branded identity types, plumbing-only Git writes, no delete primitive) and the repeated failure of enumerated guards (core.hooksPath, core.fsmonitor, Win32 trailing dot/space).
