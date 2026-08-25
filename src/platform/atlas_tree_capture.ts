import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import {
  runTrustedGit,
  runTrustedGitBytesWithInput,
  runTrustedGitWithInput,
} from "./trusted_git.ts";

export interface AtlasTreeCaptureBudgets {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
}

export type AtlasTreeTextGitRunner = typeof runTrustedGit;
export type AtlasTreeBatchTextGitRunner = typeof runTrustedGitWithInput;
export type AtlasTreeBatchBytesGitRunner = typeof runTrustedGitBytesWithInput;

export interface AtlasTreeCaptureOptions {
  readonly readBatchBytes?: AtlasTreeBatchBytesGitRunner;
  readonly readBatchText?: AtlasTreeBatchTextGitRunner;
  readonly readText?: AtlasTreeTextGitRunner;
}

export type AtlasTreeCaptureResult =
  | {
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

function batchInput(entries: readonly TreeEntry[]): string {
  return `${entries.map((entry) => entry.object).join("\n")}\n`;
}

function batchBufferBudget(
  entries: readonly TreeEntry[],
  maxTotalBytes: number,
): number {
  return maxTotalBytes + entries.length * 128 + 1;
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
  budgets: AtlasTreeCaptureBudgets,
  readBatchText: AtlasTreeBatchTextGitRunner,
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
      reason: "Git failed while checking the Atlas Snapshot objects.",
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
        reason: "The Atlas Snapshot exceeded the declared per-file byte budget.",
        state: "oversized" as const,
      });
    }
    if (totalBytes + checked.size > budgets.maxTotalBytes) {
      return Object.freeze({
        reason: "The Atlas Snapshot exceeded the declared total byte budget.",
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
  hostRepositoryPath: string,
  readBatchBytes: AtlasTreeBatchBytesGitRunner,
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
      reason: "Git failed while reading the Atlas Snapshot objects.",
      state: "unreadable" as const,
    });
  }
  const files: CapturedAtlasFile[] = [];
  let offset = 0;
  const relativePrefix = hostRepositoryPath === "." ? "" : `${hostRepositoryPath}/`;
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
        path:
          relativePrefix === "" ? blob.path : blob.path.slice(relativePrefix.length),
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

export function captureAtlasTree(
  repository: string,
  revision: string,
  atlasTreePath: string,
  hostRepositoryPath: string,
  budgets: AtlasTreeCaptureBudgets,
  options: AtlasTreeCaptureOptions = Object.freeze({}),
): AtlasTreeCaptureResult {
  const readText = options.readText ?? runTrustedGit;
  const readBatchText = options.readBatchText ?? runTrustedGitWithInput;
  const readBatchBytes = options.readBatchBytes ?? runTrustedGitBytesWithInput;
  const listed = readText(repository, [
    "ls-tree",
    "-rz",
    "-r",
    revision,
    atlasTreePath,
  ]);
  if (listed.state === "failed") {
    return Object.freeze({
      reason: "Git failed while listing the Atlas Snapshot.",
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
      reason: "The Atlas Snapshot exceeded the declared file-count budget.",
      state: "too-many-files" as const,
    });
  }
  const checked = checkedBlobs(repository, entries, budgets, readBatchText);
  switch (checked.state) {
    case "oversized":
      return Object.freeze({ reason: checked.reason, state: "oversized" as const });
    case "unreadable":
      return Object.freeze({ reason: checked.reason, state: "unreadable" as const });
    case "checked":
      break;
  }
  const captured = capturedBlobs(
    repository,
    checked.blobs,
    hostRepositoryPath,
    readBatchBytes,
    budgets.maxTotalBytes,
  );
  if (captured.state === "unreadable") {
    return Object.freeze({ reason: captured.reason, state: "unreadable" as const });
  }
  return Object.freeze({ capturedFiles: captured.files, state: "captured" as const });
}
