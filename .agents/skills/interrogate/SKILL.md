---
name: interrogate
description: "Internal to Discovery or Joe-mode only. Ask dependency-aware questions and obtain actual human decisions; preserve the parent conversation and recording gates."
disable-model-invocation: false
user-invocable: false
---

# Interrogate

**Entry:** only inside an authorized Discovery or Joe-mode context, under the
[invocation contract](../setup/INVOCATION.md). If another workflow needs one
clarification, it asks normally; material discovery goes through Discovery.
Return questions to the parent for the human, never simulate human answers.

Preserve the caller's [doctrine selection](../doctrine/APPLY.md). With none, use catalog metadata to choose relevant guidance only when it informs this decision; do not impose engineering doctrine on an unrelated conversation. Pass the scoped packet to any exploration or domain-recording worker. Loading doctrine does not select requirements for the human or enable recording.

## Recording

Default to a conversation-only interview: this skill does not authorize file writes merely because a repository is present.

When the user or calling workflow requests domain-model recording, call the Skill tool with "domain-modeling" and apply it as answers settle. Reuse existing domain documents; create them lazily only when there is a resolved term or a justified architectural decision to record. Preserve that skill's confirmation gates and the calling workflow's output scope. Do not invent additional documents or duplicate an already active domain-modeling session.

## Interview

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. Read accessible evidence directly for small lookups; delegate substantial independent investigation when useful and supported. Don't ask the user for facts you could inspect. A running exploration is an unsettled prerequisite, so only downstream questions wait; ask the rest of the frontier now. The _decisions_ are the user's: put each to them through the parent and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
