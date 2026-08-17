# Inactive Atlas SDK Realm Guide

This directory holds the reviewed source definition for the canonical **Atlas
SDK** Realm Guide. It is not a Realm, a Framework Bundle, a host integration,
or an active agent registration.

- `personas/merlin/persona.md` defines the presentation-only Merlin Agent
  Persona.
- `compositions/realm-guide.json` records the intended inactive Agent
  Composition.

Canonical Realm Initialization will eventually copy the approved Persona to
`.atlas/personas/merlin/persona.md` and write the role composition to
`.atlas/agents/realm-guide.yaml`. This repository intentionally contains no
`.atlas/` initialization from these source artifacts.

The composition remains inactive until Atlas SDK Realm Initialization supports
trusted Agent Persona validation, Agent Directive loading and precedence,
plain fallback, and full Fletcher and Weave enforcement. The three referenced
Directives are intention identifiers only; their bodies are not duplicated
here:

1. `orient-realm-users`
2. `steward-realm-knowledge`
3. `curate-realm-site`

The avatar brief calls for wholly original, self-hosted artwork. The neutral
Atlas SDK Realm sigil remains the fallback unless reviewed artwork and its
publication-rights metadata are present.

Validate the inactive source contract with:

```sh
python3 scripts/atlas_sdk_agents.py validate
```
