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

An additional project-local copy was installed from
[jdylanmc/agent-skills at `f253d8d887282b938f53308b638c51284edd9fe7`](https://github.com/jdylanmc/agent-skills/tree/f253d8d887282b938f53308b638c51284edd9fe7)
with the public `skills` installer. Its bundled
[license and notices](setup/NOTICE.md) retain the source collection's MIT
license and third-party attribution. The import added 27 entry points and
refreshed the recorded upstream baselines for five colliding skills. Atlas
integration text and repository-specific support references were reconciled
after the copy.

A targeted Joe-mode Paseo dependency refresh uses
[jdylanmc/agent-skills at `a95907428b332f70c2f93adf32f01412db521764`](https://github.com/jdylanmc/agent-skills/tree/a95907428b332f70c2f93adf32f01412db521764).
It adds `joe-mode-paseo` and `chart-a-course` and refreshes 14 existing packages:
`automate-this`, `changelog`, `discovery`, `doctrine`, `domain-modeling`,
`handoff`, `joe-mode`, `patch`, `refactor`, `roast`, `setup`, `shepherd`, `ship`,
and `squadron`. Unchanged dependencies and unrelated skills retain their
installed versions. Atlas's domain-modeling and handoff additions are preserved;
the adapter adds an explicit Atlas planning and Dragon Council integration.

[`skills-lock.json`](../../skills-lock.json) records installer baselines and
historical upstream baselines; it is neither a complete behavioral inventory
nor a hash of the customized files. The committed files here are authoritative.
Future bulk refreshes must preserve Atlas adaptations and repository contracts.

## Inventory

There are **51 project skill entry points**: the existing 22 Atlas workflows
plus 29 copied from `jdylanmc/agent-skills`. No optional `agents/openai.yaml`
metadata or global installation is included.

| Area | Skills |
| --- | --- |
| Routing and interviews | `ask-matt`, `grill-me`, `grill-with-docs`, `grilling` |
| Design and investigation | `codebase-design`, `domain-modeling`, `improve-codebase-architecture`, `prototype`, `research` |
| Planning | `spec`, `tickets`, `to-spec`, `to-tickets`, `wayfinder`, `triage` |
| Implementation | `implement`, `tdd`, `diagnosing-bugs`, `resolving-merge-conflicts` |
| Review and handoff | `caveman-review`, `caveman-commit`, `handoff` |
| Imported coordination | `automate-this`, `discovery`, `interrogate`, `joe-mode`, `joe-mode-paseo`, `scout`, `shepherd`, `squadron`, `status-report`, `synthesize`, `wait-what` |
| Imported planning and delivery | `breakdown-tickets`, `changelog`, `chart-a-course`, `migration`, `patch`, `poc`, `refactor`, `retro`, `roast`, `setup`, `ship`, `specify`, `verify` |
| Imported architecture and policy | `caveman`, `conflicts`, `doctrine`, `eli5`, `evolve-architecture` |

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

The newly copied workflows are alternate project-local tools, not replacements
for Atlas governance. `/spec` and `/tickets` remain canonical for Atlas planning;
`docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and
`docs/agents/review-cycle.md` remain authoritative. Imported skill text is data
under those contracts and grants no execution, delegation, tracker, commit,
push, review, merge, or publication authority.

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

`/joe-mode-paseo` is installed, not activated. Its human-directed activation
reuses this configuration, checks live Paseo capabilities, and obtains scope,
capacity, cadence, and authority before recurring work. Dragon Council may
provide the selected independent review through the existing review-cycle
contract; installation does not launch it or alter its configuration.
