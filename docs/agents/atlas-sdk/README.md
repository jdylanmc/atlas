# Inactive SDK Atlas Guide

This directory holds the reviewed source definition for the canonical **SDK
Atlas** Guide. It is not an Atlas, a Framework Bundle, a host integration,
or an active agent registration.

- `personas/merlin/persona.md` defines the presentation-only Merlin Agent
  Persona.
- `compositions/atlas-guide.json` records the intended inactive Agent
  Composition.

Canonical Atlas Initialization will eventually copy the approved Persona to
`.atlas/personas/merlin/persona.md` and write the role composition to
`.atlas/agents/atlas-guide.yaml`. This repository intentionally contains no
`.atlas/` initialization from these source artifacts.

The composition remains inactive until SDK Atlas Initialization supports
trusted Agent Persona validation, Agent Directive loading and precedence,
plain fallback, and full Fletcher and Lint enforcement. The three referenced
Directives are intention identifiers only; their bodies are not duplicated
here:

1. `orient-atlas-users`
2. `steward-atlas-knowledge`
3. `curate-atlas-site`

The avatar brief calls for wholly original, self-hosted artwork. The neutral
SDK Atlas sigil remains the fallback unless reviewed artwork and its
publication-rights metadata are present.

Validate the inactive source contract with:

```sh
node scripts/atlas_sdk_agents.ts validate
```
