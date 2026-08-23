import { lstatSync, type Stats } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { Finding } from "../domain/finding.ts";
import {
  runExploreOperation,
  type ExploreOperationResult,
} from "../operations/explore_operation.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationReference,
} from "../operations/operation_result.ts";
import { runTrustedGit, runTrustedGitBytes } from "./trusted_git.ts";

// Explore is the read-only local platform seam. It captures an exact committed
// Atlas Snapshot from Git and delegates traversal to the deterministic operation.
// It never writes, creates a worktree, invokes a model, or ranks semantically.

interface LocalAtlasExploreBudgets {
  readonly maxContextCharacters: number;
  readonly maxEdges: number;
  readonly maxFileBytes: number;
  readonly maxObjects: number;
  readonly maxQueryCharacters: number;
  readonly maxResults: number;
  readonly maxRouteEdges: number;
  readonly maxTerms: number;
  readonly maxTotalBytes: number;
}

export type LocalExploreTextGitRunner = typeof runTrustedGit;
export type LocalExploreBytesGitRunner = typeof runTrustedGitBytes;
export type LocalExploreStatReader = (
  path: string,
  options: { readonly throwIfNoEntry: false },
) => Stats | undefined;

export interface LocalAtlasExploreCaptureOptions {
  readonly readBytes?: LocalExploreBytesGitRunner;
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
      readonly state: "missing" | "oversized" | "unreadable";
    };

interface TreeEntry {
  readonly mode: string;
  readonly path: string;
}

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

function parseTreeEntries(output: string): readonly TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const raw of output.split("\0")) {
    if (raw === "") continue;
    const separator = raw.indexOf("\t");
    if (separator < 0) return Object.freeze([]);
    const metadata = raw.slice(0, separator).split(" ");
    const mode = metadata[0];
    const path = raw.slice(separator + 1);
    if (mode === undefined || path === "") return Object.freeze([]);
    entries.push(Object.freeze({ mode, path }));
  }
  return Object.freeze(
    entries.toSorted((left, right) => compareCodePoints(left.path, right.path)),
  );
}

function atlasRelativePath(
  root: string,
  atlasHostDirectory: string,
  gitPath: string,
): string {
  const hostPath = repositoryPath(root, atlasHostDirectory);
  if (hostPath === ".") return gitPath;
  return gitPath.slice(hostPath.length + 1);
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
  const readBytes = options.readBytes ?? runTrustedGitBytes;
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
  const listed = readText(root, ["ls-tree", "-rz", "-r", revision, atlasPath]);
  if (listed.state === "failed") {
    return Object.freeze({
      reason: "Git failed while listing the local Atlas Snapshot.",
      state: "unreadable" as const,
    });
  }
  const entries = parseTreeEntries(listed.stdout);
  if (entries.length === 0) {
    return Object.freeze({
      reason: "Atlas Host Directory does not contain a committed .atlas directory.",
      state: "missing" as const,
    });
  }
  const capturedFiles: CapturedAtlasFile[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.mode !== "100644") {
      return Object.freeze({
        reason: "The committed Atlas Snapshot contains an unsupported file mode.",
        state: "unreadable" as const,
      });
    }
    const sizeText = git(readText, root, [
      "cat-file",
      "-s",
      `${revision}:${entry.path}`,
    ]);
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0) {
      return Object.freeze({
        reason: "Git failed while sizing the local Atlas Snapshot.",
        state: "unreadable" as const,
      });
    }
    if (size > budgets.maxFileBytes) {
      return Object.freeze({
        reason: "The local Atlas Snapshot exceeded the declared per-file byte budget.",
        state: "oversized" as const,
      });
    }
    if (totalBytes + size > budgets.maxTotalBytes) {
      return Object.freeze({
        reason: "The local Atlas Snapshot exceeded the declared total byte budget.",
        state: "oversized" as const,
      });
    }
    const bytes = readBytes(root, ["show", `${revision}:${entry.path}`]);
    if (bytes.state === "failed") {
      return Object.freeze({
        reason: "Git failed while reading the local Atlas Snapshot.",
        state: "unreadable" as const,
      });
    }
    if (bytes.stdout.byteLength !== size) {
      return Object.freeze({
        reason: "Git returned an Atlas file whose size changed during capture.",
        state: "unreadable" as const,
      });
    }
    totalBytes += bytes.stdout.byteLength;
    capturedFiles.push(
      Object.freeze({
        bytes: bytes.stdout,
        path: atlasRelativePath(root, host, entry.path),
      }),
    );
  }
  return Object.freeze({
    baseSnapshot: revision,
    capturedFiles: Object.freeze(capturedFiles),
    state: "captured" as const,
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
    case "unreadable":
      return unreadableAtlasResult(capture.reason);
  }
}
