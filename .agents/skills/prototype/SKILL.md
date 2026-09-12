---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
---

# Prototype

A prototype is **throwaway code that answers a question**. Read `AGENTS.md`,
`docs/agents/domain.md`, and relevant architecture decisions first.

## Pick the shape

- **Logic, state transitions, or data shape:** [LOGIC.md](LOGIC.md). Use a
  small TypeScript model with focused Node tests, or a single HTML demo when
  a person needs to drive the model and see its state.
- **Visual layout:** [UI.md](UI.md). Compare structurally different variants
  using synthetic data, in an existing site fixture or self-contained HTML.

If the question or execution scope is ambiguous, ask before implementing.
Atlas SDK is not a web application or a model runtime; a prototype does not
authorize a new product surface or dependency.

## Shared rules

1. **Isolate and label it.** Use the approved session artifact location or an
   isolated worktree. When a branch is authorized, use
   `prototype/<name>` based on `origin/main`. Preserve unrelated work.
2. **Keep it trivial to run.** Prefer the existing Node.js 24.x/npm toolchain
   or one local HTML file. State the exact command or file to open. Do not add
   a frontend framework, server, or runtime dependency for convenience.
3. **Use synthetic in-memory state.** Never mutate a real Home Atlas, its
   proposals, caches, governance, or credentials for a demonstration. If Git
   or persistence is the question, agree disposable fixtures first.
4. **Stay small without hiding errors.** Avoid polish and speculative
   abstractions. Show rejected transitions and failures explicitly. Retained
   production behavior still needs normal tests and validation.
5. **Show the relevant state.** Use readable domain labels, guided scenarios,
   and stubbed actions, not private source material or live external calls.
6. **Preserve the evidence within authority.** Record the question, verdict,
   uncertainties, and exact artifact or commit. Commit, push, and issue writes
   require task authorization. Implement an accepted production outcome
   separately through normal review; do not promote prototype shortcuts,
   controls, or losing variants into `main`.
