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
import {
  runTrustedGit,
  runTrustedGitBytesWithInput,
  runTrustedGitWithInput,
} from "./trusted_git.ts";

// Explore is the read-only local platform seam. It captures an exact committed
// Atlas Snapshot from Git and delegates traversal to the deterministic operation.
// It does not write, create a worktree, invoke a model, or rank semantically.

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

interface TreeEntry {
  readonly mode: string;
  readonly object: string;
  readonly path: string;
  readonly type: string;
}

interface CheckedBlob {
  readonly object: string;
  readonly path: string;
  readonly size: number;
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

function parseTreeEntries(output: string): readonly TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const raw of output.split("\0")) {
    if (raw === "") continue;
    const separator = raw.indexOf("\t");
    if (separator < 0) return Object.freeze([]);
    const [mode, type, object] = raw.slice(0, separator).split(" ");
    const path = raw.slice(separator + 1);
    if (
      mode === undefined ||
      type === undefined ||
      object === undefined ||
      path === ""
    ) {
      return Object.freeze([]);
    }
    entries.push(Object.freeze({ mode, object, path, type }));
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

function batchInput(entries: readonly TreeEntry[]): string {
  return `${entries.map((entry) => entry.object).join("\n")}\n`;
}

function batchBufferBudget(
  entries: readonly TreeEntry[],
  maxTotalBytes: number,
): number {
  return maxTotalBytes + entries.length * 128 + 1;
}

function parseBatchCheckLine(
  line: string,
):
  | { readonly object: string; readonly size: number; readonly type: string }
  | undefined {
  const [object, type, sizeText, extra] = line.split(" ");
  if (
    object === undefined ||
    type === undefined ||
    sizeText === undefined ||
    extra !== undefined
  ) {
    return undefined;
  }
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0) return undefined;
  return Object.freeze({ object, size, type });
}

function checkedBlobs(
  repository: string,
  entries: readonly TreeEntry[],
  budgets: LocalAtlasExploreBudgets,
  readBatchText: LocalExploreBatchTextGitRunner,
):
  | { readonly blobs: readonly CheckedBlob[]; readonly state: "checked" }
  | { readonly reason: string; readonly state: "oversized" | "unreadable" } {
  const result = readBatchText(
    repository,
    ["cat-file", "--batch-check"],
    batchInput(entries),
    entries.length * 128 + 1,
  );
  if (result.state === "failed") {
    return Object.freeze({
      reason: "Git failed while checking the local Atlas Snapshot objects.",
      state: "unreadable" as const,
    });
  }
  const lines = result.stdout.split(/\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== entries.length) {
    return Object.freeze({
      reason: "Git returned an incomplete Atlas Snapshot object check.",
      state: "unreadable" as const,
    });
  }
  const blobs: CheckedBlob[] = [];
  let totalBytes = 0;
  for (const [index, line] of lines.entries()) {
    const entry = entries[index] as TreeEntry;
    const checked = parseBatchCheckLine(line);
    if (
      checked === undefined ||
      checked.object !== entry.object ||
      checked.type !== "blob" ||
      entry.type !== "blob" ||
      entry.mode !== "100644"
    ) {
      return Object.freeze({
        reason: "Git returned an unusable Atlas Snapshot object check.",
        state: "unreadable" as const,
      });
    }
    if (checked.size > budgets.maxFileBytes) {
      return Object.freeze({
        reason: "The local Atlas Snapshot exceeded the declared per-file byte budget.",
        state: "oversized" as const,
      });
    }
    if (totalBytes + checked.size > budgets.maxTotalBytes) {
      return Object.freeze({
        reason: "The local Atlas Snapshot exceeded the declared total byte budget.",
        state: "oversized" as const,
      });
    }
    totalBytes += checked.size;
    blobs.push(
      Object.freeze({ object: entry.object, path: entry.path, size: checked.size }),
    );
  }
  return Object.freeze({ blobs: Object.freeze(blobs), state: "checked" as const });
}

function readBatchLine(
  bytes: Uint8Array,
  offset: number,
): { readonly line: string; readonly nextOffset: number } | undefined {
  const newline = bytes.indexOf(0x0a, offset);
  if (newline < 0) return undefined;
  return Object.freeze({
    line: new TextDecoder().decode(bytes.subarray(offset, newline)),
    nextOffset: newline + 1,
  });
}

function capturedBlobs(
  repository: string,
  blobs: readonly CheckedBlob[],
  atlasHostDirectory: string,
  readBatchBytes: LocalExploreBatchBytesGitRunner,
  maxTotalBytes: number,
):
  | { readonly files: readonly CapturedAtlasFile[]; readonly state: "captured" }
  | { readonly reason: string; readonly state: "unreadable" } {
  const result = readBatchBytes(
    repository,
    ["cat-file", "--batch"],
    `${blobs.map((blob) => blob.object).join("\n")}\n`,
    batchBufferBudget(
      blobs.map((blob) => ({ ...blob, mode: "100644", type: "blob" })),
      maxTotalBytes,
    ),
  );
  if (result.state === "failed") {
    return Object.freeze({
      reason: "Git failed while reading the local Atlas Snapshot objects.",
      state: "unreadable" as const,
    });
  }
  const files: CapturedAtlasFile[] = [];
  let offset = 0;
  for (const blob of blobs) {
    const header = readBatchLine(result.stdout, offset);
    if (header === undefined) {
      return Object.freeze({
        reason: "Git returned a truncated Atlas Snapshot object header.",
        state: "unreadable" as const,
      });
    }
    const checked = parseBatchCheckLine(header.line);
    if (
      checked === undefined ||
      checked.object !== blob.object ||
      checked.type !== "blob" ||
      checked.size !== blob.size
    ) {
      return Object.freeze({
        reason: "Git returned an unexpected Atlas Snapshot object header.",
        state: "unreadable" as const,
      });
    }
    const contentStart = header.nextOffset;
    const contentEnd = contentStart + blob.size;
    if (contentEnd >= result.stdout.byteLength || result.stdout[contentEnd] !== 0x0a) {
      return Object.freeze({
        reason: "Git returned truncated Atlas Snapshot object content.",
        state: "unreadable" as const,
      });
    }
    files.push(
      Object.freeze({
        bytes: result.stdout.subarray(contentStart, contentEnd),
        path: atlasRelativePath(repository, atlasHostDirectory, blob.path),
      }),
    );
    offset = contentEnd + 1;
  }
  if (offset !== result.stdout.byteLength) {
    return Object.freeze({
      reason: "Git returned trailing Atlas Snapshot object data.",
      state: "unreadable" as const,
    });
  }
  return Object.freeze({ files: Object.freeze(files), state: "captured" as const });
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
  if (entries.length > budgets.maxFiles) {
    return Object.freeze({
      reason: "The local Atlas Snapshot exceeded the declared file-count budget.",
      state: "too-many-files" as const,
    });
  }
  const checked = checkedBlobs(root, entries, budgets, readBatchText);
  switch (checked.state) {
    case "oversized":
      return Object.freeze({ reason: checked.reason, state: "oversized" as const });
    case "unreadable":
      return Object.freeze({ reason: checked.reason, state: "unreadable" as const });
    case "checked":
      break;
  }
  const captured = capturedBlobs(
    root,
    checked.blobs,
    host,
    readBatchBytes,
    budgets.maxTotalBytes,
  );
  if (captured.state === "unreadable") {
    return Object.freeze({ reason: captured.reason, state: "unreadable" as const });
  }
  return Object.freeze({
    baseSnapshot: revision,
    capturedFiles: captured.files,
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
    case "too-many-files":
      return tooManyAtlasFilesResult(capture.reason);
    case "unreadable":
      return unreadableAtlasResult(capture.reason);
  }
}
