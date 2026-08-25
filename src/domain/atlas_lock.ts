import { compareCodePoints } from "./domain_support.ts";
import type { AtlasLocator } from "./atlas_locator.ts";
import type { AtlasSlug } from "./atlas_slug.ts";

export interface AtlasLockDependency {
  readonly cacheKey: string;
  readonly fetchedAt: string;
  readonly introducedByAnchorId: string;
  readonly introducedByEdgeId: string;
  readonly locator: AtlasLocator;
  readonly slug: AtlasSlug;
  readonly snapshot: string;
}

export interface AtlasLock {
  readonly dependencies: readonly AtlasLockDependency[];
}

export function createAtlasLock(
  dependencies: readonly AtlasLockDependency[],
): AtlasLock {
  return Object.freeze({
    dependencies: Object.freeze(
      [...dependencies].toSorted((left, right) =>
        compareCodePoints(left.cacheKey, right.cacheKey),
      ),
    ),
  });
}
