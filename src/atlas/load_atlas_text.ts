import { compareCodePoints } from "./compare_code_points.ts";
import { rethrowProcessLimit } from "./process_limit.ts";

export interface CapturedAtlasFile {
  readonly bytes: Uint8Array;
  readonly path: string;
}

export interface AtlasTextFile {
  readonly content: string;
  readonly path: string;
}

export interface AtlasTextBudgets {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export type AtlasLoadErrorCode =
  | "DUPLICATE_PATH"
  | "FILE_TOO_LARGE"
  | "INVALID_BUDGET"
  | "INVALID_PATH"
  | "INVALID_UTF8"
  | "NON_CANONICAL_LINE_TERMINATOR"
  | "SHARED_BYTES_NOT_ALLOWED"
  | "TOTAL_TOO_LARGE";

const nonCanonicalLineTerminator = /\r(?!\n)|[\u2028\u2029]/u;

export function containsNonCanonicalLineTerminator(content: string): boolean {
  return nonCanonicalLineTerminator.test(content);
}

const messages: Readonly<Record<AtlasLoadErrorCode, string>> = Object.freeze({
  DUPLICATE_PATH: "Captured Atlas files contain a duplicate normalized path.",
  FILE_TOO_LARGE: "A captured Atlas file exceeds the byte budget.",
  INVALID_BUDGET: "Atlas byte budgets must be non-negative safe integers.",
  INVALID_PATH: "A captured Atlas file has an invalid path.",
  INVALID_UTF8: "A captured Atlas file is not valid UTF-8.",
  NON_CANONICAL_LINE_TERMINATOR:
    "A captured Atlas file contains a non-canonical line terminator.",
  SHARED_BYTES_NOT_ALLOWED: "Captured Atlas file bytes must not use shared memory.",
  TOTAL_TOO_LARGE: "Captured Atlas files exceed the total byte budget.",
});

export class AtlasLoadError extends Error {
  readonly code: AtlasLoadErrorCode;

  constructor(code: AtlasLoadErrorCode) {
    super(messages[code]);
    this.name = "AtlasLoadError";
    this.code = code;
  }
}

// A path travels into every Finding a check raises about its file, and a
// Finding exists so untrusted content is safe to read. Control characters and
// the bidirectional overrides rewrite what a terminal or log shows without
// changing the text a reader compares it against, so a path carrying them is
// refused rather than sanitized.
const unsafePathCharacters = new Set<string>();
for (const [first, last] of [
  [0, 0x1f],
  [0x7f, 0x9f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
] as const) {
  for (let code = first; code <= last; code += 1) {
    unsafePathCharacters.add(String.fromCodePoint(code));
  }
}

function hasUnsafePathCharacter(path: string): boolean {
  return Array.from(path).some((character) => unsafePathCharacters.has(character));
}

export function normalizeAtlasTextPath(path: string): string {
  if (path.startsWith("/") || path.includes("\\") || hasUnsafePathCharacter(path)) {
    throw new AtlasLoadError("INVALID_PATH");
  }
  const segments = path.split("/");
  if (segments.includes("..")) {
    throw new AtlasLoadError("INVALID_PATH");
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".");
  if (normalized.length < 2 || normalized[0] !== ".atlas") {
    throw new AtlasLoadError("INVALID_PATH");
  }
  return normalized.join("/");
}

function assertBudgets(budgets: AtlasTextBudgets): void {
  if (
    !Number.isSafeInteger(budgets.maxFileBytes) ||
    budgets.maxFileBytes < 0 ||
    !Number.isSafeInteger(budgets.maxTotalBytes) ||
    budgets.maxTotalBytes < 0
  ) {
    throw new AtlasLoadError("INVALID_BUDGET");
  }
}

// Captured accessors are invoked only with explicit Reflect receivers.
// eslint-disable-next-line @typescript-eslint/unbound-method
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "buffer",
)?.get as (this: Uint8Array) => ArrayBufferLike;
// eslint-disable-next-line @typescript-eslint/unbound-method
const sharedArrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  SharedArrayBuffer.prototype,
  "byteLength",
)?.get as (this: SharedArrayBuffer) => number;

function hasSharedBackingBuffer(bytes: Uint8Array): boolean {
  const buffer = Reflect.apply(typedArrayBufferGetter, bytes, []);
  try {
    Reflect.apply(sharedArrayBufferByteLengthGetter, buffer, []);
    return true;
  } catch (error: unknown) {
    rethrowProcessLimit(error);
    return false;
  }
}

export function loadAtlasText(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): readonly AtlasTextFile[] {
  if (capturedFiles.some((file) => hasSharedBackingBuffer(file.bytes))) {
    throw new AtlasLoadError("SHARED_BYTES_NOT_ALLOWED");
  }
  assertBudgets(budgets);

  const normalized = [...capturedFiles].map((file) => ({
    bytes: file.bytes,
    path: normalizeAtlasTextPath(file.path),
  }));
  normalized.sort((left, right) => compareCodePoints(left.path, right.path));

  let previousPath: string | undefined;
  let totalBytes = 0;
  for (const file of normalized) {
    if (file.path === previousPath) {
      throw new AtlasLoadError("DUPLICATE_PATH");
    }
    previousPath = file.path;
    if (file.bytes.byteLength > budgets.maxFileBytes) {
      throw new AtlasLoadError("FILE_TOO_LARGE");
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > budgets.maxTotalBytes) {
      throw new AtlasLoadError("TOTAL_TOO_LARGE");
    }
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: AtlasTextFile[] = [];
  for (const file of normalized) {
    let content: string;
    try {
      content = decoder.decode(file.bytes);
    } catch (error: unknown) {
      rethrowProcessLimit(error);
      throw new AtlasLoadError("INVALID_UTF8");
    }
    if (containsNonCanonicalLineTerminator(content)) {
      throw new AtlasLoadError("NON_CANONICAL_LINE_TERMINATOR");
    }
    files.push(Object.freeze({ content, path: file.path }));
  }
  return Object.freeze(files);
}
