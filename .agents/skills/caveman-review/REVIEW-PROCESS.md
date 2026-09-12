# Atlas review process

`caveman-review` owns both the read-only analysis and the presentation of its
findings. Do not repeat a completed review under another skill name.

If a caller explicitly supplies completed, evidence-backed findings for
formatting, preserve their scope and uncertainty and go directly to the
presentation rules in [SKILL.md](SKILL.md). Otherwise perform the review below.
Incomplete evidence is a limitation to report, not a reason to manufacture
findings or claim an axis passed.

## 1. Pin the scope and base

Read root `AGENTS.md`, `docs/agents/issue-tracker.md`, and
`docs/agents/domain.md`. Resolve the supplied base to an immutable commit.
`implement` supplies its pre-edit HEAD. For a PR use its actual target branch
(`main` by default in Atlas); ask when the intended scope is unclear.

- **Committed branch/PR review:** capture `git diff <fixed-point>...HEAD` and
  `git log <fixed-point>..HEAD --oneline`.
- **Working-tree review:** capture `git diff <base-sha>` for tracked changes,
  including staged and unstaged work; list new files with
  `git ls-files --others --exclude-standard` and read relevant files separately.
  Do not stage files just to make them visible.

Use the same base and file scope for both axes below. An empty tracked diff
does not mean no work when new files exist. If the complete scope is empty,
report nothing to review.

## 2. Establish the spec

Use the current user-approved request and any originating issue, spec or
acceptance criteria. Read referenced issue bodies and relevant comments via
the configured tracker. Reconcile later maintainer decisions rather than
treating an old brief as authority over them.

When no source is supplied, look for issue references in the commits or a
matching spec under the repository's established documentation paths. Ask if
the intended spec is unclear. If none exists, report **Spec: not assessed
(no spec available)**; do not silently call it a pass.

## 3. Establish standards

Read `AGENTS.md`, any existing `CONTRIBUTING.md`, the relevant `CONTEXT.md`
terms, and architecture decisions. Preserve the deterministic SDK,
machine-installed distribution, inward import boundaries, and explicit
proposal/governance authority. A durable review finding needs an accept or
reject case in `tests/adversarial/` before it is considered resolved.

Use the following Fowler-style smells as heuristics, not mandatory refactors.
Repository standards and actual domain names take precedence. Skip issues
already enforced by tooling; do not run linters as part of this skill.

| Heuristic | Review question |
| --- | --- |
| Mysterious Name | Does the name communicate the actual domain concept? |
| Duplicated Code | Is one behavior repeated and likely to diverge? |
| Feature Envy | Does behavior belong with the data it repeatedly inspects? |
| Data Clumps | Do recurring fields represent a missing domain value? |
| Primitive Obsession | Would a domain type prevent meaningful invalid states? |
| Repeated Switches | Is repeated dispatch likely to drift across callers? |
| Shotgun Surgery | Does one change require scattered, coupled edits? |
| Divergent Change | Does one module have unrelated reasons to change? |
| Speculative Generality | Is an abstraction unsupported by actual requirements? |
| Message Chains | Must a caller navigate implementation details? |
| Middle Man | Does a wrapper add no useful contract or behavior? |
| Refused Bequest | Does an inheritance/interface relationship misrepresent the implementation? |

Label these as possible design issues and explain the evidence. Do not
present a style preference as broken behavior.

## 4. Assess both axes

- **Standards:** identify violations of documented rules, citing both the
  changed location and the rule. Distinguish hard violations from design
  heuristics.
- **Spec:** identify missing or partial requirements, unrequested behavior,
  and incorrect implementations of requested behavior. Cite the relevant
  requirement and evidence in the change.

Review directly when the evidence fits one review. Delegate only if the
active harness permits it and separate contexts are warranted. Give each
reviewer the identical evidence scope, its applicable standards/spec, and
working-tree/new-file reads when needed. Never duplicate delegated work
or recursively invoke this skill for the same objective.

## 5. Present findings

Apply the concise location/problem/fix format in [SKILL.md](SKILL.md).
Keep **Standards** and **Spec** sections distinct; one axis passing does not
cancel failures in the other. Preserve necessary architectural rationale,
evidence limitations and uncertainty even when they require a paragraph.

End with a short finding count per axis, noting any unassessed axis. Report
no actionable findings when appropriate rather than filling a template.
This skill does not fix code, run tests/linters, publish a review, approve,
request changes, stage files, commit or merge.

The review structure is adapted from
[Matt Pocock's review workflow](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/code-review/SKILL.md)
under its preserved [MIT notice](LICENSE.mattpocock).
