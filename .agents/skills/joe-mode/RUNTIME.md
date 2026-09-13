# Runtime and orchestration

Joe-mode targets GitHub Copilot and uses the actual tools exposed by the current harness. Tool names and capabilities are runtime facts, not assumptions inherited from another agent product.

## Skills and workers

- Use [Doctrine's catalog and metadata selection](../doctrine/SKILL.md) to assign standards without reading full bodies in the orchestrator. Follow [the common packet contract](../doctrine/APPLY.md): preserve scoped operator choices, add required IDs, and send work plus ID/reason/path/digest metadata. The applying sub-agent loads the full text and reports what it actually used.
- Invoke an available skill through the harness's skill tool. If the local skill is not registered and repository instructions permit direct loading, read its local `SKILL.md` and required references; do not substitute an upstream version or search a Claude plugin installation.
- Use the exposed agent-dispatch tool for bounded workers. In a Copilot session exposing `task`, `read_agent`, and `write_agent`, use those tools according to their current schemas. Other installations may expose different names or no worker support.
- Use background agents for genuinely concurrent discovery, planning, and delivery. Continue independent coordination while they work; consume notifications rather than polling for reassurance. Resume the known worker for follow-up when supported.
- Respect configured model preferences and runtime defaults. Do not hardcode model IDs, reasoning effort, or unverified context-window sizes from imported skills.
- Track work with session state/todo tools when available, otherwise a unique artifact in the session workspace or OS temporary directory. Do not create `TODO.md` in the repository as a silent fallback.

If required delegation, independent review, or monitoring is unavailable, name the missing capability and request direction for the affected path. Do not claim heavy orchestration while secretly doing every role inline, install plugins automatically, or fabricate a background worker. Other supported work can continue.

## Lifecycle

A background launch is not proof the worker started successfully. Confirm the actual agent ID/state and reconcile its first result or observation before claiming ownership transferred. Every delivery route's Shepherd handoff requires a real monitor that has observed the PR.

The controller's human-facing conversation remains available while workers run. Questions from workers are queued with their owner and affected scope. Only actual human responses can clear human-decision gates.

Use the harness's documented notification/wait contract. Some runtimes wake a controller on completion; others require an explicit event wait. Do not copy `Task`, `TodoWrite`, `/clear`, `/compact`, or another runtime's wait syntax into a tool call unless that interface actually exists.

Joe-mode is session-long, not an installed service. A board on disk does not schedule work. On runtime loss, report the observation gap when resuming, inspect surviving workers and PRs, and explicitly restart only missing ownership. Persistent services require separate authorization and verified runtime support.

## Isolation and shared resources

Give each independent writing worker its own authorized workspace. Discovery/research sources remain read-only; POC writes stay in its agreed scratch environment. Domain/ADR writers do not edit the checkout an implementer is currently using.

The selected Ship, Patch, or Refactor owner owns its delivery branch, integration queue, and nested workers. Joe-mode uses Squadron for distinct assignments and owns their non-overlapping coverage, not cherry-picks into their branches. Transfer artifacts and permissions through the owner, with one writer/integrator per shared mutable target. Serialize Changelog updates through that integrator.

Read the repository's actual worktree guidance before creating any workspace. Do not infer that being in an existing linked worktree makes it safe for several writers. Never clean up a worker's branch, worktree, or process merely because its last message said "done."

Every PR-producing lane requires `worktrees`, including domain/ADR and documentation deliveries. Route workspace operations to the owning workflow's [workspace procedure](../ship/WORKSPACE.md); doctrine selection does not create a workspace or authorize publication.

## Copilot-specific restraint

Do not create `.claude/`, `CLAUDE.md`, Claude hooks, or Claude permission configuration to make Joe-mode work. Honor any repository guidance already present, but do not privilege Claude files over the instructions the current Copilot harness actually supplies.

Provider access uses the configured GitHub CLI or Azure DevOps integration and authenticated identity. A Copilot subscription, Git author email, or an available shell is not proof of tracker permissions.

All commit-producing workers receive the [shared commit-message policy](../setup/COMMIT-STYLE.md). It applies independently of chat style, respects repository/operator requirements, and does not authorize additional Git actions. Keep it with the library; do not install it into global Copilot configuration as a side effect.

Follow [invocation and communication contracts](../setup/INVOCATION.md). Prefer
terse exact worker messages without changing the human's chat mode. Caller
restrictions still apply when the runtime ignores invocation metadata.

Preserve objective-start evidence, parent/descendant ownership, cycle state,
and deduplicated report events in existing session storage. Status Report uses
available runtime events; missing objective timing/tool counts stay unavailable.
Do not install a recorder or infer a complete fleet from a partial tool view.
