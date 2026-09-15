# Local board helper

[RUN](RUN.md) actually calls [scripts/state.mjs](scripts/state.mjs) to serialize
bounded passes and reserve work. Node is the only dependency. This is a local
atomic-state seam, not a daemon, external API client, approval system or proof
that an agent followed the recipe. Preserve the existing Joe/lifecycle evidence
in the same board/linked packets; only the `pm` namespace is helper-owned.

Resolve the script from its installed package, not the target repo. Commands
accept the same private board path and one JSON request, returning
`{"status":"…","state":{…}}`. Failures emit a diagnostic to stderr and exit 1.
Do not publish output containing private runtime IDs. For example, after
human-approved initialization:

```sh
node /installed/skills/joe-mode-paseo/scripts/state.mjs /owned/ignored/board.json '{"op":"inspect"}'
node /installed/skills/joe-mode-paseo/scripts/state.mjs /owned/ignored/board.json '{"op":"claim","owner":"actual-run-id","reconciliation":"accessible-live-ownership-evidence"}'
```

Replace example paths/IDs with verified values. The containing directory must
already exist, be owned, ignored and accessible. All repository worktrees and
known clones must resolve this same authority; do not put an independent board
in each worktree. Other hosts need reliable shared exclusion or activation
blocks. Do not claim the helper is a distributed lock.

While this adapter owns the repository board, serialize **all** board mutations
through the helper. Workers/retained parents write only their owned receipts and
return pointers for the claimed pass to record; they must not concurrently
read/modify/write this JSON through another tool. Preserving unrelated top-level
fields does not make an unsynchronized external write safe. Adopting an existing
board or changing its legacy fields requires paused, fenced writers and explicit
custody. If another required writer cannot follow that contract, activation
blocks instead of running two persistence protocols on the same file.

## Request contract

| Operation | Required inputs beyond `op` | Result/meaning |
| --- | --- | --- |
| `init` | `config` below | `initialized` paused; identical config `existing`; differing config rejected |
| `inspect` | None | `observed`, read-only board; empty object means not initialized |
| `resume` | `human` decision reference; `schedule` observation below; heartbeat replacement requires `replacement` below | `enabled` only after actual human-authorized job verification; never called by a tick |
| `pause`, `stop` | `human`, `disposition` reference for every active child | `paused` / `stopped`; local dispatch gate first, **not** proof of external operation |
| `claim` | `owner`, `reconciliation` live ownership reference | `claimed` with new `state.pm.lease.token`, or `busy` / `paused` / `stopped` without dispatch authority |
| `recover` | `human`, exact old `token`, `fencing`, `reconciliation` | Clears only that stopped/fenced pass; preserves workers, records and mode |
| `reserve` | Lease credentials; `worker: {key, kind, coverage, packet, graph?}` | `reserved` or `reused`; kind `delivery`, `discovery`, `research`; coverage is nonempty unique qualified identities; `graph: true` reserves a delivery's parent before approved ticket publication |
| `cover` | Lease credentials; publication-group `key`, cumulative actual `coverage`, boolean `complete`, publication `evidence` | `covered`; monotonic, overlap-checked parent/child coverage, preserves original assignment and publication receipts; complete graph becomes immutable |
| `bind` | Lease credentials; `key`, `agentId`, `evidence` of actual first observation | `bound`; different bound identity rejected |
| `record` | Lease credentials; `key`, `status`, `evidence`; `receiver` for accepted | `recorded`; status `pending`, `blocked`, `observed`, `accepted`; one entry per stable operation/episode key |
| `settle` | Lease credentials; `key`, `noLiveWriters: true`, `noUntransferredDuties: true`, `evidence`, `result`, `acceptance`; Discovery also `discoveryEnded: true` | `settled`; frees capacity only after external reconciliation; preserves full result references |
| `archive` | Lease credentials; settled worker `key`, actual archive readback `evidence` | `archive-recorded`; records completed external archival, does not perform or authorize it |
| `release` | Lease credentials; preserved `result`, remaining `duties` references | `released`; appends run receipt and clears only pass ownership |

Lease credentials are `owner` and `token` from the successful claim. Old tokens
cannot mutate after release/recovery. Paused owners can preserve returns/release
but cannot reserve or bind new work. Changed operation outcomes retain prior
status/evidence/receiver references in `history`; identical observations do not
append duplicates. Keep full artifacts accessible behind those references.
Accepted records name the actual receiving observation, not a sender's assertion;
a later blocked outcome does not inherit a stale acceptance claim.

Before approved Breakdown publication, reserve the real parent identity with
`graph: true`. The initial assignment stays immutable for idempotent reservation
replay, but `cover` adds actual returned child IDs to the group's effective
coverage. Partial receipts persist across passes with `complete: false`.
Any unresolved active graph blocks new delivery reservations and bindings:
RUN must also check this before external creation, not create and then discover
that bind is rejected. Existing work and non-delivery research/Discovery continue.
After complete tracker/edge/grouping reconciliation, `cover` with `complete: true`
allows the grouped owner to bind. Dropped IDs, overlapping owners, stale tokens
and changed complete graphs fail; repeated identical receipts do not accumulate.
`cover` can preserve already-issued publication results while paused but does not
grant permission to publish more tickets or start delivery. Human-directed
abandonment still requires `settle`'s reconciled custody/result acceptance.

`config`: `id`, normalized `repository`, `commonDir`, `cwd`, `projectId`,
`workspaceId`, `humanOrigin`, `anchor`, `setupEvidence`, `authority`,
`capabilities`, `mapping`, `retirement` are nonempty strings/evidence references;
`merge` must be `human`; positive integer `capacity` defaults to **6**.
New setups explicitly save `cron`, defaulting to `*/5 * * * *`: supported values
are `* * * * *` or `*/N * * * *` for integer N from 1 to 59, using Paseo's
minute-field cron semantics. Omission preserves existing one-minute boards;
the helper never silently changes an adopted job's cadence. Other cron forms
are rejected for this bounded frequent-check recipe.
`wakeupMode` is `fresh` or `heartbeat` (omission preserves legacy fresh configs;
unknown values fail). New setup records its choice and explicit `wakeupConsent`
decision reference. Heartbeat requires that nonempty consent reference and
`pmAgentId`, the actual bound PM agent ID; a fresh config cannot contain
`pmAgentId`. Reinitializing with another mode/config is not a fallback path.
These are machine-local activation data, never committed defaults.
`schedule`: actual `id`, `cron` matching the configured value (legacy omission
means `* * * * *`), matching `cwd`, `projectId`,
`workspaceId`, `enabled: true`, `evidence` for stored readback and `observation`
for the initial actual observation. Fresh uses `kind: "schedule"` (legacy
omission accepted) and no `targetAgentId`. Heartbeat requires `kind: "heartbeat"`,
`targetAgentId` equal to `config.pmAgentId`, and nonempty `settings`: a reference
to the exact approved prompt, timezone, lifetime/run budget and runtime settings.
Read back and verify those actual settings; the helper checks reference equality,
not their external truth. Unknown kind, wrong target/mapping/cadence or unapproved
fallback fails. This is **observed state**, not parameters for `create_schedule`
or `create_heartbeat`; cwd/project/workspace are joined observations, not invented
heartbeat creation arguments. The stored `enabled` field describes the last
verified binding, not current external health after pause/deletion.

Heartbeat `claim.owner` must equal the bound actual PM agent ID, including on
diagnostic passes; fresh claims continue to use each actual fresh run owner.
Every successful claim mints a new token, even on the same agent. `release`
clears only that lease: the heartbeat PM returns/idles for its job and is **not
terminal**. Durable delivery/Discovery IDs and reservations stay intact. This
helper never launches/archives agents, creates/deletes jobs or proves recurring
delivery; those are supported runtime operations with separate observations.

### Human-only heartbeat recreation

`pause`/`stop` first closes the local gate and preserves the active lease/children.
Then the bound agent deletes its owned heartbeat through MCP and verifies complete
absence. No heartbeat pause/resume API is assumed. Uncertain deletion stays gated;
inspect/reconcile, never duplicate. A resumed heartbeat uses a **new** verified ID
on the same PM agent, not a new agent/config/board. Record human creation intent
and settings before the external call and reconcile uncertain creation.

Helper `resume` accepts that replacement only while paused/stopped, with no live
lease (old owner released or human-fenced recovery), matching existing config,
kind/target/cadence and unchanged `settings`, plus:

```json
{
  "replacement": {
    "oldId": "exact-previous-owned-heartbeat-id",
    "human": "explicit-human-recreation-decision",
    "absence": "complete-verified-old-owned-job-absence",
    "reconciliation": "current-ownership-children-scope-target-settings-evidence"
  }
}
```

These are required evidence references, not self-authenticating approval.
The caller verifies the actual human origin, complete absence and grant lifetime;
a tick cannot supply authority by inventing strings. Preserve original expiry
and remaining run budget, not a fresh grant on recreation. The helper appends
old job/replacement evidence to `pm.wakeupHistory`, preserves config/workers/
pending outcomes/run history, and rejects stale tokens. Replaying replacement,
resuming the deleted ID, changing target/settings or unproved replacement fails.
Fresh schedules retain same-ID supported pause/resume; their IDs **cannot** use
this exception. A deleted fresh job needs separately reconciled human setup.

## Failure and recovery

Each mutation exclusively creates `<board>.write-lock`, reads current state,
validates the transition and writes/fsyncs a private `<board>.next` file before
atomic rename. Readers see the previous or next complete JSON, not partial
writes. This does not promise storage power-loss durability on every filesystem.
An existing lock or leftover next file fails closed; do not retry a tight loop.

There is **no TTL**, lease extension on heartbeat delivery or automatic lock takeover. For
an abandoned pass, the human recovery owner must prove the old controller cannot
act, inspect live descendants/wakeups/partial work, preserve all results and
sequence acknowledged custody; only then call `recover` with the exact token
and accessible fencing evidence. Runtime assertions are verified by the caller,
not by this offline helper. All commands serialize, so an old token fails after
recovery, but an already-issued external operation still needs reconciliation.

An abandoned **transaction** lock or `.next` file instead needs specific
human-authorized filesystem repair after every possible writer is stopped:
preserve both candidate files, inspect which complete state committed, restore
the authoritative board and remove only those exact owned stale artifacts.
The helper deliberately has no force-unlock/TTL escape. Never delete the whole
board, erase reservations, kill unrelated processes or reinitialize to bypass
an uncertainty. Unknown/corrupt state is a blocker.

Unit/CLI tests exercise filesystem exclusion, transitions, custody records and
capacity. [SCENARIOS](SCENARIOS.md) separately covers actual runtime/agent
behavior; a passing test is not an activation receipt.
