# Atlas SDK

Atlas SDK is a deterministic TypeScript package for working with an Atlas: a bounded knowledge domain rooted in an Atlas Host Directory with its records under `.atlas/`.

Today the package has these reachable command-line workflows:

- `atlas lint --machine [--atlas-host-directory PATH]` validates a Home Atlas and prints an Operation Result as JSON.
- `atlas initialize --machine [--atlas-host-directory PATH] [--resume-proposal-branch NAME]` creates or resumes an Atlas Initialization proposal in a Git-backed host directory.
- `atlas explore --machine QUERY [--atlas-host-directory PATH]` reads a Home Atlas and reachable connected Atlases and returns routed Explore results as JSON.
- `atlas ingest plan|reconcile --machine ...` hands out a Crawl Assignment for an approved Ingest Scope, then reconciles a returned Candidate Graph into one proposal.
- `atlas govern --machine --request PATH [--atlas-host-directory PATH]` maintains a Principle or Atlas Policy through one reviewable Atlas Proposal. The request carries explicit Maintainer approval and any semantic Policy verdict as validated input; the command never supplies approval itself, so an agent may propose but never establish governance autonomously.
- `atlas input-contract --machine NAME` describes a caller-authored JSON input without reading or changing an Atlas.

Atlas SDK does not invoke a model or require a model API key. Agentic judgment belongs to the calling agent workflow; Atlas SDK validates inputs, writes deterministic proposals, and returns Operation Results.

Connected Explore can use the network: online, it resolves reachable tracked
Atlases through Git and materializes their read-only Atlas Cache entries.
Offline, it retains usable Home Atlas knowledge and already captured tracked
Atlas context, with explicit degradation Findings and Snapshot identities.
An unreachable never-cached Atlas cannot contribute context; its first-contact
Finding requests a human decision without discarding usable local results.
Failed remote fetches or uncapturable updates preserve the last usable cache
Snapshot and its recorded fetch time. A failed first capture is not published
as a resolved dependency in Atlas Lock. Connected resolution has no per-host
approval list or aggregate network-quota gate.

Cache housekeeping warnings appear separately in `payload.maintenanceFindings`
when needed. They do not mark a current, usable Snapshot as degraded or make its
validation fail; remote unavailability and Snapshot problems still appear in
the ordinary degradation diagnostics.

If a usable published cache is missing from Atlas Lock, offline resolution
restores only that missing dependency from matching cache metadata, retaining
its original Snapshot, fetch time and introducer identities. Existing entries
are left unchanged. Online and offline resolution use the same validating Lock
boundary: malformed or unreadable records are preserved and reported, never
treated as an empty dependency list. Recovery keeps the validated prior list
without rereading it. Cache records are fully written to exclusively created
sibling files before replacement, so a failed write or replacement leaves the
original record intact. Cache-entry metadata records an adopted Snapshot
independently of Home Atlas Lock validity, so removing a malformed Lock can
recover the dependency offline from the original fetch time and introducers.
Unreadable or mismatched metadata and persistence failures produce
record-specific maintenance Findings without discarding usable knowledge.
Cleanup removes only invocation-owned unpublished files. A cleanup failure
identifies the retained file when it remains; if later staging cleanup removes
it, the maintenance Finding records that discard instead. These are sequential
record-write guarantees, not a multi-record transaction or a concurrent/crash-
durability guarantee.

## Install

Atlas SDK is intended to be consumed as the public scoped npm package `@jdylanmc/atlas` once a release is published. Until then, consumers can install a packed tarball or Git dependency built from this repository.

```sh
npm install @jdylanmc/atlas
```

Atlas SDK currently supports Node.js 24.x and npm 11.6.2.

## Command-line usage

```sh
atlas
atlas lint --machine --atlas-host-directory /path/to/home-atlas
atlas initialize --machine --atlas-host-directory /path/to/home-atlas
atlas govern --machine --request /path/to/governance-request.json --atlas-host-directory /path/to/home-atlas
```

Run `atlas` to list every available command. An omitted or unknown command returns
a failed, versioned Operation Result and names the available commands; an unknown
command also returns an `ATLAS_COMMAND_UNKNOWN` Finding naming the rejected value.
`--machine` is required for dispatched commands. Command output is
newline-terminated JSON so agents and scripts can parse it directly.

### Authoring JSON inputs

Retrieve each complete, nested input shape from the installed CLI:

```sh
atlas input-contract --machine ingest-scope
atlas input-contract --machine ingest-request
atlas input-contract --machine governance-request
```

Each returns a versioned Operation Result with `payload.contract.schema` (JSON
Schema 2020-12), `maxFileBytes`, and `guidance`. Governance also returns a
`principleExample` containing a full Markdown template and replacement-Amendment
example. No source checkout, declaration-file reading, Atlas selection, network,
or model is needed. Ingest/Governance CLI refusals link directly to these commands.
Discovery completion means documentation was returned, not that Ingest or
Governance ran or approval was granted.

The same typed definitions drive decoding and schema output. Input shape errors
are reported together under `handoff.validationState.findings`, with
newline-separated field paths in the input-invalid Finding. Missing mutation
approval retains its separate Finding; shape errors take exit 64, while missing
approval alone retains exit 4. Malformed JSON and over-budget files stop before
decoding; invalid or oversized containers report that boundary without inspecting
their children. Independent siblings still report their errors. Forbidden fields
report the prohibition, not errors in their unused contents. Unknown fields are
ignored, as before.

Identical array-field errors use lossless index ranges to avoid retaining and
printing millions of repeated messages from one small malformed document.
`items[0..3,7].field` identifies precisely indices 0, 1, 2, 3, and 7. Nested
ranges apply only when each listed parent has the same child index set.
No error-count quota or diagnostic truncation is introduced.

For irregular index sets, the shorter representation may be a hexadecimal
byte mask. `items[mask@8:55].field` selects exactly indices 8, 10, 12, and 14.
Read each pair of hex digits as one byte, least-significant bit first: bit `k`
of byte `j` selects `offset + 8*j + k`. The offset after `@` is byte-aligned;
zero bits do not select an index. Sparse storage avoids allocating a large
bitmap for isolated high indices; dense masks are rendered only when shorter
than exact ranges. Nested sets retain the same parent/child membership.
Input byte limits are not stdout limits: consumers must accommodate complete
Operation Results, including proposal payloads larger than their input.

`x-maxUtf8Bytes` is an SDK annotation for encoded UTF-8 byte length, not JSON
Schema's character-count `maxLength`. Generic validators must register that
keyword to enforce byte budgets. Shape validity is not authorization, evidence
correspondence, timestamp validity, or a successful knowledge operation; those
workflow gates still apply.

For new top-level `.atlas/principles/quality.md`, use `sdk.id: principle:quality`;
existing pages retain their captured identity. Principle bodies need canonical
`## Active truths` bullets with unique stable truth IDs and a preserved
`## Amendments` history. Number and date each Amendment and record the directing
or approving Maintainer, rationale, and change reference. Semantic replacement
invalidates the old truth and records a linked successor with a new ID.
The CLI reference includes the exact Markdown forms. Its examples are
illustrative templates, never human approval records.

### Initialization report artifacts

Successful `atlas initialize --machine` also writes two first-class outputs
beneath the selected Atlas Host Directory:

```text
.atlas-operation-workspaces/.artifacts/<proposal-branch>/readiness-report.md
.atlas-operation-workspaces/.artifacts/<proposal-branch>/lint-stamp.json
```

The Markdown Atlas Readiness Report is ready to use as a pull-request body.
It describes the actual proposal, including its draft Atlas Manifest, pending
human review, evidence, limitations, publication handoff and next action.
Capability coverage and unresolved decisions are included when the workflow
supplies them; the minimal workflow does not imply that those capabilities ran.
Initialization still does not push, open a pull request, or merge.

The Operation Handoff names both absolute file paths. They also appear in
`payload.outputArtifacts.readinessReportMarkdown` and
`payload.outputArtifacts.lintStamp`. Machine stdout remains one ordinary
Operation Result; the existing nested report and stamp remain available.
The local initialization adapter provides the same artifacts.

These files are generated Operation Workspace state, outside `.atlas/` and
outside the proposal worktree. They are ignored by Git and are not added to the
proposal commit. The JSON stamp retains exactly `lint-stamp-schema`,
`atlasCommit`, and `evidenceRevision`; it records the evidence produced by
Initialization, not a new validation or approval. Any commit change invalidates
that stamp. Semantic verdicts and the producing SDK version are not identified
by it, and deterministic evidence is reproducible only within one SDK version.

Resume reuses byte-identical artifacts without rewriting them. Conflicting
files, symbolic links, and non-file destinations are refused rather than
overwritten. Output failure returns `ATLAS_INITIALIZATION_OUTPUT_FAILED` and
exit 2, retaining the proposal, Lint evidence and resumable workflow state.
Files may already exist after a partial output failure; this is not an atomic
two-file transaction. Inspect the named output directory, preserve or explicitly
repair conflicts, and resume the proposal. Initialization does not delete
conflicting or partially written files for you.

### Explore checkpoint references

Each post-Anchor route step has a `reanchorIndex`: a zero-based reference into
the same result payload's `reanchors` array. It identifies the checkpoint
governing the hop **into** that step. The entry step omits the field. A hop
arriving at an Anchor references the preceding Anchor's checkpoint; subsequent
hops use the newly reached Anchor's checkpoint.

References are local to one response, not persistent checkpoint identities.
Connected traversal keeps Atlas and snapshot context on checkpoint records,
so identically named Anchors from different snapshots remain distinct.
Checkpoint contents, route selection and cited context are unchanged.

### Changelog capacity warning

Lint reports `ATLAS_CHANGELOG_NEAR_CAPACITY` when `.atlas/CHANGELOG.md` reaches
75% of the smaller of the configured Lint per-file budget and the SDK's default
snapshot per-file limit. With the default 1 MiB limit, the warning begins at
786,432 bytes (768 KiB), leaving 256 KiB before the per-file boundary.
The count uses the original captured UTF-8 bytes, including any byte-order mark,
not the decoded character count.

This is a warning, not invalidity: an otherwise valid Atlas still passes Lint
with exit 0. The Finding appears in the ordinary Lint result and handoff.
It does not change Explore's structural completeness, validation verdict, or
reachable results; genuine Explore degradation diagnostics remain unchanged.
Plan human-reviewed capacity maintenance that preserves history; Atlas SDK
does not rotate, archive, truncate, or enlarge capture limits automatically.
This warning does not predict remaining operation counts or prevent unrelated
total-size, file-count, or runtime failures.

### Ingest planning output

`atlas ingest plan --machine --ingest-scope /path/to/scope.json` returns a
versioned Operation Result on success and refusal, like the other commands.
Check `completion` and `disposition` before consuming its command-specific payload.
On success they are `completed` and `success`, and
`payload.crawlAssignment` contains the versioned Crawl Assignment, including
the approved Scope's boundaries, Source identity, and Approval Attestation.
Consumers of the former raw Assignment output must read this payload field
instead of the JSON root.

Completion here means **planning completed**, not Ingest completed. Planning
does not crawl a Source, read or select an Atlas, reconcile knowledge, or create
a proposal. Its handoff marks the Atlas, snapshot, changes, and review link
`not-applicable`, and directs the caller to crawl and then run
`atlas ingest reconcile`. A refusal retains its existing nonzero exit code and
Findings under `handoff.validationState.findings`; it carries no Crawl Assignment.

Reconciliation emits candidate claim and Edge context text as literal Markdown
text; Markdown syntax in those fields does not create links, formatting, HTML,
or citation markers. Ingest also records each generated Citation's ordered
Source target, normalized quoted span, and occurrence in SDK-owned page
metadata. Correspondence validation and structural Lint require the rendered
footnotes to match that metadata exactly. Atlas pages created before this
metadata existed remain valid and retain their existing structural Citation
checks.

## Library usage

The supported public API is the package root:

```js
import { lintCommandUsage, runLintCommandOperation } from "@jdylanmc/atlas";
```

Internal source paths are not exported. Treat anything outside the package root as private implementation detail unless a future release adds it to the `exports` map.

`renderAtlasReadinessReportMarkdown(report)` renders an existing
`AtlasReadinessReport` without filesystem effects. It preserves the supplied
report data; rendering does not validate a proposal or authenticate its stamp.

`AtlasGovernanceRequest` is discriminated by `action`: `create`, `amend`, `retire`,
and `delete` require an `attestation`; `verify` carries none. Required presence
does not authenticate the approver or replace runtime approval validation.
Untyped CLI mutations missing the field return
`ATLAS_GOVERNANCE_APPROVAL_REQUIRED` (exit 4) before reading an Atlas snapshot;
verification requests carrying an attestation are invalid input (exit 64).
Blank, expired, mismatched, or otherwise invalid attestations still face the
existing runtime guards, including when JavaScript callers bypass TypeScript.

Governance Retirement uses `retire` or `delete` with `{ path, content: null }`
changes to purge existing live Principles or Atlas Policies. It does not retain
a tombstone: the derived Changelog records the document paths, supplied approver,
approval instant, and caller-authored rationale; Git preserves the complete
former documents. String content remains a write, and other actions cannot remove
files. Empty live Principles are invalid. Remaining governance Edges,
Contradiction markers, and wiki or Markdown links must resolve after the purge
or proposal Lint refuses it. The target branch stays unchanged for human review.
See [Governance maintenance](docs/workflows/governance-maintenance.md).

Governance Findings are coalesced by code, path, and complete source range in
request validation, composition fragments, operation handoffs, and Finding merges.
Trusted attribution takes precedence for the same identity; at equal trust the
strongest severity wins, with the first observation retained for ties. Different
paths or locations remain distinct, including when checking for an attempted
downgrade of a trusted Finding.
Generated trusted refusals snapshot and deeply freeze their source ranges so
later caller mutations cannot change the reported identity.

## Package contents

The npm artifact ships only the compiled runtime, declaration files, `package.json`, and this README. Development fixtures, tests, local workspaces, and source-tree automation are not part of the package artifact.
