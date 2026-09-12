# UI Prototype

Compare several structurally different layouts using the same synthetic data.
Use [LOGIC.md](LOGIC.md) for state transitions rather than visual design.

Atlas SDK has no application UI runtime. An Atlas Site is a read-only static
projection whose build mechanics belong to the Atlas, not the SDK. A UI
experiment must not introduce a site framework into the SDK's runtime.

## 1. Pick an isolated host

If the authorized target already has a site/page fixture, reuse its dimensions,
components, and surrounding layout in an isolated worktree. Keep existing
data and publication boundaries; use synthetic inputs rather than live data.

If there is no suitable host, use one self-contained HTML file in the approved
artifact location. Do not scaffold an application just to compare layouts.

## 2. State the question and make alternatives

Name the page, fixture inputs, and decision. Default to three variants, with
a maximum of five. Vary information hierarchy, layout, or primary affordance,
not just color and copy.

Give each variant a meaningful name. A shared header is fine, but do not share
so much layout that all options become the same design.

## 3. Add one comparison control

Use a small, clearly labeled switcher outside the design being judged:

- Previous/next controls cycle through variants.
- A label shows the active variant's name.
- In an existing site fixture, use its router's `?variant=` support if suitable.
  In standalone HTML, keep selection in memory or a local URL fragment.
- Preserve native focus and keyboard behavior. Never steal arrow keys from
  text inputs, editable content, or another control.

Keep every mutation action stubbed. Prototype controls and losing variants
stay outside the production change; a development flag alone is not approval
to ship them.

## 4. Let the user compare

Give the exact local file or approved preview command and the variant names.
Record useful combinations, such as one option's header with another's
navigation. Capture only synthetic fixtures when screenshots are requested.

## 5. Record the decision

Capture what worked, why, and what remains uncertain. Preserve all variants
as primary evidence under the artifact/branch rules in [SKILL.md](SKILL.md).
Implement an accepted production design separately with its real accessibility,
localization, publication, and testing requirements. Do not treat a visual
prototype as proof of the SDK's runtime or knowledge correctness.
