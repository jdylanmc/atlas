import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import type { OperationReference } from "../operations/operation_result.ts";
import { runTrustedGit, runTrustedGitBytes } from "./trusted_git.ts";

export interface AtlasSnapshot {
  readonly baseSnapshot: OperationReference;
  readonly capturedFiles: readonly CapturedAtlasFile[];
  readonly homeAtlas: OperationReference;
}

export type AtlasSnapshotCaptureResult =
  | {
      readonly snapshot: AtlasSnapshot;
      readonly state: "captured";
    }
  | {
      readonly reason: string;
      readonly state: "failed";
    };

export function captureLocalAtlasSnapshot(
  repository: string,
): AtlasSnapshotCaptureResult {
  const revisionResult = runTrustedGit(repository, ["rev-parse", "HEAD"]);
  if (revisionResult.state === "failed") {
    return Object.freeze({
      reason: "Git failed while capturing the local Atlas Snapshot.",
      state: "failed" as const,
    });
  }
  const revision = revisionResult.stdout.trim();
  const listedResult = runTrustedGit(repository, [
    "ls-tree",
    "-rz",
    "--name-only",
    revision,
    ".atlas",
  ]);
  if (listedResult.state === "failed") {
    return Object.freeze({
      reason: "Git failed while capturing the local Atlas Snapshot.",
      state: "failed" as const,
    });
  }
  const paths = listedResult.stdout
    .split("\0")
    .filter((path) => path !== "")
    .toSorted(compareCodePoints);
  const capturedFiles: CapturedAtlasFile[] = [];
  for (const path of paths) {
    const result = runTrustedGitBytes(repository, ["show", `${revision}:${path}`]);
    if (result.state === "failed") {
      return Object.freeze({
        reason: "Git failed while reading the local Atlas Snapshot.",
        state: "failed" as const,
      });
    }
    capturedFiles.push(Object.freeze({ bytes: result.stdout, path }));
  }
  return Object.freeze({
    snapshot: Object.freeze({
      baseSnapshot: Object.freeze({ reference: revision, state: "known" as const }),
      capturedFiles: Object.freeze(capturedFiles),
      homeAtlas: Object.freeze({
        reference: "local-home-atlas",
        state: "known" as const,
      }),
    }),
    state: "captured" as const,
  });
}
