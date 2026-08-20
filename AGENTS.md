## Agent skills

### Issue tracker

Issues and specifications are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

Atlas SDK uses a single-context domain-documentation layout. See `docs/agents/domain.md`.

### Durable review findings

A review finding is resolved only after `tests/adversarial/` has a reject or
accept case that exercises it. Prefer data-only additions to the corpus for
existing gates.
