# Atlas SDK is installed on the machine; an Atlas carries no framework

The repository held two unreconciled answers to "how does a Home Atlas get Atlas SDK?"
`README.md` said the installed npm package is the supported path, while issue #91 required
"an assembled Framework Release" and `CONTEXT.md` tied the trust axis to `sdk-core`
arriving "from the pinned Framework Release." Both halves were partly built, so neither
claim failed loudly enough to be noticed. We decided Atlas SDK is an npm-distributed
library installed on the operator's machine, whose commands are a gateway into managing
that machine's `.atlas/` directories. Atlas SDK is to `.atlas/` what `git` is to `.git/`.

The contradiction survived as long as it did because portability had been attached to the
wrong noun. The assembled-release model read "portable" as *the runtime must travel as
committed bytes*, which is why it vendored a complete copy of the SDK into every Atlas.
But the thing that must outlive the tool is the knowledge, and it already does: `.atlas/`
is plain Markdown with YAML frontmatter in Git, and Degraded Explore is specified to fall
back to "raw `.atlas/` Markdown." An Atlas is readable by any agent with a filesystem
whether or not Atlas SDK was ever installed. Once portability sits on the Atlas, the tool
is free to be an ordinary machine-scoped dependency, and the reason to commit six
megabytes of runtime into every adopter's repository disappears.

## Considered options

The rejected alternative is half-built in the tree, so it needs recording or someone will
finish it. `scripts/framework_bundle.ts` really does assemble a portable bundle with a
per-file SHA-256 inventory, vendored dependencies, and license evidence, and
`scripts/framework_bootstrap.ts` really does verify that bundle and run every command from
it. What never existed was an install path: a bundle could be assembled and verified but
never placed into an Atlas, and the `installed` state that `initialize_operation.ts`
models is unreachable from every production code path, produced only by a hand-built test
fixture. Measured, an installed bundle is 2,609 files and 6,698,444 bytes, against Lint
capture budgets of 4,096 files and 16 MiB — so an Atlas would have spent roughly
two-thirds of its file budget on the framework before recording a single Concept.

## Consequences

**Three terms leave the domain glossary.** Framework Bundle, Framework Release, and
Framework Release Manifest are engineering fundamentals that npm already names; they were
domain vocabulary only because the rejected model made them artifacts an Atlas contained.
They are removed rather than tombstoned, because an `_Avoid_` line means "we have this
concept and call it something else," and there is no Atlas word for a release manifest.
Framework Upgrade is removed with them. All four are bound or recorded in
`src/domain/contract_vocabulary.ts` and enforced by `npm run vocabulary:validate`, so the
glossary, the bindings, and the code move in one commit or the gate fails.

**`.atlas/framework/` is deleted, and Atlas Manifest replaces it.** The directory held one
four-line record announcing that a Framework Bundle was not installed, which is a status
placard for a feature that is now never arriving. In its place the Atlas Manifest — already
defined in `CONTEXT.md` and until now unimplemented — becomes the single declaration of the
schema an Atlas targets. It must be legible to an SDK that does not yet understand the
schema it names, so its format cannot itself be governed by that schema.

**Compatibility is asymmetric, and backward compatibility becomes a standing obligation.**
An SDK at or above an Atlas's schema must work completely; after `1.0`, every later version
understands every earlier Atlas. An SDK below it maps the fields it can, reads the version
from its fixed location, warns, and continues in a degraded capacity rather than refusing —
then tells the operator how to update. Nothing migrates, because nothing is left behind.
This is the direct cost of a machine-scoped install: two people on one repository can run
different versions against the same `.atlas/`, and the SDK, not the Atlas, absorbs that.
The obligation is gated by the append-only schema fixtures, which stop being a testing
nicety and start being the proof.

**Upgrade stops being a governed workflow.** Issues #89 and #90 specified migration graphs,
atomic replacement, rollback edges, and recommendation automation — all of which presumed a
pinned artifact inside the Atlas and a need to migrate. Both presumptions are gone.
Upgrading is `npm update`, and the governed proposal that would have wrapped it has nothing
left to propose.

**Issue #75's user story 32 is contradicted and must be amended.** It requires a Framework
Bundle to run "without host package installation, runtime dependency fetching, or a global
Atlas SDK installation," and a machine-installed SDK is precisely the last of those. Its
problem statement survives intact: that text forbids knowledge depending on a central
registry, and npm is a package registry, not the Atlas registry exclusion X4 rules out.
