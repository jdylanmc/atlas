---
workflow: governance-maintenance
atlas-sdk-schema: 1.0.0
adr: docs/adr/0001-sdk-is-a-deterministic-library.md
---

# Governance maintenance

Use this instruction file when a Maintainer asks to create, amend, retire, or
delete, or verify a Principle or Atlas Policy.

The Atlas SDK is deterministic. Do not ask it to produce semantic judgment. When
judgment is needed, return a structured semantic verdict with cited Atlas
evidence and a Challenge. The SDK accepts only verdicts whose evidence resolves
to real Atlas locations. If the verdict and Challenge disagree, report the
disagreement as inconclusive and escalate to the Maintainer.

Governance Retirement purges the live Principle or Atlas Policy. It leaves no
tombstone or empty-truth Principle. Git history retains the complete former
document and its amendments; the Atlas Changelog records what was retired,
when, by whom, and why. Reconcile dependent relationships, truth references,
Contradictions, and governance markers before retiring their governor. If the
remaining live Atlas is invalid, full proposal Lint refuses retirement rather
than silently dropping or rewriting its dependents.

Retirement checks Edge endpoints against the removed documents' actual IDs,
including existing nested documents without a type-prefixed ID. Unqualified
Contradiction metadata and SDK-authored prose must also be reconciled when their
token belonged to a removed governor, even if a surviving Principle or Policy
uses the same token. A remaining token match is not proof of the same governor;
the SDK refuses that ambiguity rather than silently rebinding the claim.
Only classified live pages participate in these dependency checks; opaque
records containing page-shaped examples remain opaque and are preserved.

The deterministic command seam for this workflow is `atlas govern --machine
--request PATH [--atlas-host-directory PATH]`. Author the request as JSON with
the `governance-request-schema`, `action`, `subject`, the Maintainer's detached
Approval Attestation (`attestation`), the authored `changes`, the drafted
`changelog` prose, and any
semantic Policy verdict. The command validates and commits one reviewable Atlas
Proposal; it never supplies approval or a verdict itself, so an agent may propose
but never establish a Principle or Atlas Policy autonomously.
Discover the complete schema and authoring guidance with
`atlas input-contract --machine governance-request`.

## Who authors what

The request carries only knowledge and judgment; Atlas SDK derives all
bookkeeping. Do not attempt to supply a base snapshot digest, a target head, or
the operation ID — there is no field for them, and Atlas SDK reserves the
`.atlas/CHANGELOG.md` entry for itself.

| Who                | Supplies                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Maintainer (human) | the truth or rule itself, the intent, and the detached Approval Attestation naming its approver and approval instant                       |
| Agent              | the authored `changes` — page content for creation/amendment or an explicit removal for retirement — and the drafted `changelog` rationale |
| Atlas SDK          | the base snapshot digest, the target head, the Atlas Changelog entry's stable operation ID, identity derivation, and validation            |

Each authored change is `{ path, content }` against a canonical `.atlas/` path.
String `content` creates or amends a live document. For `retire` or `delete`,
every authored change instead supplies `content: null` and must target an
existing document of the selected subject: a Principle under
`.atlas/principles/` or an Atlas Policy under `.atlas/types/policy/`.
The two actions share purge behavior, but the Approval Attestation must bind
the exact action, subject, changes, rationale, and semantic verdicts sent.
Other actions cannot remove files; retirement cannot write replacement pages
or remove arbitrary Atlas files. `verify` remains read-only.

A new Principle page uses the deterministic path-derived identity, and Principle
amendment preserves the `## Amendments` history and at least one active truth.
Previously accepted empty-truth retirement pages are invalid live Principles;
use an approved purge rather than preserving such a page.
The `changelog` field is
prose only: Atlas SDK stamps it with the stable operation ID, heads it with the
approval date, and appends it to the existing Atlas Changelog. That prose must
be a single line — a Changelog entry body is one line, so a `changelog`
containing any line break is refused with `ATLAS_GOVERNANCE_INPUT_INVALID`
rather than allowed to forge additional entries and operation IDs. Atlas SDK
also derives the `.atlas/CHANGELOG.md` entry itself, so an authored change may
not target that path, nor any path that names the same file on a
case-insensitive or Win32 filesystem. If the Atlas Head
advances before the workflow's drift checks, Atlas SDK refuses the proposal.

Retirement additionally records the selected subject, canonical document paths,
and the supplied approver and approval instant in the derived Changelog entry.
Its `changelog` prose supplies the reason. Approval Attestations bind content;
they are not cryptographic signatures or proof of the human's identity.
Atlas Policy retirement still requires its cited semantic verdict and Challenge;
evidence must remain resolvable after the purge.
The verdict names the removed Policy's parsed `sdk.id`. YAML quoting and
unrelated Atlas-owned `id` fields do not change that identity; missing or
malformed targets never acquire an identity from their path or raw text.

The command changes only its reviewable Atlas Proposal, not the target branch.
For a successful mutation, the `write-change-set` effect receipt is the actual
Git tree object produced after staging the canonical Atlas Change Set. Before
commit, the trusted local adapter compares every declared write or removal with
that tree and refuses unexpected changed paths or different blob bytes. The
commit must preserve the same tree.

Verify a returned receipt independently through the proposal ref rather than
comparing two fields from the Operation Result:

```sh
git rev-parse '<proposal-branch>^{tree}'
git show '<proposal-branch>:<changed-path>'
```

The first value must equal the `write-change-set` receipt, and the second must
equal the reviewed Change Set content. This verification covers the selected
trusted local Git adapter; it does not authenticate an arbitrary replacement
runtime or turn the receipt into the separate Atlas-content identity described
by #165.

Review the deletion and provenance, then obtain the required human approval
before merging through the Atlas Host Directory's Git governance. Use
`git log -- <retired-path>` and `git show <earlier-commit>:<retired-path>` to read
the archived document without restoring a live tombstone.

An existing proposal is not overwritten by repeating the command. If a file
or symlink unexpectedly occupies a retirement target in a newly created
Operation Workspace, the command refuses and retains that workspace for human
inspection instead of deleting competing work during cleanup.

When another Atlas Proposal merges first, follow
[Rebase concurrent Atlas Proposals](concurrent-proposals.md). Rebase and fully
Lint the actual governance Proposal again; preserve every accepted knowledge
change and each stamped Atlas Changelog operation entry during conflict
resolution.
