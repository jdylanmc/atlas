import {
  refuseAtlasRefresh,
  runAtlasRefreshOperation,
  type AtlasRefreshResult,
  type AtlasRefreshSelection,
} from "../operations/atlas_refresh_operation.ts";
import { resolveAtlasCache, type AtlasCacheResolverOptions } from "./atlas_cache.ts";
import { captureLocalAtlasExploreSnapshot } from "./local_atlas_explore.ts";
import { localAtlasSnapshotBudgets } from "./local_atlas_snapshot.ts";

export function runLocalAtlasRefresh(
  atlasHostDirectory: string,
  selection: AtlasRefreshSelection,
  options: AtlasCacheResolverOptions = Object.freeze({}),
): AtlasRefreshResult {
  const captured = captureLocalAtlasExploreSnapshot(
    atlasHostDirectory,
    localAtlasSnapshotBudgets,
  );
  if (captured.state !== "captured") {
    return refuseAtlasRefresh("ATLAS_REFRESH_CAPTURE_FAILED", captured.reason);
  }
  return runAtlasRefreshOperation({
    baseSnapshot: Object.freeze({ state: "known", reference: captured.baseSnapshot }),
    homeAtlas: Object.freeze({ state: "known", reference: "local-home-atlas" }),
    capturedFiles: captured.capturedFiles,
    selection,
    runtime: {
      refresh: (request) =>
        resolveAtlasCache(
          { ...request, forceRefresh: true, homeAtlasDirectory: atlasHostDirectory },
          options,
        ),
    },
  });
}
