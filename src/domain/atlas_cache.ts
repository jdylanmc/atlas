import { sha256Hex } from "./domain_support.ts";
import type { AtlasLocator } from "./atlas_locator.ts";
import type { AtlasSlug } from "./atlas_slug.ts";

export interface AtlasCache {
  readonly cacheKey: string;
  readonly locator: AtlasLocator;
  readonly slug: AtlasSlug;
}

export function atlasCacheKey(locator: AtlasLocator): string {
  return sha256Hex(
    JSON.stringify([locator.canonicalRepository, locator.branch, locator.atlasPath]),
  );
}

export function createAtlasCache(locator: AtlasLocator, slug: AtlasSlug): AtlasCache {
  return Object.freeze({
    cacheKey: atlasCacheKey(locator),
    locator,
    slug,
  });
}
