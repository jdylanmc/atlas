---
name: tickets
description: Break a plan, specification, completed Wayfinder map, or the current conversation into approved tracer-bullet implementation tickets with genuine blocking edges, then publish them to Atlas GitHub Issues. Use when the user invokes /tickets to prepare agent-grabbable implementation work without implementing it.
disable-model-invocation: true
---

# Publish implementation tickets

Turn an understood outcome into a dependency-aware set of narrow, independently verifiable implementation tickets. Each ticket must be a tracer-bullet vertical slice through every applicable layer, not a horizontal task for one layer.

Do not implement any ticket. Do not publish anything until the user explicitly approves the proposed breakdown.

## 1. Verify Atlas tracker setup

Work from the repository root.

1. Read `AGENTS.md`, `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and `CONTEXT.md`.
2. Confirm that `docs/agents/issue-tracker.md` configures GitHub Issues, the `gh` command-line interface, native sub-issues, and native issue dependencies.
3. Confirm that `gh` is installed and authenticated for the current repository.
4. Run `gh label list --limit 200 --json name --jq '.[].name'` and confirm that `ready-for-agent` exists.

If any tracker instruction is absent or incompatible, authentication is unavailable, or the label is missing, stop without creating issues or tracker metadata. Tell the user exactly:

`Run /setup-matt-pocock-skills.`

GitHub Issues is authoritative for Atlas. Do not silently fall back to local files.

## 2. Gather the complete decision context

Start with the current conversation. Resolve every reference the user supplied before drafting:

- For a specification issue, issue number, issue URL, plan issue, or other GitHub issue, run `gh issue view <number> --comments` and read its full body, labels, state, and comments.
- For a completed Wayfinder map, read its Destination, Notes, Decisions so far, Not yet specified, and Out of scope sections. Follow the linked resolution issues from Decisions so far when their full resolution is needed; do not implement from one-line map gists alone.
- For a local plan, specification path, or decision artifact, read the complete artifact and the sources it explicitly identifies as authoritative.
- When both a specification and a Wayfinder map are supplied, use the specification as implementation scope and the Wayfinder resolution issues as authoritative decision evidence. Record contradictions for the approval quiz instead of guessing.

Optionally explore the codebase when the implementation context is not already understood:

- Use the canonical Atlas vocabulary from `CONTEXT.md`; do not substitute terms the glossary explicitly avoids.
- Read relevant architecture decision records under `docs/adr/` and surface conflicts rather than overriding them.
- Inspect enough existing code and tests to identify externally observable seams, compatibility constraints, and independently verifiable slices.
- Identify directly enabling prefactoring using “make the change easy, then make the easy change.” Prefactoring must land before the work it enables and must not become unrelated cleanup.

Do not invent requirements to fill gaps. Carry unresolved scope or decision conflicts into the approval quiz.

## 3. Draft tracer-bullet slices

Create the smallest coherent set of tickets that delivers the approved scope:

1. Each ticket must deliver a complete, demoable or independently verifiable path through every applicable layer.
2. Each ticket must fit in one fresh agent context window.
3. Put necessary prefactoring first.
4. Declare only genuine blocking edges: ticket A blocks ticket B only when B cannot remain correct and independently verifiable before A is complete.
5. Keep parallel work unblocked when ordering is merely convenient.
6. Ensure work can begin from the frontier: tickets with no incomplete blockers.
7. Write acceptance criteria around external behavior and completion, not internal implementation minutiae.
8. Avoid specific file paths and code snippets. A trimmed prototype-derived decision artifact is allowed only when it communicates a settled decision more clearly than prose; identify its provenance.

Never create a combined mega-ticket. Every ticket must be agent-grabbable and independently verifiable.

### Wide refactors

Use an explicit expand-contract sequence when a change cannot safely land as ordinary vertical slices:

1. **Expand** adds the new form alongside the old and leaves the repository green.
2. **Migration batches** are sized by blast radius, are blocked by Expand, and each leaves the repository green.
3. **Contract** is blocked by every migration batch and removes the old form.

If migration batches cannot independently remain green, declare the exception clearly and propose an integration branch plus a final integrate-and-verify ticket. Do not use this exception merely to avoid finding true vertical slices.

## 4. Quiz before publishing

Present a numbered proposed breakdown. For every ticket include:

- **Title** — repository convention `type(scope): summary`
- **Blocked by** — proposed ticket numbers and titles, or `None`
- **What it delivers** — the complete observable slice

After the list:

1. Surface every unresolved scope question, architecture decision record conflict, or specification-versus-Wayfinder contradiction.
2. Ask whether the granularity is right.
3. Ask whether every blocking edge is genuine.
4. Ask whether any tickets should merge or split.

Iterate on the numbered breakdown until the user explicitly approves publication. Approval of a plan or specification is not approval to publish tickets. Never infer approval from silence or from the `/tickets` invocation itself.

## 5. Prepare approved issue bodies

For each approved ticket, use this exact section order:

```markdown
## Parent

<source specification or Wayfinder map link; omit this section when there is no parent>

## What to build

<the complete tracer-bullet outcome>

## Acceptance criteria

- <externally observable or independently verifiable completion criterion>

## Blocked by

<GitHub links to blocker issues, or `None.`>
```

Use a concise Atlas title matching:

`^(feat|fix|chore|docs|research)\([a-z0-9-]+\): .+`

Apply exactly the `ready-for-agent` label. Do not assign, milestone, project, close, rewrite, relabel, or otherwise modify a source parent issue.

## 6. Publish in dependency order

Publish only the explicitly approved revision.

1. Topologically sort the tickets so blockers are created before tickets they block. Preserve approved order among tickets that are otherwise parallel.
2. Create one GitHub issue per ticket with `gh issue create`, the approved title and body, and only `--label ready-for-agent`.
3. Record each created issue's number, URL, and numeric database `id`. The database ID is not the issue number or GraphQL node ID:

   `gh api repos/{owner}/{repo}/issues/{number} --jq .id`

4. If the source is an existing specification or Wayfinder map and the tickets are appropriately its children, add each issue as a native sub-issue without changing the parent:

   `gh api --method POST repos/{owner}/{repo}/issues/{parent-number}/sub_issues -F sub_issue_id={child-database-id}`

5. After all issues exist, add every approved native blocking edge in a second pass:

   `gh api --method POST repos/{owner}/{repo}/issues/{blocked-issue-number}/dependencies/blocked_by -F issue_id={blocker-database-id}`

Native dependency edges are canonical. The `## Blocked by` links mirror them for readability.

Do not create a combined issue, unapproved ticket, local planning file, implementation branch, commit, or pull request. Do not implement generated tickets.

## 7. Report the ticket frontier

Return:

- every created issue as its linked title;
- its native blockers, or `None`;
- the initial frontier: all created issues with no blockers;
- any publication or relationship operation that did not complete.

## Failure handling

- If evidence is missing, ask for the missing decision during the quiz; do not publish a guessed requirement.
- If the dependency graph contains a cycle, revise the proposal with the user before publication.
- If an issue creation fails, stop creating further issues. Report exactly which issues were created and the failing command; do not retry unless the output proves no duplicate issue was created.
- If a sub-issue or dependency request fails, preserve the created issues, report the failed relationship, and retry only when the operation can be shown to be absent. Never create replacement issues to repair a relationship failure.
- If the user changes scope after approval but before publication completes, stop and return to the quiz with a revised breakdown.

---

<!-- 🤖 This skill was created using the create-skill AI skill. https://github.com/gaming-microsoft/ai-skills -->
