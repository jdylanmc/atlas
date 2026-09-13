---
name: domain-modeling
description: "Internal helper for authorized domain work. Sharpen terminology and record agreed glossaries or architecture decisions only within confirmed recording scope."
disable-model-invocation: false
user-invocable: false
---

# Domain Modeling

## Atlas integration

Read `docs/agents/domain.md` and existing repository guidance before writing.
Atlas is single-context: use the root `CONTEXT.md` and `docs/adr/`. Create or
change those files only when an actual term or decision is resolved and the
active task explicitly includes repository documentation writes.

**Entry:** internal to an authorized task under the
[invocation contract](../setup/INVOCATION.md), not a direct human command.
Before recording, establish explicit authority for the selected glossary or
decision-record destination and its writing owner. Conversation modeling alone
does not authorize files. Reuse confirmed recording scope; ask only when it
is missing or changes. Keep human decisions distinct from proposals.

Use [doctrine selection and application](../doctrine/APPLY.md), preserving caller/operator selections. With none, consider `domain`, `boundaries`, and `documentation` according to whether this work concerns executable concepts, context boundaries, or durable records. If these changes will be delivered as a PR, require `worktrees` before writing them; the existing recording gates still apply.

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `CONTEXT.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily: only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up: capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

For authorized records, use [Changelog](../changelog/SKILL.md) and return notable
entry proposals to the existing delivery owner. Serialize shared glossary,
decision, and changelog edits; do not write into an active implementer's worktree.
