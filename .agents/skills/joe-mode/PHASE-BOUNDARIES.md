# Phase boundaries

Use the current harness's supported context-management operations, not literal slash commands from another product. While Joe-mode is active, preserve its repository-controller identity, work board, objective start, report-event identities, human decisions, pending questions, and active Ship/Patch/Refactor/Shepherd ownership before changing context. Never clear the only controller of live work without an explicit pause or verified handoff.

This tree governs the controller's context after routing and dispatch decisions. Continuing here does not mean implementing every task inline or serializing Joe-mode's concurrent paths.

A **phase** is a chunk of work inside a session: the interrogation, the implementation, the QA. The definition is fuzzy on purpose: a phase ends when you think *"ok, we're done with that"*.

The **phase boundary** is the gap between two phases, and it is the only place this decision belongs. Mid-phase there is no decision to make: continue, or split the work that's left into subagents. Compacting mid-phase makes the agent lose the thread.

## The five options

| Option       | What it does                                                    |
| ------------ | --------------------------------------------------------------- |
| **Continue** | Stay in the session. No context switch at all.                    |
| **`/clear`** | Empty the context window and start from nothing.                  |
| **`/handoff`** | Write a portable markdown file and seed a session anywhere with it. |
| **Subagent** | Send the task to its own context window and get a report back.     |
| **`/compact`** | Compress this context and seed a fresh session with the summary.  |

## The tree

Work top to bottom at the boundary. The first **yes** wins.

**1. Can you continue in this session?** Prefer continuing when the next phase needs this conversation as a primary source and there is sufficient capacity in the actual runtime. Do not assume a fixed context-window threshold. When delegating, supply the relevant source artifacts and decisions rather than expecting a child to inherit the conversation.

**2. Is the context irrelevant to what comes next?** If no live ownership or required evidence depends on it, a supported context reset may be appropriate. Confirm the runtime's recovery behavior first; do not promise that clearing a session preserves workers or makes the old conversation resumable.

The cost of getting this wrong is one-way. Clear a *relevant* context and you lose the **why** behind what you built, and no amount of reading the diff back gets it returned.

**3. Do you need to hand off?** `/handoff` is narrow. You need it only when you are:

- swapping to a **new harness** (Copilot to another runtime),
- moving to a **new directory** or repo,
- sending the work to a **colleague**,
- or forking a side task you found **mid-phase** without derailing what you're doing.

Cross-session or machine transfer requires human direction. Within the current
authorized work, agents may hand bounded assignments to each other without
activating a new controller. Preserve the existing owner until acceptance is
confirmed; a portable document alone is not a transfer.

**4. Can a bounded worker own this phase?** Then send it to a **subagent** and leave this session available for other work. A human-facing discovery worker can return questions through Joe-mode; an independent reviewer usually needs no human steering. Delegation does not require clearing the controller's context.

**5. Otherwise, `/compact`.** Relevant context, same harness, same directory, and you need to stay in the loop: this is where the tree lands, and it lands here often. Pass it an instruction (`/compact we're going to QA this area`) so the summary keeps what the next phase needs.

`/compact` is the **default, not the first reach**. It sits at the bottom because the four questions above it are all cheaper or more precise. The failure mode when people start here is a fresh session that is confidently wrong about a decision the summary flattened.

## Primary and secondary sources

Compaction and summary-only handoffs can replace a conversation with a lossy secondary account. Delegation need not discard primary evidence: give workers the original source artifacts and aligned decision records, with a concise task brief. Treat summaries as navigation, not substitutes for the evidence they point to.

| Source                            | Information | Noise | Room to move |
| --------------------------------- | ----------- | ----- | ------------ |
| Primary (Continue)                | Full        | Lots  | Little       |
| Secondary (`/compact`, `/handoff`) | Lossy       | Less  | Lots         |

Preserve primary evidence and usable pointers before accepting a lossy context transition. Do not keep all implementation inside the controller merely to avoid summarizing its conversation.

## These are judgement calls

The questions are not objective: each has taste in it, and the same boundary can go two ways on two days. The value is in asking them **in order**, at the boundary rather than in the middle of the work.
