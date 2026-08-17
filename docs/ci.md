# Cacophony Prompt Review

Atlas separates every Cacophony reviewer into an Agent Persona and an Agent
Directive. Persona files contain identity, voice, tone, demeanor, and
presentation only and declare no authority. Intention-named Directive files
contain the literal review lens, evidence and severity rules, constraints,
report contract, and handoffs. Directive identifiers never use Persona names.

`scripts/cacophony_agents.py` validates the component frontmatter, fixed section
schemas, catalog-backed Persona values, Persona/Directive content boundaries,
the stable compatibility-to-Directive-set map, and exact generated composition.
Persona source files cannot inject arbitrary prose; the trusted validator
resolves their identifiers to reviewed presentation text.
`.cacophony/compositions.json` is the reference-only Agent Composition layer.
Each compatibility composition selects exactly one Persona and an ordered,
non-empty Directive list, so Persona replacement does not rename, reorder, or
reassign review intentions. Directives are authoritative in listed order; a
later Directive wins a direct conflict with an earlier one, and every
Persona/Directive conflict resolves to the Directives.

Persona may affect only optional conversational or presentation surfaces that
the Directives permit. It never changes semantics or instructions and remains
neutral for Insights, Pillars, diagnostics, evidence, schemas, code,
machine-consumed output, and other authoritative artifacts.

The generator writes `.cacophony/agents/<compatibility-agent>.md` with explicit
composition source, generator, Directive order, and precedence metadata.
Cacophony accepts one prompt file, so these compatibility renderings remain
tracked to preserve its native trusted-base loader and stable report/check
identifiers.

The path-gated `pull_request_target` workflow runs for additions,
modifications, renames, and deletions affecting prompt components, generated
prompts, the validator, its tests, or council workflow integration. A
deterministic job loads the validator from the trusted base commit and applies
it to the proposed merge revision. Structurally valid changes then receive
Fletcher's semantic separation and prompt-quality review on the
`gpt-5.6-luna` deployment with a 40-turn budget.

The same path gate requests Fletcher review for the inactive Atlas SDK Realm
Guide sources under `docs/agents/atlas-sdk/` and their repository validator.
Those sources define presentation and reference metadata only; they do not
initialize or activate a Realm. Once the Atlas SDK validator exists in the
trusted base revision, the deterministic job loads that exact base copy and
applies it to the proposed merge revision. Its introduction uses an explicit
bootstrap notice rather than executing pull-request validator code. Validate
the local source with `python3 scripts/atlas_sdk_agents.py validate`.

The reusable worker checks authorization before checkout, inspects the pull
request merge ref without executing it, and polls the pull request API until
GitHub supplies full current base and merge revisions, failing closed after
twelve five-second attempts. It loads the validator from the trusted base
commit and proves that the selected base prompt exactly composes its base
Persona and Directives. It replaces the relative workspace prompt with those
exact verified base bytes and records their digest as a defense-in-depth path
binding. The immutable Cacophony action independently loads that same generated
prompt directly from the base commit. Only the action receives the Azure
credential, and each structured report is uploaded separately.

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

| Required check | Persona | Ordered Directives | Lens |
| --- | --- | --- | --- |
| `Bolas / review` | `bolas` | `domain-architecture-review` | Domain-Driven Design, ownership boundaries, and architecture |
| `Smaug / review` | `smaug` | `simplicity-and-code-truth-review` | Simplicity, code truth, consistency, and documentation |
| `Balerion / review` | `balerion` | `security-and-runtime-risk-review` | Security, stability, concurrency, memory, and performance |

Fletcher remains the `Fletcher / review` compatibility identity for
`prompt-contract-review`; its workflow check naming is unchanged.

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
