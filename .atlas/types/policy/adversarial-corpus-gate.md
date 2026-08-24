---
sdk:
  atlas-sdk-schema: 1.0.0
  created-at: "2026-08-24T21:40:00Z"
  created-by:
    kind: human
    name: Dylan McCurry
  id: policy:adversarial-corpus-gate
  local-atlas-schema: 1.0.0
  tags: []
  title: Adversarial Corpus Gate
  type: policy
  updated-at: "2026-08-24T21:40:00Z"
  updated-by:
    kind: human
    name: Dylan McCurry
atlas: {}
---

# Adversarial Corpus Gate

## Scope

Governs Atlas SDK's own CI review-and-merge workflow for changed source in `src/` and `scripts/`: no pull request against this repository may merge without satisfying this Policy.

## Evaluation

Deterministic. `npm run ci` enforces this mechanically: a durable review finding is not considered resolved, and its corresponding pull request is not mergeable, until `tests/adversarial/` carries a reject or accept case exercising that finding, per the corpus rule already recorded in `AGENTS.md`.

## Consequence

Blocks only the operation it governs: the pull request that introduced or claims to resolve the finding. It does not invalidate the Atlas.
