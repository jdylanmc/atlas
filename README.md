# Atlas SDK

Atlas SDK is a deterministic TypeScript package for working with an Atlas: a bounded knowledge domain rooted in an Atlas Host Directory with its records under `.atlas/`.

Today the package has these reachable command-line workflows:

- `atlas lint --machine [--atlas-host-directory PATH]` validates a Home Atlas and prints an Operation Result as JSON.
- `atlas initialize --machine [--atlas-host-directory PATH] [--resume-proposal-branch NAME]` creates or resumes an Atlas Initialization proposal in a Git-backed host directory.
- `atlas explore --machine QUERY [--atlas-host-directory PATH]` reads a Home Atlas and returns routed Explore results as JSON.
- `atlas ingest plan|reconcile --machine ...` hands out a Crawl Assignment for an approved Ingest Scope, then reconciles a returned Candidate Graph into one proposal.
- `atlas govern --machine --request PATH [--atlas-host-directory PATH]` maintains a Principle or Atlas Policy through one reviewable Atlas Proposal. The request carries explicit Maintainer approval and any semantic Policy verdict as validated input; the command never supplies approval itself, so an agent may propose but never establish governance autonomously.

Atlas SDK does not invoke a model, call a network service, or require an API key at runtime. Agentic judgment belongs to the calling agent workflow; Atlas SDK validates inputs, writes deterministic proposals, and returns Operation Results.

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

### Changelog capacity warning

Lint reports `ATLAS_CHANGELOG_NEAR_CAPACITY` when `.atlas/CHANGELOG.md` reaches
75% of the smaller of the configured Lint per-file budget and the SDK's default
snapshot per-file limit. With the default 1 MiB limit, the warning begins at
786,432 bytes (768 KiB), leaving 256 KiB before the per-file boundary.
The count uses the original captured UTF-8 bytes, including any byte-order mark,
not the decoded character count.

This is a warning, not invalidity: an otherwise valid Atlas still passes Lint
with exit 0. The Finding appears in the ordinary Lint result and handoff.
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

## Library usage

The supported public API is the package root:

```js
import { lintCommandUsage, runLintCommandOperation } from "@jdylanmc/atlas";
```

Internal source paths are not exported. Treat anything outside the package root as private implementation detail unless a future release adds it to the `exports` map.

`AtlasGovernanceRequest` is discriminated by `action`: `create`, `amend`, `retire`,
and `delete` require an `attestation`; `verify` carries none. Required presence
does not authenticate the approver or replace runtime approval validation.
Untyped CLI mutations missing the field return
`ATLAS_GOVERNANCE_APPROVAL_REQUIRED` (exit 4) before reading an Atlas snapshot;
verification requests carrying an attestation are invalid input (exit 64).
Blank, expired, mismatched, or otherwise invalid attestations still face the
existing runtime guards, including when JavaScript callers bypass TypeScript.

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
