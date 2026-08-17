export interface CapturedRealmFile {
  readonly bytes: Uint8Array;
  readonly path: string;
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
  | "DUPLICATE_PATH"
  | "FILE_TOO_LARGE"
  | "INVALID_BUDGET"
  | "INVALID_PATH"
  | "INVALID_UTF8"
  | "TOTAL_TOO_LARGE";

const messages: Readonly<Record<RealmLoadErrorCode, string>> = Object.freeze({
  DUPLICATE_PATH: "Captured Realm files contain a duplicate normalized path.",
  FILE_TOO_LARGE: "A captured Realm file exceeds the byte budget.",
  INVALID_BUDGET: "Realm byte budgets must be non-negative safe integers.",
  INVALID_PATH: "A captured Realm file has an invalid path.",
  INVALID_UTF8: "A captured Realm file is not valid UTF-8.",
  TOTAL_TOO_LARGE: "Captured Realm files exceed the total byte budget.",
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
  const leftPoints = Array.from(left, (point) => point.codePointAt(0) as number);
  const rightPoints = Array.from(right, (point) => point.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

function normalizePath(path: string): string {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new RealmLoadError("INVALID_PATH");
  }
  const segments = path.split("/");
  if (segments.includes("..")) {
    throw new RealmLoadError("INVALID_PATH");
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".");
  if (normalized.length < 2 || normalized[0] !== ".atlas") {
    throw new RealmLoadError("INVALID_PATH");
  }
  return normalized.join("/");
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

export function loadRealmText(
  capturedFiles: readonly CapturedRealmFile[],
  budgets: RealmTextBudgets,
): readonly RealmTextFile[] {
  const copied = capturedFiles.map((file) => ({
    bytes: new Uint8Array(file.bytes),
    path: file.path,
  }));
  copied.sort((left, right) => compareCodePoints(left.path, right.path));
  assertBudgets(budgets);

  const normalized = copied.map((file) => ({
    bytes: file.bytes,
    path: normalizePath(file.path),
  }));
  normalized.sort((left, right) => compareCodePoints(left.path, right.path));

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: RealmTextFile[] = [];
  let previousPath: string | undefined;
  let totalBytes = 0;
  for (const file of normalized) {
    if (file.path === previousPath) {
      throw new RealmLoadError("DUPLICATE_PATH");
    }
    previousPath = file.path;
    if (file.bytes.byteLength > budgets.maxFileBytes) {
      throw new RealmLoadError("FILE_TOO_LARGE");
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > budgets.maxTotalBytes) {
      throw new RealmLoadError("TOTAL_TOO_LARGE");
    }

    let content: string;
    try {
      content = decoder.decode(file.bytes);
    } catch {
      throw new RealmLoadError("INVALID_UTF8");
    }
    files.push(Object.freeze({ content, path: file.path }));
  }
  return Object.freeze(files);
}
