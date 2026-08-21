import { spawnSync } from "node:child_process";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import type { OperationReference } from "../operations/operation_result.ts";

export interface AtlasSnapshot {
  readonly baseSnapshot: OperationReference;
  readonly capturedFiles: readonly CapturedAtlasFile[];
  readonly homeAtlas: OperationReference;
}

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

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    encoding: "utf8",
    env: trustedGitEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error("Git failed while capturing the local Atlas Snapshot.");
  }
  return result.stdout;
}

export function captureLocalAtlasSnapshot(repository: string): AtlasSnapshot {
  const revision = git(repository, ["rev-parse", "HEAD"]).trim();
  const listed = git(repository, ["ls-tree", "-rz", "--name-only", revision, ".atlas"]);
  const paths = listed
    .split("\0")
    .filter((path) => path !== "")
    .toSorted(compareCodePoints);
  const capturedFiles = paths.map((path) => {
    const result = spawnSync(
      trustedGitExecutable,
      ["-C", repository, "show", `${revision}:${path}`],
      { env: trustedGitEnvironment() },
    );
    if (result.status !== 0) {
      throw new Error("Git failed while reading the local Atlas Snapshot.");
    }
    return Object.freeze({ bytes: result.stdout, path });
  });
  return Object.freeze({
    baseSnapshot: Object.freeze({ reference: revision, state: "known" as const }),
    capturedFiles: Object.freeze(capturedFiles),
    homeAtlas: Object.freeze({
      reference: "local-home-atlas",
      state: "known" as const,
    }),
  });
}
