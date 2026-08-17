---
name: spec
description: Turn the current conversation into one implementation-ready Atlas specification and publish it as a GitHub issue without interviewing the user. Use when the user invokes /spec after discussing a feature, fix, or other implementation outcome.
disable-model-invocation: true
---

# Publish a specification

Synthesize the current conversation and repository evidence into one implementation-ready GitHub issue. Do not interview the user, ask for confirmation, invoke `/grilling`, or pause before publishing.

Do not implement the specified work. This skill produces exactly one unlabeled parent specification issue. Implementation agents work from the tracer-bullet children produced later by `/tickets`, never from the parent specification itself.

## 1. Verify repository setup

Work from the repository root.

1. Read `AGENTS.md`, `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and `CONTEXT.md`.
2. Confirm that `docs/agents/issue-tracker.md` identifies GitHub Issues as the tracker and requires the `gh` CLI.
3. Confirm that `gh` is installed, authenticated, and resolves the current GitHub repository.

If a required repository instruction is absent or incompatible, or `gh` is unavailable or unauthenticated, stop without creating or modifying tracker metadata. Report the specific missing file, incompatible instruction, command, or authentication failure and the exact remediation. Do not refer the user to an external setup skill.

## 2. Gather only relevant evidence

Explore enough of the repository to understand the current implementation and vocabulary:

- Use the canonical Atlas terms from `CONTEXT.md`; do not substitute synonyms that it explicitly avoids.
- Read architecture decision records under `docs/adr/` that touch the proposed change. Surface conflicts rather than silently overriding them.
- Inspect the highest-level relevant modules, interfaces, tests, and similar implementations.
- Use `gh issue view <number> --comments` for issues named in the conversation. Use `gh issue list` when existing issues are needed to understand prior decisions or scope.
- When the source is a completed Wayfinder map, read the map and every linked resolution needed to recover the complete decisions. The map gists are an index, not sufficient specification evidence.
- Search existing issues for overlapping or identical implementation specifications before drafting. Reuse a closed decision only as evidence; do not create a second implementation specification with the same outcome.

Treat the current conversation, repository state, domain glossary, relevant architecture decision records, and relevant GitHub issues as the complete evidence boundary. Do not invent requirements or decisions.

## 3. Decide the testing seam

Identify where external behavior can be tested with the least coupling:

1. Prefer an existing seam over adding one.
2. Prefer the highest seam that proves the requested behavior.
3. Propose a new seam only when no suitable existing seam exists.
4. Minimize the number of seams; one is ideal.

Infer the seam from the evidence and record it in **Testing Decisions**. Do not ask the user whether it matches their expectations. If the evidence cannot settle a testing choice, record the unresolved matter in **Further Notes**.

## 4. Draft the issue

Choose a concise title in the repository format `type(scope): summary`. Use a lowercase supported type and an Atlas scope from `docs/agents/issue-tracker.md`. Validate the title against:

`^(feat|fix|chore|docs|research)\([a-z0-9-]+\): .+`

Write the body with these headings in this order:

## Problem Statement

Describe the problem from the user's perspective.

## Solution

Describe the requested outcome from the user's perspective, without implementing it.

## User Stories

Write a long, numbered, implementation-covering list. Every item must use:

`1. As an <actor>, I want <feature>, so that <benefit>`

Cover primary behavior, edge cases, failure behavior, compatibility, observability, accessibility, security, migration, and operation when supported by the evidence. Do not add unsupported requirements merely to fill a category.

## Implementation Decisions

List only decisions already supported by the evidence, including affected modules or interfaces, architecture, schemas, application programming interface contracts, and interactions. Do not include file paths or code snippets because they become stale. A short prototype excerpt may be included only when it precisely records a decision; identify its provenance.

## Testing Decisions

Record the selected external-behavior seam, affected modules, expected assertions, and relevant prior testing patterns. Distinguish settled decisions from unresolved test questions.

## Out of Scope

State explicit boundaries supported by the conversation or repository evidence.

## Further Notes

Record unresolved matters, evidence gaps, relevant issue or architecture decision record references, and any implementation cautions. Do not convert unresolved matters into invented decisions.

Before publishing, verify that the issue is coherent and implementation-ready, contains every required heading, uses Atlas vocabulary, and does not claim unsupported decisions.

## 5. Publish exactly one issue

Before creation, compare the validated title with all existing issue titles from:

`gh issue list --state all --limit 1000 --json number,title,url`

If an issue with the exact title already exists, do not create another issue. Return its title and URL and explain that the duplicate guard stopped publication.

Otherwise use one `gh issue create` command with:

- the validated title;
- the complete Markdown body supplied through a heredoc or `--body-file`;
- no label, assignment, milestone, project, or other triage action.

Do not create draft issues, companion issues, subtasks, pull requests, or local planning files. Do not edit or implement the feature described by the specification.

After creation, read the created issue back and verify its exact title, every required heading, and that it has no labels. Return the issue title and URL.

## Failure handling

- If repository evidence conflicts, preserve the conflict in **Further Notes** rather than choosing a side without support.
- If the proposed issue cannot be made implementation-ready from existing evidence, publish the best supported specification and list the unresolved matters in **Further Notes**; do not ask questions.
- If the duplicate guard finds an exact existing title, return that issue instead of creating or modifying anything.
- If `gh issue create` fails, report the error and stop. Do not retry by creating a second issue unless the failure output proves that no issue was created.

---

<!-- 🤖 This skill was created using the create-skill AI skill. https://github.com/gaming-microsoft/ai-skills -->
