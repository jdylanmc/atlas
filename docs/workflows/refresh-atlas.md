# Refresh tracked Atlases

Atlas Refresh changes generated Atlas Cache and Atlas Lock state, not
committed knowledge. It creates no Atlas Proposal and never executes tracked
code, checks, or agent instructions.

Choose exactly one selector:

```sh
atlas refresh --machine --all --atlas-host-directory PATH
atlas refresh --machine --atlas-slug SLUG --atlas-host-directory PATH
```

`PATH` is a Home Atlas Host Directory; the default is the current directory.
Use the deterministic Atlas Slug from the committed TrackedAtlas declaration.
An omitted selector, conflicting selectors, duplicate options, or malformed
arguments produce a versioned usage refusal before effects.

Refresh captures the Home Atlas at Git `HEAD`, validates its structure, and
selects committed declarations. Uncommitted declaration edits do not alter the
selection and are left untouched. Each declaration needs a genuine Anchor
gateway; refresh never invents an introducer to populate Atlas Lock.

`--all` includes all declarations in that Home Snapshot, not recursively
discovered declarations in remote Atlases. Multiple declarations for one
normalized Atlas Locator share one refresh and one fixed Snapshot. Expand is
a separate workflow.

Both selectors bypass freshness windows. A successful fetch adopts the
declared branch's exact commit without merging histories. An unreachable
remote or unusable update retains the last usable cached Snapshot and its
successful fetch record. After a failed fetch, a Git reference advertisement
distinguishes an unadvertised selected branch from an unreachable repository;
the former produces `ATLAS_CROSS_ATLAS_BRANCH_MISSING`. This observation is
not proof of deletion: the remote may also hide the branch.

The JSON Operation Result includes selection, per-declaration states and
Snapshots, ordinary Findings, maintenance Findings, and the standard Operation
Handoff. `refreshed` means the fetch produced capturable bytes, not that remote
knowledge or remote checks were semantically approved. Subsequent Explore
still validates that context.

Cached-offline results remain usable and visibly degraded. An unavailable
first contact has no Snapshot and requests a human decision. Malformed
declarations and missing gateways fail their entries without contacting those
remotes. Healthy entries in the same valid Home Snapshot can still refresh.
Invalid Home structure and unknown selectors stop before refresh effects.

Exit codes: `0` for success, including usable cached fallback; `1` for a
completed batch containing failed entries; `2` when the operation could not
start; `64` for command syntax errors. Inspect `maintenanceFindings` separately:
a cache housekeeping failure does not invalidate usable context.

Automation can call package-root `runLocalAtlasRefresh` for the same local
workflow, or `runAtlasRefreshOperation` with captured Home bytes and a typed
refresh runtime. The runtime supplies effects; selection, gateway validation,
Locator deduplication, Findings, and result semantics remain SDK-owned.
