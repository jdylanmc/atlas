# Cacophony Prompt Review

Atlas uses Fletcher to review every new Cacophony adversary before that
adversary joins the review council.

The path-gated `pull_request_target` workflow first queries the pull request
file metadata without checking out or executing pull-request code. Fletcher
runs only when the change adds a new Markdown prompt directly under
`.cacophony/agents/`; edits, renames, and deletions do not invoke it. Fletcher
uses the `gpt-5.4-mini` deployment with a 40-turn review budget.

The reusable worker checks authorization before checkout, inspects the pull
request merge ref without executing it, loads reviewer prompts from the trusted
base commit, gives the Azure credential only to an immutable Cacophony action,
and uploads each structured report separately.

Fork pull requests fail closed; council execution is limited to branches in the
Atlas repository.

## Required repository configuration

Configure these under **Settings > Secrets and variables > Actions**:

- Secret `CACOPHONY_AZURE_API_KEY`: the Azure AI Foundry API key.
- Variable `CACOPHONY_AZURE_ENDPOINT`: the Azure AI Foundry project endpoint or
  compatible `/openai/v1` endpoint.

A reviewer introduced by a pull request begins running only after its prompt is
merged into the trusted base branch.

## Dragon council

Every pull request uses the trusted-base Dragon Council workflow. Separate jobs
perform workflow static analysis, conditional JavaScript and TypeScript CodeQL
analysis, and the root npm unit-test script when it exists. The test job has a
read-only token, no provider credential, a 15-minute limit, and executes
pull-request code only inside a resource-bounded, digest-pinned container that
does not receive GitHub runtime credentials. The container copies read-only
source into a bounded temporary filesystem. A fresh collector runner combines
the trusted step outcomes, checksum-verified Actionlint diagnostics, CodeQL
SARIF, and exact base, head, and merge revisions into one immutable artifact.

Only after collection finishes do Bolas, Smaug, and Balerion run in parallel on
the `gpt-5.4-mini` deployment with 30-turn budgets. Each receives the
static-analysis results, CodeQL SARIF, and unit-test result:

| Dragon | Lens |
| --- | --- |
| Bolas | Domain-Driven Design, ownership boundaries, and architecture |
| Smaug | Simplicity, code truth, consistency, and documentation |
| Balerion | Security, stability, concurrency, memory, and performance |

The deterministic verification check fails when an applicable analysis or test
fails. The dragons still receive failed results so their reports can explain
the relevant changed-code impact rather than losing that evidence.

After the council has been observed successfully, require these `main` ruleset
checks:

- `Deterministic verification`
- `Bolas / review`
- `Smaug / review`
- `Balerion / review`
- `Council gate`
