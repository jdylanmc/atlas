import { spawnSync } from "node:child_process";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import type { OperationReference } from "../operations/operation_result.ts";

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

type GitCaptureResult =
  | {
      readonly reason: string;
      readonly state: "failed";
    }
  | string;

const trustedGitExecutable = "/usr/bin/git";

function trustedGitEnvironment(): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: "/nonexistent",
    NODE_V8_COVERAGE: process.env["NODE_V8_COVERAGE"],
    PATH: "/usr/bin:/bin",
    XDG_CONFIG_HOME: "/nonexistent",
  };
}

function git(repository: string, args: readonly string[]): GitCaptureResult {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    encoding: "utf8",
    env: trustedGitEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return Object.freeze({
      reason: "Git failed while capturing the local Atlas Snapshot.",
      state: "failed" as const,
    });
  }
  return result.stdout;
}

function isCaptureFailure(
  result: GitCaptureResult,
): result is Extract<GitCaptureResult, { readonly state: "failed" }> {
  return typeof result !== "string";
}

export function captureLocalAtlasSnapshot(
  repository: string,
): AtlasSnapshotCaptureResult {
  const revisionResult = git(repository, ["rev-parse", "HEAD"]);
  if (isCaptureFailure(revisionResult)) {
    return revisionResult;
  }
  const revision = revisionResult.trim();
  const listedResult = git(repository, [
    "ls-tree",
    "-rz",
    "--name-only",
    revision,
    ".atlas",
  ]);
  if (isCaptureFailure(listedResult)) {
    return listedResult;
  }
  const paths = listedResult
    .split("\0")
    .filter((path) => path !== "")
    .toSorted(compareCodePoints);
  const capturedFiles: CapturedAtlasFile[] = [];
  for (const path of paths) {
    const result = spawnSync(
      trustedGitExecutable,
      ["-C", repository, "show", `${revision}:${path}`],
      { env: trustedGitEnvironment() },
    );
    if (result.status !== 0) {
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
