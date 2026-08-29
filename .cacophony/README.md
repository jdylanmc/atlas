# Cacophony agent prompt contract

Each Atlas SDK reviewer composition has generated prompt and repository-roaster artifacts derived from one source of truth:

- `.cacophony/personas/<persona>.md` is an **Agent Persona**. Its frontmatter
  declares `atlas.agent-persona/v2`, a `persona` identifier, and
  `authority: none`; its fixed sections
  contain identity, voice, tone, demeanor, and presentation fields only. Field
  values are catalog-backed identifiers, not arbitrary prompt prose; the
  trusted validator renders their approved presentation text.
- `.cacophony/directives/<intention>.md` is an **Agent Directive**. Its
  intention-named path and frontmatter `directive` identifier are independent
  of every Persona. It declares `atlas.agent-directive/v2` and
  `authority: behavior`; its fixed sections contain objectives, responsibilities,
  evidence rules, severity, constraints, output contract, and handoffs.
  Roaster-eligible Directives must also contain `## Roast lens` immediately
  after `## Objective`; the section must contain exactly one non-empty,
  non-bullet line, projected verbatim into the generated roaster's `roast-lens`
  and `description`. Directives excluded from roaster generation, currently
  `prompt-contract-review`, omit `## Roast lens`.
- `.cacophony/compositions.json` is the reference-only Agent Composition
  layer. Each entry selects exactly one Persona and an ordered, non-empty list
  of stable Directives. Replacing a Persona changes only the `persona`
  reference; the Directive identifiers and order remain fixed.
- `.cacophony/agents/<compatibility-agent>.md` is the generated Cacophony
  prompt. It preserves existing check and report artifact identifiers, places
  the selected Persona first with no authority, and places the intention-named
  Directives afterward in precedence order with explicit generated provenance.
- `agents/<compatibility-agent>-roaster.agent.md` and
  `agents/<compatibility-agent>-roaster/{instructions,persona,directive}.md` are
  generated repository roasters for the external `roast` skill. They are derived
  from the same Persona, Directive, and Composition sources as the Cacophony
  prompt. The Persona projection remains presentation-only; the Directive
  projection carries behavior. Fletcher is intentionally excluded because its
  `prompt-contract-review` Directive reviews prompt contracts, not code change
  sets.

| Compatibility agent | Persona    | Ordered Directives                 |
| ------------------- | ---------- | ---------------------------------- |
| `bolas`             | `bolas`    | `domain-architecture-review`       |
| `smaug`             | `smaug`    | `simplicity-and-code-truth-review` |
| `balerion`          | `balerion` | `security-and-runtime-risk-review` |
| `fletcher`          | `fletcher` | `prompt-contract-review`           |

The validator is directly executable erasable TypeScript on Node.js 24. Validate
the complete contract:

```sh
node scripts/cacophony_agents.ts validate
```

After editing a component, regenerate and validate the tracked prompts and
repository roasters:

```sh
node scripts/cacophony_agents.ts sync
```

Do not edit generated prompts or roaster files directly. Repository roaster
agent files and their sibling roaster directories under `agents/` and
`.github/agents/` are generator-owned in this repository. Hand-authored
repository roasters are not supported because they would create ungoverned
reviewers outside `.cacophony`'s source of truth; `cacophony:validate` fails
closed when one is present. The reusable review worker invokes the validator
from the trusted base revision, proves that the base prompt is the
exact deterministic composition of its base Persona and Directives, and then
stages those verified base bytes over the relative workspace prompt before
passing that path to Cacophony. The pinned action independently reads the path
from the base revision. Cacophony accepts one `prompt-file`, so the generated
file is tracked to preserve its native trusted-base loader and stable
agent/report identifiers. Every trusted base must contain the TypeScript
validator; review workflows fail closed rather than falling back to prompt-only
validation. Historical `scripts/cacophony_agents.py` generator identifiers
remain in generated prompts as byte-level compatibility metadata even though
Atlas SDK no longer ships or executes the Python implementation.

Because the worker stages the active reviewer's base prompt over its workspace
path, reviewers inspect proposed `.cacophony/agents/*.md` content with
`get_diff`; `read_file` on that active generated path intentionally returns the
trusted base.

All Directives are authoritative. They apply in listed order, and a later
Directive wins a direct conflict with an earlier one. Persona presentation
never changes semantic meaning or instructions and does not apply to Concepts,
Principles, diagnostics, evidence, schemas, code, machine-consumed output, or
other authoritative artifacts.
