# Logic Prototype

Explore business logic, state transitions, or data shape with a small pure
model. Use [UI.md](UI.md) when the question is visual layout.

## 1. State the question

Name the uncertain behavior and the cases that would settle it. For a
human-driven demo, show that question in a visible introduction using Atlas
domain language. Do not let a convenient fixture redefine the question.

## 2. Isolate the model

Choose the smallest suitable shape:

- A pure reducer, `(state, event) => state`.
- A discriminated union with explicit legal and rejected transitions.
- A few pure functions over immutable data.
- A small stateful module only when identity or ongoing state is the question.

Keep DOM, filesystem, Git, and external calls out of the model. Supply fixed
time, inputs, and effect results through existing typed seams. Reuse real
types only when doing so does not activate live effects.

For code-only exploration, use TypeScript and the Node test runner at the
agreed seam. A focused test must exercise the uncertain behavior, not merely
demonstrate that the model compiles.

## 3. Make a shareable demo when useful

For a person who needs to press buttons and watch state change, use one
self-contained HTML/CSS/JavaScript file. No framework, bundler, remote assets,
or server is needed. Keep its synthetic model independent of the page.

Present, in order:

1. The question and a one-line explanation.
2. Relevant state as labeled fields, with recent changes visible.
3. Free-play buttons for the available actions.
4. Guided scenarios for a happy path, an awkward sequence, and an invalid
   transition. Each starts from the same known fixture state.

Use the glossary's language, not internal variable names. Rejected operations
remain visible as rejected; do not silently discard them or fake success.
Do not embed real Source content or credentials for portability.

## 4. Hand over the evidence

Give the exact file or test command and explain what the experiment establishes.
An in-memory model does not prove Git reconciliation, filesystem behavior, or
an installed consumer workflow. Keep those gaps explicit.

## 5. Preserve the decision, not shortcuts

Follow [SKILL.md](SKILL.md) for the artifact and publication boundaries.
Preserve the prototype as primary evidence when requested. Implement approved
production behavior with the existing contracts, error handling, and regression
coverage rather than copying an exploratory model unchecked.
