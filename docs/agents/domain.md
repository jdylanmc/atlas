# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** - read architecture decision records that touch the area you're about to work in.

If either location doesn't exist, proceed silently. The `/domain-modeling` skill creates these files lazily when terms or decisions are resolved.

## File structure

Atlas uses a single-context layout:

```text
/
|-- CONTEXT.md
|-- docs/
|   `-- adr/
`-- src/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept isn't in the glossary, reconsider whether the term belongs to the project or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing architecture decision record, surface the conflict explicitly rather than silently overriding it.
