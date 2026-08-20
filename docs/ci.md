# Cacophony Prompt Review

Atlas SDK separates every Cacophony reviewer into an Agent Persona and an Agent
Directive. Persona files contain identity, voice, tone, demeanor, and
presentation only and declare no authority. Intention-named Directive files
contain the literal review lens, evidence and severity rules, constraints,
report contract, and handoffs. Directive identifiers never use Persona names.

`scripts/cacophony_agents.ts` validates the component frontmatter, fixed section
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
neutral for Concepts, Principles, diagnostics, evidence, schemas, code,
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

The same path gate requests Fletcher review for the inactive SDK Atlas
Guide sources under `docs/agents/atlas-sdk/`. Those sources define presentation
and reference metadata only; they do not initialize or activate an Atlas. The
standalone `node scripts/atlas_sdk_agents.ts validate` command is a local
repository check, not a trusted runtime or Continuous Integration schema
loader; canonical Framework validation remains deferred with activation.

## Node.js and repository quality contract

Atlas SDK repository tooling uses directly executable, erasable TypeScript on
Node.js 24. The root package contract pins:

- Node.js `>=24.0.0 <25`, with workflows using Node.js `24.13.0`;
- npm `11.6.2` through `packageManager`, `engines`, `.npmrc`, and the committed
  npm lockfile; and
- exact development dependency versions, with lifecycle scripts disabled
  during installation.

From a clean checkout, install reproducibly and run the complete local gate:

```sh
npm ci --ignore-scripts
npm run ci
```

`npm run ci` performs deterministic Prettier checks, type-aware ESLint flat
configuration, strict TypeScript checking with `erasableSyntaxOnly`, fail-closed
Node.js test-runner coverage, glossary and contract vocabulary agreement,
byte-exact Cacophony prompt validation, and Actionlint `1.7.7`.
The Actionlint launcher also pins ShellCheck `0.11.0`, disables Python-based
Pyflakes integration, downloads only the assets for the current supported
platform and architecture, and verifies their release checksums before
execution.

Focused commands are `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm run test:coverage`, `npm run test:unit`,
`npm run atlas-sdk:validate`, `npm run vocabulary:validate`,
`npm run cacophony:validate`, and `npm run workflow:lint`. Use
`npm run cacophony:sync` only after editing a Persona, Directive, or composition
reference.

## Glossary and contract vocabulary agreement

`CONTEXT.md` is the authoritative domain glossary, and `src/domain/core_archetype.ts`
declares the Vocabulary Binding each Core Archetype term carries into SDK-owned
contracts: its `.atlas/` directory name, page type, page-ID prefix, and
diagnostic code stem. `npm run vocabulary:validate` reports every disagreement
between the two as a trusted `sdk-core.vocabulary-agreement` Finding, so a
rename on either side fails the gate instead of shipping silently.

The check binds identifiers and contracts rather than prose. It reads the
declared bindings, `ATLAS_*` diagnostic codes, `.atlas/` directory references,
page-ID prefixes, and the Finding messages SDK-owned sources declare; an
identifier or diagnostic word must be a glossary term or a reviewed structural
word, and a term listed under an `_Avoid_` line may never appear as a live
identifier. Ordinary English usage of a word that happens to match a domain term
raises nothing, because comments and lower-case prose are never vocabulary
evidence.

Product TypeScript under `src/` participates in formatting, linting, strict type
checking, tests, vocabulary agreement, and the existing 100% product coverage
gate.
ESLint mechanically enforces the settled inward source dependency order from
`domain` through `interfaces`, including keeping Node.js built-ins out of the
application core.

Coverage uses `--all` over every SDK-owned tooling source under
`scripts/**/*.ts`, so an unimported tool remains visible instead of disappearing
from the report. The current tooling floors are 78% statements and lines, 68%
branches, and 93% functions. A separate `src/**/*.ts` product gate is part of
`npm run ci` with a 100% threshold. It is empty before the first product slice,
then automatically enforces issue #76's requirement for every Atlas SDK-authored
TypeScript product file introduced under `src/`.

The TypeScript validator imports only Node.js built-ins. A trusted workflow
copies that one file from the pull request base commit and executes it with
Node.js 24; it never installs dependencies from the pull request revision.
Static analysis likewise loads the Actionlint launcher from the trusted base
instead of executing the pull request's copy. SDK-owned repository tooling no
longer requires Python.

The reusable worker checks authorization before checkout, inspects the pull
request merge ref without executing it, and polls the pull request API until
GitHub supplies full current base and merge revisions, failing closed after
twelve five-second attempts. It installs the pinned Node.js runtime, loads the
single dependency-free TypeScript validator from the trusted base commit, and
proves that the selected base prompt exactly composes its base Persona and
Directives. It replaces the relative workspace prompt with those exact verified
base bytes and records their digest as a defense-in-depth path binding. The
immutable Cacophony action independently loads that same generated prompt
directly from the base commit. Only the action receives the Azure credential,
and each structured report is uploaded separately.

The TypeScript validator is mandatory in every trusted base revision. The
reusable worker and deterministic council evidence step fail closed if it
cannot be materialized from the base commit; neither falls back to prompt-only
validation. The historical Python generator path remains embedded in generated
prompt provenance solely to preserve their established bytes.

Fork pull requests fail closed; council execution is limited to branches in the
Atlas SDK repository.

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
JavaScript and TypeScript CodeQL analysis, and the complete root `npm run ci`
gate. The test job has a read-only token, no provider credential, a 15-minute
limit, and executes pull-request code only inside a resource-bounded,
digest-pinned Node.js `24.13.0` container that does not receive GitHub runtime
credentials. The container copies read-only source into a bounded temporary
filesystem and installs exactly from `package-lock.json` with lifecycle scripts
disabled. A fresh collector runner combines the trusted step outcomes,
checksum-verified Actionlint diagnostics, prompt-contract diagnostics, CodeQL
SARIF, and exact base, head, and merge revisions into one immutable artifact.

The package intentionally exposes the complete gate as `scripts.ci` rather than
the npm `test` lifecycle alias. The trusted workflow always copies source
without preserving read-only checkout metadata, installs the lockfile with
lifecycle scripts disabled, and runs `npm run ci`. A missing or invalid package
contract fails the job rather than skipping validation. Pull-request workflow
changes cannot alter that execution because `pull_request_target` always loads
its workflow from the trusted base.

Only after collection finishes do Bolas, Smaug, and Balerion run in parallel on
the `gpt-5.6-luna` deployment with 30-turn budgets. Each receives the workflow
and prompt-contract results, CodeQL SARIF, and unit-test result:

| Required check      | Persona    | Ordered Directives                 | Lens                                                         |
| ------------------- | ---------- | ---------------------------------- | ------------------------------------------------------------ |
| `Bolas / review`    | `bolas`    | `domain-architecture-review`       | Domain-Driven Design, ownership boundaries, and architecture |
| `Smaug / review`    | `smaug`    | `simplicity-and-code-truth-review` | Simplicity, code truth, consistency, and documentation       |
| `Balerion / review` | `balerion` | `security-and-runtime-risk-review` | Security, stability, concurrency, memory, and performance    |

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
