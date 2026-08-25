import type { AtlasLocator } from "./atlas_locator.ts";

export interface AtlasSlug {
  readonly value: string;
}

function slugSegment(value: string): string {
  return encodeURIComponent(value).replace(/%/gu, "-").toLowerCase();
}

export function deriveAtlasSlug(
  locator: AtlasLocator,
  defaultBranch = locator.branch,
): AtlasSlug {
  const parts = [
    slugSegment(locator.host),
    slugSegment(locator.owner),
    slugSegment(locator.repository),
  ];
  if (locator.branch !== defaultBranch) {
    parts.push(`branch-${slugSegment(locator.branch)}`);
  }
  if (locator.atlasPath !== ".") {
    for (const segment of locator.atlasPath.split("/")) {
      parts.push(slugSegment(segment));
    }
  }
  return Object.freeze({
    value: parts.filter((part) => part !== "").join("--"),
  });
}
