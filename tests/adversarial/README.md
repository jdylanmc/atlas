# Adversarial corpus

This directory holds permanent gate corpora for review findings. A review
finding is resolved only after this corpus has a reject or accept case that
exercises it.

`vocabulary-agreement.json` currently exercises the `vocabulary-agreement`
gate. Additions for an existing gate should be data-only edits. If a new gate is
needed, register that gate in `tests/adversarial_corpus.test.ts`, add the gate
code, and then add the corpus case that proves the review finding stays covered.

Directory-reference cases include whole and bare paths, decoded and Windows
literals, constant aliases, template/concatenation forms, Node path constructors,
shadowing, and legitimate Core Archetype/reserved-directory controls. Cycles and
bounded-analysis refusals are pinned as data rather than executing fixture code.
Partial-value cases preserve known directories around runtime hosts and filenames
without guessing unknown names. Comment and nested-literal cases prevent folding
from hiding other contract references.

Plural-prescription cases supply optional `archetypeBindings` alongside the
baseline Anchor binding. They refuse unsupported irregular, compound and
apparently regular words without guessing a directory, preserve the explicitly
supported sibilant and consonant-y spellings, and reject stale misspellings.
Directory prescriptions use the closed `directoryPlurals` table in
`src/lint/validate_vocabulary_agreement.ts`; adding a terminal word requires an
explicit spelling and a corresponding acceptance case. This is a bounded SDK
naming capability, not a general English inflector. Existing mechanical
avoidance aliases remain separate from authoritative directory prescriptions.

Changelog-capacity cases in `atlas-cli.json` generate committed UTF-8 history
with a byte-order mark at and one byte below the default warning threshold.
They require a visible warning without invalidity at the threshold, no warning
below it, unchanged history bytes and Git state after the actual CLI runs, and
successful default Git snapshot capture of the same history.
Explore runs before and after the capacity fixture is committed, requiring
unchanged reachable IDs/routes, complete structure and passed validation while
Lint retains its maintenance warning.

The `explore-ranking` cases also resolve route `reanchorIndex` references
against the emitted checkpoint table. Literal expected Anchor IDs cover the
SDK Atlas and the complete fixture's Root -> Lint Anchor -> Concept route,
including the entry step's absent reference and the incoming-hop checkpoint
at an Anchor transition. Missing, dangling, negative or incorrect references
fail the black-box CLI gate.

The `installed-consumer` gate is registered and its data validated in
`tests/adversarial_corpus.test.ts`, but its cases execute in
`tests/package_consumability.test.ts` alongside the other packing tests.
Every pack runs `prepack`, which deletes and rebuilds `dist/`; keeping all packs
in one test file prevents concurrent builds from truncating the artifact under
test. The corpus schema check is not the acceptance proof: the external consumer
must invoke installed Initialization, adopt its proposal through Git, and pass
installed Lint and Explore. Add cases to `installed-consumer.json` to extend
this gate without duplicating the installation harness.

The `cacheFailure` probe imports the installed package root in the isolated
consumer and fetches a real local Git repository with no Atlas tree. It requires
an explicit first-contact refusal, no failed dependency in Atlas Lock, and
unchanged Home Atlas bytes and Git state. Node sockets remain blocked; the probe
exercises subprocess Git transport rather than treating the socket guard as
proof about Git.

Its update case first captures a real Atlas, then commits removal of the remote
Atlas tree. The failed update and a subsequent offline retry must retain the
same captured bytes and commit, preserve metadata and Atlas Lock bytes, and
report cached-offline degradation rather than losing the usable snapshot.
The interrupted-first-contact case makes subsequent Git contact unavailable
after the first fetch. Initial resolution must retain that captured snapshot;
later offline resolutions must preserve it and report degradation.

The unrecorded-publication case fails only the Git read after a valid cache is
published, then resolves that cache offline in the installed consumer. It
requires the missing Atlas Lock dependency to be restored from the original
metadata, including the original fetch time and introducer identities, rather
than treating offline reuse as a new fetch. A repeated offline resolution must
leave the recovered Lock and metadata bytes unchanged. Source controls also
reject malformed or mismatched metadata, preserve unrelated dependencies and
report combined cleanup and repair failures through `maintenanceFindings`.

The malformed-Lock case (`BOLAS-216-R2-01`) runs both online first contact and
updates through the installed Explore Operation. Invalid objects, lists,
entries, keys and truncated JSON must retain their bytes and return usable
Home and tracked context with maintenance Findings, not knowledge degradation.
The persistence case (`BALERION-216-R2-01`) starts with an unrelated dependency
and the current dependency missing. It injects failures at Node's filesystem
boundary: a redundant read, an actual prefix write followed by failure, failed
replacement after the full sibling file is written, exclusive-creation
conflict, and failed cleanup. Original Lock and metadata bytes survive
persistence failure; successful recovery preserves both dependencies and the
original fetch time. Only invocation-owned files may be removed. Source
Operation controls additionally cover close failures, unreadable Locks, and
first-contact/update metadata persistence errors.

The `connectedExplore` probe adds cited fixture knowledge and a tracked Atlas
to the initialized consumer. A fresh external Node process imports only the
installed package root, captures committed Home bytes through Git, and composes
`runExploreOperation` with the real `resolveAtlasCache` adapter. Its existing
`resolveRemote` seam maps fixture locators to local Git repositories; no parser,
traversal, cache Snapshot, or Git result is mocked.

Before any cache exists, an unavailable first connection must still return cited
Home context with a pending human decision and no resolved Atlas Lock dependency.
After cold online resolution, a repository-local URL rewrite in that disposable
cache maps the canonical URL to the fixture transport for installed CLI runs.
Online and offline CLI/API results must preserve cited Home and tracked Concepts,
commit identities, routes and Re-anchoring. A missing never-cached connection
adds explicit first-contact degradation and a pending human decision without
losing Home or cached context or publishing the failed dependency. Each API
invocation is a fresh process; all Explore runs leave Home Git/knowledge unchanged.
This proves local Git transport behavior, not public-host authentication.

The `cleanupFailureCode` variant fetches a new tracked commit and injects only a
temporary-reference deletion failure at the existing Git write boundary. All
other Git writes remain real. It requires the updated cited context with
`valid-structured`, passed validation and no human decision, while preserving
the cleanup warning separately in `maintenanceFindings`.

The `retirement` probes establish real fixture governance in Git, then exercise
both `retire` and `delete` for Principles and Atlas Policies through the source
and installed CLIs. They require live-document purges, unchanged target branches,
complete archived bytes, what/when/who/why provenance, and preservation of the
existing proposal on repeat. Dependent Contradiction metadata and prose,
governance Edges, and active-truth wiki/Markdown links must each produce specific
refusals until the fixture dependencies are reconciled. Fixture approvals and
semantic verdicts are synthetic, not production human authorization.

Isolated identity cases cover an Edge to a nested Principle with a non-prefixed
ID, and metadata-only/prose-only Contradictions whose token also belongs to a
surviving Principle. Both actions must refuse cross-kind Policy/truth collisions
and same-truth IDs in different Principles, then purge only after reconciliation
while preserving the unrelated survivor. The reusable governance-fragment seam
consumes the same corpus identities.

Policy serialization cases preserve quoted SDK IDs and earlier Atlas-owned
`id` fields. Both actions reject verdicts for raw spelling or unrelated metadata
before effects, then accept the actual Policy's verdict and retain its complete
archive. Opaque-record cases preserve unchanged Concept/Edge examples without
promoting them into live dependencies; the fragment seam retains paired
live-page refusal controls.

`governance.json` additionally exercises retirement target, action, approval,
rationale and provenance refusals at the operation boundary. Its
`atFounding` case refuses retirement of an earlier composed founding fragment
before any filesystem effect. Its
`workspaceConflict` cases insert a real file or symlink at the filesystem write
boundary in disposable Git repositories, proving refusal cleanup preserves both
the competing path and any outside target with an inspection handoff.

The optional `readinessArtifacts` probe requires installed Initialization to
emit a complete Markdown Readiness Report and the exact three-field Lint Stamp
outside the proposal tree, with direct handoff paths and unchanged target Git
state. Resume must retain artifact bytes, inodes and modification times.
Conflicting equal-length, shorter and longer files, directories, file symlinks
and a symlinked artifact directory must fail without overwriting the original
files or outside sentinels. The shared probes also run at the source adapter.
Illustrative capability/decision data exercises the installed public Markdown
renderer and its source counterpart; it is formatting evidence, not a claim
that minimal Initialization performed composed founding or approved governance.

The optional `ingestPlan` probes exercise approved and refused Scopes through
the installed CLI before an Atlas exists. They use the same Operation Result
parser as installed Initialize, Lint, Explore, and Governance, pin the complete
Assignment payload, and require no Git or Atlas mutation. Fixture attestations
are synthetic test input, not claims of production human approval.

The `inputContracts` probes discover the input-document command from bare CLI
usage, retrieve all three complete schemas, submit malformed documents, and
require every expected field violation in one Operation Result without Atlas
or Git effects. Gapped and nested array cases ensure diagnostic compaction
does not invent errors at valid indices. After Initialization, the same
installed consumer creates a valid Principle using the emitted authoring
template and a synthetic fixture attestation; the proposal leaves its target
unchanged.

`repeatedEmptyEdges` fills the existing 1 MiB input budget and runs the installed
CLI with a test-only 256 MiB V8 heap bound. All missing Edge fields must be
represented by exact index ranges alongside the Scope errors. This guards
against retaining millions of duplicate error objects, without adding a
runtime quota or truncating diagnostics.

The same bounded consumer also checks 40,000 alternating empty-object/number
Edge pairs and a maximum-size variant. Independent diagnostic decoding proves
every even index has exactly the missing-field errors and every odd index only
the object-type error. A sparse-offset case pins hexadecimal mask byte/bit order
and zero-filled holes at both the source parser and installed CLI boundaries.

`governance-request-types.test-d.ts` is the compiler-backed governance contract
corpus. The registered test in `tests/adversarial_corpus.test.ts` compiles it
with the repository TypeScript settings, and ordinary `npm run typecheck`
includes it too. Its expected-error cases reject unapproved mutations and
attested verification; positive cases exercise approved mutations, unattested
verification, action narrowing, and the public workflow signature. Missing
expected errors fail the gate rather than silently accepting weaker types.

`governance.json` also carries data-driven `merge` and `assembly` cases executed
by `tests/governance_operation.test.ts`. They pin Finding identity, attribution
and severity precedence, distinct ranges, and deduplication at the public
request, fragment, and workflow boundaries. The merge corpus also mutates
caller-owned ranges after merging to ensure generated trusted refusal ranges
remain distinct and deeply immutable without freezing the caller's input.

The optional governance change in `installed-consumer.json` exercises one
malformed Principle through installed
`atlas govern` after Initialization and Git adoption, requiring each distinct
Finding exactly once and no proposal or target mutation.
