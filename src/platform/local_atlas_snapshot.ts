import { compareCodePoints } from "../atlas/compare_code_points.ts";
import { resolve } from "node:path";
import {
  defaultAtlasTextBudgets,
  type CapturedAtlasFile,
} from "../atlas/load_atlas_text.ts";
import type { OperationReference } from "../operations/operation_result.ts";
import { runTrustedGit, runTrustedGitBytes } from "./trusted_git.ts";
import { findGitRoot } from "./local_git_root.ts";

export interface AtlasSnapshot {
  readonly baseSnapshot: Extract<OperationReference, { readonly state: "known" }>;
  readonly capturedFiles: readonly CapturedAtlasFile[];
  readonly homeAtlas: OperationReference;
}

export interface LocalAtlasSnapshotBudgets {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
}

export const localAtlasSnapshotBudgets: LocalAtlasSnapshotBudgets = Object.freeze({
  maxFileBytes: defaultAtlasTextBudgets.maxFileBytes,
  maxFiles: 4096,
  maxTotalBytes: defaultAtlasTextBudgets.maxTotalBytes,
});

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
  budgets: LocalAtlasSnapshotBudgets = localAtlasSnapshotBudgets,
  commit = "HEAD",
): AtlasSnapshotCaptureResult {
  const root = findGitRoot(repository);
  if (root === undefined) {
    return Object.freeze({
      reason: "Atlas Snapshot capture requires a Git worktree.",
      state: "failed" as const,
    });
  }
  const hostArguments = ["-C", resolve(repository), "--no-replace-objects"];
  const revisionResult = runTrustedGit(root, [
    ...hostArguments,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${commit}^{commit}`,
  ]);
  if (revisionResult.state === "failed") {
    return Object.freeze({
      reason: "Git failed while capturing the local Atlas Snapshot.",
      state: "failed" as const,
    });
  }
  const revision = revisionResult.stdout.trim();
  const listedResult = runTrustedGit(root, [
    ...hostArguments,
    "ls-tree",
    "-rz",
    revision,
    ".atlas",
  ]);
  if (listedResult.state === "failed") {
    return Object.freeze({
      reason: "Git failed while capturing the local Atlas Snapshot.",
      state: "failed" as const,
    });
  }
  const paths: string[] = [];
  for (const entry of listedResult.stdout.split("\0").filter((entry) => entry !== "")) {
    const separator = entry.indexOf("\t");
    if (!/^100(?:644|755) blob [0-9a-f]+$/u.test(entry.slice(0, separator))) {
      return Object.freeze({
        reason: "The local Atlas Snapshot contains a non-regular file.",
        state: "failed" as const,
      });
    }
    paths.push(entry.slice(separator + 1));
  }
  if (paths.length > budgets.maxFiles) {
    return Object.freeze({
      reason: "The local Atlas Snapshot exceeded the declared file budget.",
      state: "failed" as const,
    });
  }
  const capturedFiles: CapturedAtlasFile[] = [];
  let totalBytes = 0;
  for (const path of paths.toSorted(compareCodePoints)) {
    const result = runTrustedGitBytes(root, [
      ...hostArguments,
      "show",
      `${revision}:./${path}`,
    ]);
    if (result.state === "failed") {
      return Object.freeze({
        reason: "Git failed while reading the local Atlas Snapshot.",
        state: "failed" as const,
      });
    }
    if (result.stdout.byteLength > budgets.maxFileBytes) {
      return Object.freeze({
        reason: "The local Atlas Snapshot exceeded the declared per-file budget.",
        state: "failed" as const,
      });
    }
    totalBytes += result.stdout.byteLength;
    if (totalBytes > budgets.maxTotalBytes) {
      return Object.freeze({
        reason: "The local Atlas Snapshot exceeded the declared total byte budget.",
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
