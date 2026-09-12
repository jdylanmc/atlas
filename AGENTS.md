## Agent skills

### Issue tracker

Issues and specifications are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Incoming requests use the five default triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

Atlas SDK uses a single-context domain-documentation layout. See `docs/agents/domain.md`.

### Workflow skills

Repository-local engineering workflows live in `.agents/skills/`. See
`.agents/skills/README.md` for their sources, routing, and Atlas adaptations.
`/spec` and `/tickets` remain canonical; `/to-spec` and `/to-tickets` are aliases.
Skill recipes do not override repository contracts or grant additional write,
execution, delegation, or publication authority.

### Durable review findings

A review finding is resolved only after `tests/adversarial/` has a reject or
accept case that exercises it. Prefer data-only additions to the corpus for
existing gates.
