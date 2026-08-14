# Continuous Integration

Atlas pull requests use deterministic static analysis plus a Cacophony council
of three adversarial reviewers.

## Deterministic verification

`.github/workflows/verification.yml` runs:

- `actionlint` with ShellCheck and Pyflakes integration for GitHub Actions
  workflows;
- CodeQL analysis for the planned JavaScript/TypeScript implementation surface.

Remote actions are pinned to immutable commit hashes. Extend this workflow when
the implementation stack adds package-level type checking, linting, or tests.
Script-based Atlas capability is not complete until its corresponding static
analysis and tests run here.

## Cacophony council

Three independent reviewers run through the trusted-base
`pull_request_target` pattern:

| Reviewer | Lens |
| --- | --- |
| Archmage | Correctness, necessary architecture, and domain ownership |
| Runekeeper | Security, untrusted content, secrets, pins, and trust boundaries |
| Seer | Cross-surface consistency among code, schemas, tests, and instructions |

Fletcher is a fourth, path-gated meta-reviewer rather than a council member. It
runs only when files under `.cacophony/agents/` change and reviews the three
wizard prompts for overlap, ambiguity, evidence quality, and token efficiency.
Fletcher uses the `gpt-5.6-luna-high` deployment with the full 20-turn review
budget; the three product reviewers use `gpt-5.4-mini`.

The reusable worker checks authorization before checkout, inspects the pull
request merge ref without executing it, loads reviewer prompts from the trusted
base commit, gives the Azure credential only to an immutable Cacophony action,
and uploads each structured report separately.

## Required repository configuration

Configure these under **Settings > Secrets and variables > Actions**:

- Secret `CACOPHONY_AZURE_API_KEY`: the Azure AI Foundry API key.
- Variable `CACOPHONY_AZURE_ENDPOINT`: the Azure AI Foundry project endpoint or
  compatible `/openai/v1` endpoint.

All three reviewers use the `gpt-5.4-mini` deployment. A reviewer introduced by
a pull request begins running only after its prompt is merged into the trusted
base branch.

After the workflows have run successfully, configure the `main` branch ruleset
to require:

- `Workflow lint`
- `CodeQL`
- `Council - Archmage / review`
- `Council - Runekeeper / review`
- `Council - Seer / review`

Do not require the council checks until the Azure secret and endpoint variable
are configured, or every pull request will be blocked by missing credentials.
