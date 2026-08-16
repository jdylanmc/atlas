# Cacophony agent prompt contract

Each Atlas reviewer has three tracked artifacts:

- `.cacophony/personas/<agent>.md` is an **Agent Persona**. Its frontmatter
  declares `atlas.agent-persona/v1` and `authority: none`; its fixed sections
  contain identity, voice, tone, demeanor, and presentation fields only. Field
  values are catalog-backed identifiers, not arbitrary prompt prose; the
  trusted validator renders their approved presentation text.
- `.cacophony/directives/<agent>.md` is an **Agent Directive**. Its frontmatter
  declares `atlas.agent-directive/v1` and `authority: behavior`; its fixed
  sections contain objectives, responsibilities, evidence rules, severity,
  constraints, output contract, and handoffs.
- `.cacophony/agents/<agent>.md` is the generated Cacophony prompt. It places
  the Persona first, gives it no authority, and places the Directive last with
  explicit behavioral precedence.

Validate the complete contract:

```sh
python3 scripts/cacophony_agents.py validate
```

After editing a component, regenerate and validate the tracked prompts:

```sh
python3 scripts/cacophony_agents.py sync
```

Do not edit generated prompts directly. The reusable review worker invokes the
validator from the trusted base revision, proves that the base prompt is the
exact deterministic composition of its base Persona and Directive, and then
stages those verified base bytes over the relative workspace prompt before
passing that path to Cacophony. The pinned action independently reads the path
from the base revision. Cacophony accepts one `prompt-file`, so the generated
file is tracked to preserve its native trusted-base loader and stable
agent/report identifiers. The migration bootstrap may use only a validated
legacy prompt already present in a base revision that predates the validator;
it never executes validator code from the pull request.

Because the worker stages the active reviewer's base prompt over its workspace
path, reviewers inspect proposed `.cacophony/agents/*.md` content with
`get_diff`; `read_file` on that active generated path intentionally returns the
trusted base.

## Staged intention-identifier migration

The trusted validator accepts both the current version 1 one-to-one layout and
the version 2 composition-map layout. This compatibility must land before
Directive files can move to intention-named paths because pull request checks
always execute the validator from the base revision.

Each version 2 composition contains reference metadata only: exactly one
Persona identifier and an ordered, non-empty `directives` list. Directives are
authoritative in listed order, with later Directives specializing earlier ones;
the Persona never changes semantics or applies to authoritative artifacts.

The version 2 stable mapping is:

| Compatibility agent | Stable Directive |
| --- | --- |
| `bolas` | `domain-architecture-review` |
| `smaug` | `simplicity-and-code-truth-review` |
| `balerion` | `security-and-runtime-risk-review` |
| `fletcher` | `prompt-contract-review` |
