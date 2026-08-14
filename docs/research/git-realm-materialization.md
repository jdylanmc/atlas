# Git Realm Materialization Strategies

Research for [Research safe Git materialization strategies for pinned Realms](https://github.com/jdylanmc/atlas/issues/16).

## Recommendation

Atlas v1 should materialize each pinned Realm as an Atlas-managed ordinary clone in a local cache. It should detach the checkout at the exact locked commit, disable hooks on every Git invocation, and create a private ref that keeps the pinned commit reachable.

Submodules should not represent the Realm graph. Worktrees cannot materialize unrelated repositories. Vendored snapshots should be an explicit exceptional mode for air-gapped or externally unstable sources. A bare object cache may later optimize repeated downloads, but dependent clones must dissociate from shared objects.

## Decision matrix

| Criterion | Ordinary clone | Bare/shared cache | Worktree | Submodule | Vendored snapshot |
| --- | --- | --- | --- | --- | --- |
| Exact commit identity | Strong | Strong | Not applicable across repositories | Strong | Requires separate metadata |
| Offline after fetch | Yes | Yes | Not applicable | Yes | Yes |
| Atlas-managed recursion | Yes | Cache only | No | Coupled to Git recursion | Yes |
| Cycle control | Atlas controls it | Not applicable | No | No native Realm-cycle policy | Atlas controls it |
| Dirty-state detection | `status` and `rev-parse` | Cache only | Strong for same repository | `submodule status` | Consumer diff |
| Reviewable pin update | Small lock diff | Small lock diff | Not applicable | Gitlink diff | Potentially large file diff |
| Repository pollution | None | None | None | `.gitmodules` and gitlinks | Full Realm content |
| v1 suitability | Recommended | Later optimization | Unsuitable | Not recommended | Exceptional mode |

## Materialization contract

For each Realm dependency, the lock state should preserve:

- Canonical Git URL.
- Branch or tag used as refresh intent.
- Full immutable commit hash used as content identity.
- Last successful retrieval time.

A safe baseline flow is:

```text
git -c core.hooksPath=/dev/null clone --no-checkout <url> <cache-path>
git -C <cache-path> -c core.hooksPath=/dev/null checkout --detach <commit>
git -C <cache-path> update-ref refs/atlas/pinned/<lock-id> <commit>
```

Every Git command issued against Realm materialization must set `core.hooksPath` to a disabled path. The Git wrapper, rather than individual callers, should own this invariant.

## Why ordinary clones

An ordinary clone retains a remote for explicit refresh, works offline after retrieval, supports direct dirty and commit checks, and leaves recursive Realm traversal to Atlas. Git documents detached checkout and revision-limited cloning directly.

Sources:

- [git-clone](https://git-scm.com/docs/git-clone)
- [git-checkout](https://git-scm.com/docs/git-checkout)
- [git-rev-parse](https://git-scm.com/docs/git-rev-parse)
- [git-status](https://git-scm.com/docs/git-status)

## Security boundary

Git hooks live in the configured hooks directory and executable hooks may run at defined Git lifecycle points. Remote hooks are not copied as active project content during a normal clone, but local state can still acquire hooks later. Disabling `core.hooksPath` on every operation provides a defense-in-depth invariant.

Sources:

- [githooks](https://git-scm.com/docs/githooks)
- [git-config: `core.hooksPath`](https://git-scm.com/docs/git-config)

Atlas must never initialize or recursively update arbitrary nested submodules, run package installation, invoke Realm scripts, or honor repository-local Git aliases and configuration as executable policy.

## Object retention

A detached commit can eventually become unreachable after a checkout advances. Git garbage collection prunes unreachable objects after its grace period. Atlas should maintain private refs such as `refs/atlas/pinned/<lock-id>` for every retained pin and remove them only through explicit cache retirement.

Sources:

- [git-gc](https://git-scm.com/docs/git-gc)
- [git-maintenance](https://git-scm.com/docs/git-maintenance)
- [git-update-ref](https://git-scm.com/docs/git-update-ref)

## Why not shared clones by default

Git warns that `--shared` clones borrow the source object store and can become corrupt when the source prunes objects they still reference. A future bare cache may be used with `--reference` only when the resulting clone uses `--dissociate`.

Source: [git-clone shared repositories and `--dissociate`](https://git-scm.com/docs/git-clone).

## Why not worktrees

Git worktrees create additional working trees attached to one repository's object database. Realms are separate repositories, so worktrees do not solve general Realm materialization.

Source: [git-worktree](https://git-scm.com/docs/git-worktree).

## Why not submodules

Submodules do pin exact commits, but they would expose Atlas's semantic Realm graph through `.gitmodules` and the consumer index. Recursive submodule behavior would also traverse repositories according to Git structure instead of Realm metadata. Atlas needs its own cycle, authorization, cache, and failure policies.

Sources:

- [git-submodule](https://git-scm.com/docs/git-submodule)
- [gitsubmodules](https://git-scm.com/docs/gitsubmodules)
- [gitmodules](https://git-scm.com/docs/gitmodules)

## Failure behavior

- If the pinned commit is already materialized, network failure must not prevent offline traversal.
- If no local materialization exists and the commit cannot be fetched, Atlas fails with a precise unavailable-Realm diagnostic.
- A missing or force-pushed commit must never cause Atlas to advance to a branch tip silently.
- Dirty or mismatched cache state must be rejected or repaired into a fresh cache location, never treated as the locked Realm.
- Recursive traversal tracks canonical `(repository, commit)` identities to terminate cycles while reusing the already materialized node.

## Cross-platform constraints

Git object identity is portable, but working-tree checkout can differ on case-insensitive filesystems and through line-ending conversion. Atlas should reject path collisions and configure checkouts to avoid host line-ending rewriting. These constraints must be validated by Windows, macOS, and Linux fixtures.
