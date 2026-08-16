# Cacophony Prompt Review

Atlas separates every Cacophony reviewer into an Agent Persona and an Agent
Directive. Persona files contain identity, voice, tone, demeanor, and
presentation only and declare no authority. Directive files contain the literal
review lens, evidence and severity rules, constraints, report contract, and
handoffs.

`scripts/cacophony_agents.py` validates the component frontmatter, fixed section
schemas, catalog-backed Persona values, Persona/Directive content boundaries,
and exact generated composition. Persona source files cannot inject arbitrary
prose; the trusted validator resolves their identifiers to reviewed
presentation text. It generates `.cacophony/agents/<agent>.md` with the Persona
first and the authoritative Directive last. Cacophony accepts one prompt file,
so the composition is tracked to preserve Cacophony's native trusted-base
loader and stable report identifiers.

The path-gated `pull_request_target` workflow runs for additions,
modifications, renames, and deletions affecting prompt components, generated
prompts, the validator, its tests, or council workflow integration. A
deterministic job loads the validator from the trusted base commit and applies
it to the proposed merge revision. Structurally valid changes then receive
Fletcher's semantic separation and prompt-quality review on the
`gpt-5.6-luna` deployment with a 40-turn budget.

The reusable worker checks authorization before checkout, inspects the pull
request merge ref without executing it, and polls the pull request API until
GitHub supplies full current base and merge revisions. It loads the validator
from the trusted base commit and proves that the selected base prompt exactly
composes its base Persona and Directive. It replaces the relative workspace
prompt with those exact verified base bytes and records their digest as a
defense-in-depth path binding. The immutable Cacophony action independently
loads that same generated prompt directly from the base commit. Only the action
receives the Azure credential, and each structured report is uploaded
separately.

During the one-time migration from legacy single-file prompts, a base revision
without the validator may use only its existing regular, size-bounded base
prompts. Both the reusable worker and deterministic council evidence step
validate that legacy set without executing the pull request's new validator.
Once the validator exists in the base branch, the strict composition check is
mandatory.

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
perform workflow static analysis, trusted prompt-contract validation,
conditional JavaScript and TypeScript CodeQL analysis, and the root npm
unit-test script when it exists. The test job has a read-only token, no provider
credential, a 15-minute limit, and executes pull-request code only inside a
resource-bounded, digest-pinned container that does not receive GitHub runtime
credentials. The container copies read-only source into a bounded temporary
filesystem. A fresh collector runner combines the trusted step outcomes,
checksum-verified Actionlint diagnostics, prompt-contract diagnostics, CodeQL
SARIF, and exact base, head, and merge revisions into one immutable artifact.

Only after collection finishes do Bolas, Smaug, and Balerion run in parallel on
the `gpt-5.6-luna` deployment with 30-turn budgets. Each receives the workflow
and prompt-contract results, CodeQL SARIF, and unit-test result:

| Dragon | Lens |
| --- | --- |
| Bolas | Domain-Driven Design, ownership boundaries, and architecture |
| Smaug | Simplicity, code truth, consistency, and documentation |
| Balerion | Security, stability, concurrency, memory, and performance |

The deterministic verification check fails when an applicable analysis or test
fails. It directly needs Static analysis and Unit tests and evaluates their
normalized current outputs; it does not consume a transitive aggregate from the
evidence collector. This keeps failed-job and partial reruns ordered behind the
producer jobs and prevents a reused collector output from deciding the gate.
The dragons still receive failed results so their reports can explain the
relevant changed-code impact rather than losing that evidence.

Each run retains `dragon-council-evidence` plus separate
`cacophony-bolas`, `cacophony-smaug`, and `cacophony-balerion` report artifacts
for audit and diagnosis.

After the council has been observed successfully, require these `main` ruleset
checks:

- `Deterministic verification`
- `Bolas / review`
- `Smaug / review`
- `Balerion / review`
- `Council gate`
