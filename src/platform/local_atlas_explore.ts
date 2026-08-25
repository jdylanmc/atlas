import { lstatSync, type Stats } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import type { Finding } from "../domain/finding.ts";
import {
  runExploreOperation,
  type ExploreOperationResult,
} from "../operations/explore_operation.ts";
import type { AtlasCacheResolverRequest } from "../operations/connected_atlas_explore.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationReference,
} from "../operations/operation_result.ts";
import { resolveAtlasCache } from "./atlas_cache.ts";
import { captureAtlasTree } from "./atlas_tree_capture.ts";

// The shared Atlas tree capture primitive retains Explore's bounded batch Git
// object reads ("cat-file" in --batch-check and ["cat-file", "--batch"]),
// so this local adapter still refuses per-file object reads.
import {
  runTrustedGit,
  runTrustedGitBytesWithInput,
  runTrustedGitWithInput,
} from "./trusted_git.ts";

interface LocalAtlasExploreBudgets {
  readonly maxContextCharacters: number;
  readonly maxEdges: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxObjects: number;
  readonly maxQueryCharacters: number;
  readonly maxResults: number;
  readonly maxRouteEdges: number;
  readonly maxTerms: number;
  readonly maxTotalBytes: number;
}

export type LocalExploreTextGitRunner = typeof runTrustedGit;
export type LocalExploreBatchTextGitRunner = typeof runTrustedGitWithInput;
export type LocalExploreBatchBytesGitRunner = typeof runTrustedGitBytesWithInput;
export type LocalExploreStatReader = (
  path: string,
  options: { readonly throwIfNoEntry: false },
) => Stats | undefined;

export interface LocalAtlasExploreCaptureOptions {
  readonly readBatchBytes?: LocalExploreBatchBytesGitRunner;
  readonly readBatchText?: LocalExploreBatchTextGitRunner;
  readonly readStat?: LocalExploreStatReader;
  readonly readText?: LocalExploreTextGitRunner;
}

export type LocalExploreCaptureResult =
  | {
      readonly baseSnapshot: string;
      readonly capturedFiles: readonly CapturedAtlasFile[];
      readonly state: "captured";
    }
  | {
      readonly reason: string;
      readonly state: "missing" | "oversized" | "too-many-files" | "unreadable";
    };

const exploreOperationIdentity = Object.freeze({
  kind: "explore" as const,
  subject: "local-home-atlas" as const,
});

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.atlas-explore-command",
  kind: "sdk-core" as const,
  trusted: true as const,
});

function exploreFinding(code: string, message: string): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path: ".atlas",
    severity: "error" as const,
  });
}

function unknownReference(reason: string): OperationReference {
  return Object.freeze({ reason, state: "unknown" as const });
}

function notCompletedLocalExploreResult(
  code: string,
  message: string,
  summary: string,
  recommendedNextAction: string,
  options: {
    readonly baseSnapshotReason: string;
    readonly degraded: boolean;
    readonly homeAtlasReason: string;
  },
): ExploreOperationResult {
  const finding = exploreFinding(code, message);
  const payload = Object.freeze({
    degradation: Object.freeze({
      diagnostics: Object.freeze([finding]),
      level: "blocked" as const,
      remediation: recommendedNextAction,
    }),
    reanchors: Object.freeze([]),
    results: Object.freeze([]),
  });
  const handoff = Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: unknownReference(options.baseSnapshotReason),
    degradationState: Object.freeze({
      reason: summary,
      state: options.degraded ? ("degraded" as const) : ("not-degraded" as const),
    }),
    homeAtlas: unknownReference(options.homeAtlasReason),
    operation: exploreOperationIdentity,
    proposedChanges: Object.freeze({
      reason: "Explore is read-only and proposes no Atlas Change Set.",
      state: "not-applicable" as const,
    }),
    recommendedNextAction,
    result: Object.freeze({ disposition: "failed" as const, summary }),
    reviewLink: Object.freeze({
      reason: "Explore did not create an Atlas Proposal.",
      state: "not-applicable" as const,
    }),
    unresolvedHumanDecisions: Object.freeze({
      state: "none" as const,
      summary: "No human decision is required to interpret this Explore result.",
    }),
    validationState: Object.freeze({
      findings: Object.freeze([finding]),
      state: "not-completed" as const,
    }),
  });
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "not-completed" as const,
    disposition: "failed" as const,
    handoff,
    operation: exploreOperationIdentity,
    payload,
  });
}

function missingAtlasResult(message: string): ExploreOperationResult {
  return notCompletedLocalExploreResult(
    "ATLAS_EXPLORE_ATLAS_NOT_FOUND",
    message,
    "No Atlas was found in the selected Atlas Host Directory.",
    "Run Explore from an Atlas Host Directory or pass --atlas-host-directory with one that contains .atlas/.",
    {
      baseSnapshotReason:
        "Explore command selected an Atlas Host Directory with no .atlas directory.",
      degraded: false,
      homeAtlasReason:
        "Explore command selected an Atlas Host Directory with no .atlas directory.",
    },
  );
}

function oversizedAtlasResult(message: string): ExploreOperationResult {
  return notCompletedLocalExploreResult(
    "ATLAS_EXPLORE_ATLAS_TOO_LARGE",
    message,
    "Explore command input exceeded its byte budget before it could be read.",
    "Reduce the committed Atlas Snapshot to the supported byte budget, then retry Explore.",
    {
      baseSnapshotReason: "Explore refused an oversized Git-backed Atlas Snapshot.",
      degraded: false,
      homeAtlasReason: "Explore refused an oversized Atlas Host Directory.",
    },
  );
}

function tooManyAtlasFilesResult(message: string): ExploreOperationResult {
  return notCompletedLocalExploreResult(
    "ATLAS_EXPLORE_ATLAS_TOO_MANY_FILES",
    message,
    "Explore command input exceeded its file-count budget before file reads.",
    "Reduce the committed Atlas Snapshot to the supported file-count budget, then retry Explore.",
    {
      baseSnapshotReason:
        "Explore refused a Git-backed Atlas Snapshot with too many files.",
      degraded: false,
      homeAtlasReason: "Explore refused an Atlas Host Directory with too many files.",
    },
  );
}

function unreadableAtlasResult(message: string): ExploreOperationResult {
  return notCompletedLocalExploreResult(
    "ATLAS_EXPLORE_ATLAS_UNREADABLE",
    message,
    "Explore could not capture the Atlas files.",
    "Retry Explore in a healthy Git worktree with readable committed Atlas files; if it repeats, escalate the operation failure.",
    {
      baseSnapshotReason: "Explore could not capture a Git-backed Atlas Snapshot.",
      degraded: true,
      homeAtlasReason: "Explore could not read the selected Atlas Host Directory.",
    },
  );
}

function repositoryPath(root: string, absolutePath: string): string {
  const path = relative(root, absolutePath).split(sep).join("/");
  return path === "" ? "." : path;
}

function findGitRoot(
  start: string,
  readStat: LocalExploreStatReader,
): string | undefined {
  let current = resolve(start);
  for (;;) {
    const gitPath = resolve(current, ".git");
    const stat = readStat(gitPath, { throwIfNoEntry: false });
    if (stat !== undefined) return current;
    const next = dirname(current);
    if (next === current) return undefined;
    current = next;
  }
}

function git(
  run: LocalExploreTextGitRunner,
  repository: string,
  args: readonly string[],
): string | undefined {
  const result = run(repository, args);
  return result.state === "succeeded" ? result.stdout.trim() : undefined;
}

export function captureLocalAtlasExploreSnapshot(
  atlasHostDirectory: string,
  budgets: LocalAtlasExploreBudgets,
  options: LocalAtlasExploreCaptureOptions = Object.freeze({}),
): LocalExploreCaptureResult {
  const readStat = options.readStat ?? lstatSync;
  const readText = options.readText ?? runTrustedGit;
  const readBatchText = options.readBatchText ?? runTrustedGitWithInput;
  const readBatchBytes = options.readBatchBytes ?? runTrustedGitBytesWithInput;
  const host = resolve(atlasHostDirectory);
  const atlasRoot = resolve(host, ".atlas");
  let atlasStat;
  try {
    atlasStat = readStat(atlasRoot, { throwIfNoEntry: false });
  } catch {
    return Object.freeze({
      reason: "Atlas .atlas directory could not be inspected.",
      state: "unreadable" as const,
    });
  }
  if (atlasStat === undefined || !atlasStat.isDirectory()) {
    return Object.freeze({
      reason: "Atlas Host Directory does not contain a .atlas directory.",
      state: "missing" as const,
    });
  }
  const root = findGitRoot(host, readStat);
  if (root === undefined) {
    return Object.freeze({
      reason: "Explore requires the Atlas Host Directory to be inside a Git worktree.",
      state: "unreadable" as const,
    });
  }
  const revision = git(readText, root, ["rev-parse", "HEAD"]);
  if (revision === undefined || revision === "") {
    return Object.freeze({
      reason: "Git failed while capturing the local Atlas Snapshot.",
      state: "unreadable" as const,
    });
  }
  const hostPath = repositoryPath(root, host);
  const atlasPath = hostPath === "." ? ".atlas" : `${hostPath}/.atlas`;
  const captured = captureAtlasTree(root, revision, atlasPath, hostPath, budgets, {
    readBatchBytes,
    readBatchText,
    readText,
  });
  if (captured.state !== "captured") return captured;
  return Object.freeze({
    baseSnapshot: revision,
    capturedFiles: captured.capturedFiles,
    state: "captured" as const,
  });
}

export function localAtlasCacheResolver(atlasHostDirectory: string) {
  return Object.freeze({
    resolve: (request: AtlasCacheResolverRequest) =>
      resolveAtlasCache({
        homeAtlasDirectory: atlasHostDirectory,
        introducedByAnchorId: request.introducedByAnchorId,
        introducedByEdgeId: request.introducedByEdgeId,
        trackedAtlas: request.trackedAtlas,
      }),
  });
}

export function runLocalAtlasExplore(
  atlasHostDirectory: string,
  query: string,
  budgets: LocalAtlasExploreBudgets,
): ExploreOperationResult {
  const capture = captureLocalAtlasExploreSnapshot(atlasHostDirectory, budgets);
  switch (capture.state) {
    case "captured":
      return runExploreOperation({
        atlasCacheResolver: localAtlasCacheResolver(atlasHostDirectory),
        baseSnapshot: Object.freeze({
          reference: capture.baseSnapshot,
          state: "known",
        }),
        budgets,
        capturedFiles: capture.capturedFiles,
        homeAtlas: Object.freeze({ reference: "local-home-atlas", state: "known" }),
        query,
      });
    case "missing":
      return missingAtlasResult(capture.reason);
    case "oversized":
      return oversizedAtlasResult(capture.reason);
    case "too-many-files":
      return tooManyAtlasFilesResult(capture.reason);
    case "unreadable":
      return unreadableAtlasResult(capture.reason);
  }
}
