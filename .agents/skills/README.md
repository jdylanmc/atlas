# Atlas engineering workflow skills

Repository-local, editable workflows for contributors to Atlas SDK. These are
not the Atlas SDK's distributed agent workflows or Atlas-owned skills under
`.atlas/`; they do not become part of the npm runtime.

## Sources and licenses

The imported files were copied from
[jdylanmc/notch#69](https://github.com/jdylanmc/notch/pull/69), pinned to commit
[`585b9415a5146bc206427f1c74cc9d53c39b8eb9`](https://github.com/jdylanmc/notch/tree/585b9415a5146bc206427f1c74cc9d53c39b8eb9/.agents/skills).
They were already local adaptations of:

- [mattpocock/skills at `3cca18b368ae95cdbdebbff572ccafa662551015`](https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015).
  The full [MIT notice](LICENSE), Copyright (c) 2026 Matt Pocock, is retained.
- [juliusbrussee/caveman at `15581d14007fd01fb3f132016741962f34936ca2`](https://github.com/juliusbrussee/caveman/tree/15581d14007fd01fb3f132016741962f34936ca2).
  Only the standalone review and commit-message workflows are included, not
  the runtime, engine, plugin, or SDK. Full MIT notices, Copyright (c) 2026
  Julius Brussee, remain in [caveman-review/LICENSE](caveman-review/LICENSE)
  and [caveman-commit/LICENSE](caveman-commit/LICENSE).
- The review procedure adapted from Matt's earlier workflow retains its
  additional [MIT notice](caveman-review/LICENSE.mattpocock).

This is a pinned file copy followed by an Atlas-specific merge, not an
installer-managed refresh. No installer lockfile was imported.
The existing [`skills-lock.json`](../../skills-lock.json) records historical
upstream baselines for five previously installed skills; it is neither a full
inventory nor a hash of the customized files. The committed files here are
authoritative. Do not run a bulk installer update over these adaptations.

## Inventory

There are **22 project skill entry points**: 20 retained from the imported
packet, including two aliases, plus Atlas's existing `spec` and `tickets`.
The temporary configuration workflow was used during integration and removed.
No optional `agents/openai.yaml` metadata or global installation is included.

| Area | Skills |
| --- | --- |
| Routing and interviews | `ask-matt`, `grill-me`, `grill-with-docs`, `grilling` |
| Design and investigation | `codebase-design`, `domain-modeling`, `improve-codebase-architecture`, `prototype`, `research` |
| Planning | `spec`, `tickets`, `to-spec`, `to-tickets`, `wayfinder`, `triage` |
| Implementation | `implement`, `tdd`, `diagnosing-bugs`, `resolving-merge-conflicts` |
| Review and handoff | `caveman-review`, `caveman-commit`, `handoff` |

## Routing

```text
ask-matt -> select the appropriate entry point
grill-me -> grilling
grill-with-docs -> grilling + domain-modeling
spec -> tickets -> implement
to-spec -> spec; to-tickets -> tickets
implement -> tdd + codebase-design -> caveman-review
                                   -> caveman-commit (message only)
wayfinder -> research / prototype / grilling -> spec -> tickets
triage -> incoming requests only
```

`/spec` publishes one unlabeled parent specification without another interview.
`/tickets` requires explicit approval of the breakdown before publishing
implementation tickets and native blocking edges. The imported `/to-spec`
and `/to-tickets` names invoke those canonical workflows rather than carrying
duplicate instructions or different readiness rules.

`caveman-review` owns read-only Standards/Spec analysis and concise findings;
it can also format explicitly supplied findings without repeating the review.
It neither fixes code nor publishes a review. `caveman-commit` supplies an
authorized commit's message only; the caller owns staging, committing and
pushing. Active attribution requirements take precedence over its style.

For local Roast or Dragon Council cycles, follow
[`docs/agents/review-cycle.md`](../../docs/agents/review-cycle.md).
The panel already embeds the skills' bounded read-only methods through its
canonical Directives; do not stack a duplicate standalone review on top.
Only the separate authorized driver executes test-first remediation skills.

## Atlas adaptations and setup

Read [`AGENTS.md`](../../AGENTS.md) and the existing configuration first:

- [`docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md):
  GitHub Issues in `jdylanmc/atlas`, conventional issue titles, canonical
  planning workflows, native relationships, and missing-label preflight.
- [`docs/agents/triage-labels.md`](../../docs/agents/triage-labels.md):
  five default triage roles. Setup created or applied no GitHub labels.
- [`docs/agents/domain.md`](../../docs/agents/domain.md):
  one root `CONTEXT.md` and `docs/adr/`. Existing domain decisions are preserved.

The shared skills retain the imported scope, privacy, and conditional-delegation
guards. Swift, native-app, and `pocket` branch assumptions were replaced with
Atlas's TypeScript, Node.js 24.x, npm 11.6.2, and `main` conventions. Examples
are illustrative rather than new product requirements.

Honor the deterministic, model-free SDK boundary and machine-installed
distribution decisions. Use existing typed operation seams and the Node test
runner; keep filesystem and Git effects at their existing platform boundaries.
For durable review findings, add accept/reject evidence to `tests/adversarial/`
as required by `AGENTS.md`. Do not weaken coverage or other repository gates.

Prototypes use synthetic data and an approved isolated location; they never
mutate a real Home Atlas or make UI/site tooling an SDK runtime dependency.
Readiness and scope labels do not authorize implementation, merging, release,
or changes to Atlas governance. Delegation follows the active harness's limits.

## Discovery and maintenance

Start the agent in this checkout/worktree, or reload project skills if the
harness supports it. For Copilot, `copilot skill list --json` lists discovery
metadata. Verify project source paths: names such as `handoff` can also exist
in global plugins.

Configuration is maintained directly in `docs/agents/*.md`; no bootstrap skill
is needed for ordinary use. For a future refresh, compare the exact upstream
revision in a separate worktree, preserve license notices and the Atlas-owned
planning workflows, and reapply these adaptations before opening a PR.
