import type { Finding } from "./finding.ts";
import {
  parseAtlasLocator,
  type AtlasLocator,
  type AtlasLocatorParseResult,
} from "./atlas_locator.ts";
import { deriveAtlasSlug, type AtlasSlug } from "./atlas_slug.ts";

export interface TrackedAtlas {
  readonly declarationId: string;
  readonly defaultBranch: string;
  readonly locator: AtlasLocator;
  readonly slug: AtlasSlug;
  readonly title: string;
}

export type TrackedAtlasParseResult =
  | { readonly state: "invalid"; readonly findings: readonly Finding[] }
  | { readonly state: "tracked"; readonly trackedAtlas: TrackedAtlas };

const attribution = Object.freeze({
  checkId: "sdk-core.tracked-atlas",
  kind: "sdk-core" as const,
  trusted: true as const,
});

function finding(code: string, message: string, path: string): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "error" as const,
  });
}

interface TrackedAtlasObjectLike {
  readonly id: string;
  readonly page: {
    readonly atlas: Readonly<Record<string, unknown>>;
  };
  readonly path: string;
  readonly title: string;
  readonly type: string;
}

function locatorRecord(
  object: TrackedAtlasObjectLike,
): AtlasLocatorParseResult | undefined {
  const atlas = object.page.atlas;
  const repositoryLocator = atlas["locator"];
  const branch = atlas["branch"];
  const atlasPath = atlas["path"];
  if (
    typeof repositoryLocator !== "string" ||
    typeof branch !== "string" ||
    typeof atlasPath !== "string"
  ) {
    return undefined;
  }
  return parseAtlasLocator({ atlasPath, branch, repositoryLocator }, object.path);
}

export function parseTrackedAtlas(
  object: TrackedAtlasObjectLike,
): TrackedAtlasParseResult {
  if (object.type !== "tracked-atlas") {
    return Object.freeze({
      findings: Object.freeze([
        finding(
          "ATLAS_CROSS_EDGE_TARGET_MISMATCH",
          "Cross-Atlas traversal requires a tracked-atlas declaration target.",
          object.path,
        ),
      ]),
      state: "invalid" as const,
    });
  }
  const parsedLocator = locatorRecord(object);
  if (parsedLocator === undefined) {
    return Object.freeze({
      findings: Object.freeze([
        finding(
          "ATLAS_INGEST_SOURCE_MARKER_INVALID",
          "TrackedAtlas declaration must carry locator, branch, and path strings.",
          object.path,
        ),
      ]),
      state: "invalid" as const,
    });
  }
  if (parsedLocator.state === "invalid") {
    return parsedLocator;
  }
  const defaultBranch =
    typeof object.page.atlas["default-branch"] === "string"
      ? object.page.atlas["default-branch"]
      : parsedLocator.locator.branch;
  const slug = deriveAtlasSlug(parsedLocator.locator, defaultBranch);
  if (object.id !== `tracked-atlas:${slug.value}`) {
    return Object.freeze({
      findings: Object.freeze([
        finding(
          "ATLAS_CROSS_EDGE_TARGET_MISMATCH",
          "Cross-Atlas Edge target must match the tracked Atlas declaration it names.",
          object.path,
        ),
      ]),
      state: "invalid" as const,
    });
  }
  return Object.freeze({
    state: "tracked" as const,
    trackedAtlas: Object.freeze({
      declarationId: object.id,
      defaultBranch,
      locator: parsedLocator.locator,
      slug,
      title: object.title,
    }),
  });
}
