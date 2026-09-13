---
name: status-report
description: "Human-directed snapshot; Joe-mode may invoke after a full cycle or confirmed major-feature merge only. Report objective progress, elapsed time, own tool calls, and running descendants read-only, with explicit visibility limits."
disable-model-invocation: false
user-invocable: true
---

# Status Report

**Entry:** a human request, or Joe-mode's full-cycle/major-feature-merge event,
under the [invocation contract](../setup/INVOCATION.md). Otherwise do not invoke
automatically. The original [intent](intent.md) remains unchanged.

Produce one read-only snapshot. Do not change tickets, files, assignments,
agents, or task state, and do not advance the work. A caller may display the
snapshot and then resume its own workflow; the reporter never starts a loop.
Preserve relevant [doctrine context](../doctrine/APPLY.md) without adding a
recording or source-loading ceremony merely to report status.

## Capture the objective and cutoff

Before inspecting activity, identify the current objective and responsible
agent from the actual task context, plus its recorded start time and a snapshot
cutoff with time zone. Joe-mode supplies its controller ID, anchored objective,
known descendant ownership, start evidence, cycle/event identity, and evidence
pointers. Report that objective, not the reporter worker's short lifetime.

Use existing runtime/session records. Do not install hooks, resurrect an
archived recorder, invent event schemas, or reset the objective clock. A new
cycle, merge, report, or context compaction is not a new objective.

An objective start needs an actual task-bound timestamp. Session creation time
is usable only when evidence establishes that the objective began then. If
start or cutoff cannot be established, label it unavailable. A known later
observation may give a labeled lower bound, never an invented exact duration.

## Inspect once, within scope

Read existing progress records and the minimum live evidence needed to
distinguish complete, remaining, blocked, and in-progress work. A worker's
completion message is not proof its PR merged. For ticket references, resolve
the number **and title** together; mark an unavailable title explicitly.

Count this objective-owning agent's tool calls from its actual objective-scoped
events up to the cutoff. Exclude descendants, unrelated work in the same session,
and this snapshot's post-cutoff inspection. Do not substitute token totals,
turn counts, session-wide tool totals, or guessed counts. If events are missing,
return **unavailable**, or **at least N, partial coverage** with the known range.

Inspect the known objective-owned agent tree, including nested descendants.
Follow parent/ownership relationships, not merely a matching repository name.
Count distinct running agents and give each one's current assignment. Exclude
idle/completed agents and unrelated siblings or repository agents. Use a
complete bounded tree query when available; otherwise follow known IDs and
state any unseen descendants or runtime visibility limits. Do not repeatedly
poll, wait for completion, or message workers.

Bind observations to the cutoff where runtime history permits. Otherwise give
the live observation window and say the snapshot is not atomic. Unknown is not
zero; a visible subset is not a complete fleet count.

## Return a compact snapshot

Use the human's vocabulary; expand unfamiliar acronyms on first use. Start with
the objective in no more than three sentences, then short completed/remaining
bullets. Include:

- **Snapshot / elapsed:** timestamp and objective duration, or explicit limits.
- **Completed / remaining:** concrete outcomes, blockers, and pending decisions.
- **Tool calls:** this agent's objective-only count and coverage.
- **Running descendants:** total or partial/unavailable status, with each known
  running agent and its assignment.

Every ticket mention, including worker assignments, includes number and title.
Qualify a reference by provider/repository when needed; do not chain bare IDs.
Keep a long fleet readable by grouping common assignment context, but retain
each known running agent's identity and task. If the evidence is too incomplete
to reconstruct progress, say so rather than writing a plausible history.

Return the snapshot to the human/caller. Joe-mode owns event deduplication and
continuation; reporting neither mutates its board nor resets its objective.
