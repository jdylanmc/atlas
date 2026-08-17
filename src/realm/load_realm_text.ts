export type FileTreeEntryKind = "directory" | "file" | "symbolic-link" | "unsupported";

export interface FileTreeEntry {
  readonly kind: FileTreeEntryKind;
  readonly name: string;
}

export interface ReadOnlyFileTree {
  listDirectory(segments: readonly string[]): Promise<readonly FileTreeEntry[]>;
  readFile(segments: readonly string[]): Promise<Uint8Array>;
}

export interface RealmTextFile {
  readonly content: string;
  readonly path: string;
}

export interface RealmTextBudgets {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export type RealmLoadErrorCode =
  | "INVALID_BUDGET"
  | "INVALID_PATH"
  | "INVALID_UTF8"
  | "IO_ERROR"
  | "SYMLINK_NOT_ALLOWED"
  | "TOTAL_TOO_LARGE"
  | "UNSUPPORTED_ENTRY"
  | "FILE_TOO_LARGE";

const messages: Readonly<Record<RealmLoadErrorCode, string>> = Object.freeze({
  FILE_TOO_LARGE: "A Realm file exceeds the byte budget.",
  INVALID_BUDGET: "Realm byte budgets must be non-negative safe integers.",
  INVALID_PATH: "The Realm file tree contains an invalid path.",
  INVALID_UTF8: "A Realm file is not valid UTF-8.",
  IO_ERROR: "The Realm file tree could not be read.",
  SYMLINK_NOT_ALLOWED: "Symbolic links are not allowed in the Realm file tree.",
  TOTAL_TOO_LARGE: "The Realm file tree exceeds the total byte budget.",
  UNSUPPORTED_ENTRY: "The Realm file tree contains an unsupported entry.",
});

export class RealmLoadError extends Error {
  readonly code: RealmLoadErrorCode;

  constructor(code: RealmLoadErrorCode) {
    super(messages[code]);
    this.name = "RealmLoadError";
    this.code = code;
  }
}

function compareCodePoints(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex) as number;
    const rightPoint = right.codePointAt(rightIndex) as number;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return left.length - leftIndex - (right.length - rightIndex);
}

function assertSegment(name: string): void {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new RealmLoadError("INVALID_PATH");
  }
}

function assertBudgets(budgets: RealmTextBudgets): void {
  if (
    !Number.isSafeInteger(budgets.maxFileBytes) ||
    budgets.maxFileBytes < 0 ||
    !Number.isSafeInteger(budgets.maxTotalBytes) ||
    budgets.maxTotalBytes < 0
  ) {
    throw new RealmLoadError("INVALID_BUDGET");
  }
}

export async function loadRealmText(
  tree: ReadOnlyFileTree,
  budgets: RealmTextBudgets,
): Promise<readonly RealmTextFile[]> {
  assertBudgets(budgets);
  const paths: string[][] = [];

  async function collect(segments: readonly string[]): Promise<void> {
    let entries: readonly FileTreeEntry[];
    try {
      entries = await tree.listDirectory(segments);
    } catch (error: unknown) {
      if (error instanceof RealmLoadError) {
        throw error;
      }
      throw new RealmLoadError("IO_ERROR");
    }

    for (const entry of entries) {
      assertSegment(entry.name);
      const child = [...segments, entry.name];
      switch (entry.kind) {
        case "directory":
          await collect(child);
          break;
        case "file":
          paths.push(child);
          break;
        case "symbolic-link":
          throw new RealmLoadError("SYMLINK_NOT_ALLOWED");
        case "unsupported":
          throw new RealmLoadError("UNSUPPORTED_ENTRY");
      }
    }
  }

  await collect([".atlas"]);
  paths.sort((left, right) => compareCodePoints(left.join("/"), right.join("/")));

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: RealmTextFile[] = [];
  let totalBytes = 0;
  for (const segments of paths) {
    let bytes: Uint8Array;
    try {
      bytes = await tree.readFile(segments);
    } catch (error: unknown) {
      if (error instanceof RealmLoadError) {
        throw error;
      }
      throw new RealmLoadError("IO_ERROR");
    }
    if (bytes.byteLength > budgets.maxFileBytes) {
      throw new RealmLoadError("FILE_TOO_LARGE");
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > budgets.maxTotalBytes) {
      throw new RealmLoadError("TOTAL_TOO_LARGE");
    }

    let content: string;
    try {
      content = decoder.decode(bytes);
    } catch {
      throw new RealmLoadError("INVALID_UTF8");
    }
    files.push(Object.freeze({ content, path: segments.join("/") }));
  }

  return Object.freeze(files);
}
