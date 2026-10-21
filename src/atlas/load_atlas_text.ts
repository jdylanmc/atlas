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

export type AtlasLoadErrorCode =
  | "DUPLICATE_PATH"
  | "INVALID_PATH"
  | "INVALID_UTF8"
  | "NON_CANONICAL_LINE_TERMINATOR"
  | "SHARED_BYTES_NOT_ALLOWED";

const nonCanonicalLineTerminator = /\r(?!\n)|[\u2028\u2029]/u;

export function containsNonCanonicalLineTerminator(content: string): boolean {
  return nonCanonicalLineTerminator.test(content);
}

/** The first non-canonical line terminator in one loaded Atlas file. */
export interface NonCanonicalLineTerminator {
  readonly column: number;
  readonly line: number;
  readonly path: string;
}

/**
 * Locates the first non-canonical line terminator in `content`, counting lines
 * only at the LF that every accepted Atlas line ends with, so the reported
 * position is the one an editor showing canonical text would display.
 */
export function locateNonCanonicalLineTerminator(
  content: string,
): { readonly column: number; readonly line: number } | undefined {
  const match = nonCanonicalLineTerminator.exec(content);
  if (match === null) return undefined;
  const before = content.slice(0, match.index);
  const lineStart = before.lastIndexOf("\n") + 1;
  return Object.freeze({
    column: match.index - lineStart + 1,
    line: before.split("\n").length,
  });
}

const messages: Readonly<Record<AtlasLoadErrorCode, string>> = Object.freeze({
  DUPLICATE_PATH: "Captured Atlas files contain a duplicate normalized path.",
  INVALID_PATH: "A captured Atlas file has an invalid path.",
  INVALID_UTF8: "A captured Atlas file is not valid UTF-8.",
  NON_CANONICAL_LINE_TERMINATOR:
    "A captured Atlas file contains a non-canonical line terminator.",
  SHARED_BYTES_NOT_ALLOWED: "Captured Atlas file bytes must not use shared memory.",
});

export class AtlasLoadError extends Error {
  readonly code: AtlasLoadErrorCode;
  /**
   * Every file carrying a non-canonical line terminator, populated only for
   * NON_CANONICAL_LINE_TERMINATOR. Those paths have already passed path
   * normalization, so they are safe to name in a Finding.
   */
  readonly lineTerminators: readonly NonCanonicalLineTerminator[];

  constructor(
    code: AtlasLoadErrorCode,
    lineTerminators: readonly NonCanonicalLineTerminator[] = Object.freeze([]),
  ) {
    super(messages[code]);
    this.name = "AtlasLoadError";
    this.code = code;
    this.lineTerminators = lineTerminators;
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

/** One path component as Win32 resolves it, without trailing dots or spaces. */
export function trimWin32PathSegment(segment: string): string {
  return segment.replace(/[. ]+$/u, "");
}

/**
 * Folds Atlas path spellings to the filesystem identity they share: Unicode-
 * equivalent spellings normalize together, Win32 trims trailing dots and spaces
 * from each segment, and case-insensitive filesystems compare lower-cased
 * segments. Empty segments are dropped deliberately so doubled, leading, or
 * trailing `/` collapse the same way a real filesystem path walk does. Today,
 * governance_operation.ts validates authored `change.path` with
 * `pathIsCanonicalAtlasPath`, and ingest_operation.ts validates crawled
 * `source.locator` / `concept.locator` with `isCanonicalLocator`, before those
 * values reach this fold. But ingest_operation.ts also feeds scope-confinement
 * prefixes through `isPrefixPath`, and those `scope.entryPoint`,
 * `scope.includedPaths`, and `scope.excludedPaths` values are parsed with
 * `asString` / `asStringArray` and are not canonical-path-validated anywhere,
 * so `.atlas//CHANGELOG.md`-style spellings genuinely reach this fold there
 * today. This pins one shared rule so the consumers do not drift, rather than
 * changing user-visible behavior.
 */
export function atlasPathCollisionSegments(path: string): readonly string[] {
  return path
    .normalize("NFC")
    .split("/")
    .map((segment) => trimWin32PathSegment(segment).toLowerCase())
    .filter((segment) => segment.length > 0);
}

export function atlasPathCollisionKey(path: string): string {
  return atlasPathCollisionSegments(path).join("/");
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

/**
 * Loads captured Atlas bytes as immutable, path-normalized UTF-8 text. Atlas
 * SDK imposes no byte budget on an Atlas: page length is an Atlas-owned prose
 * rule enforced by the Atlas's Vale configuration, not a loader limit.
 *
 * Every file carrying a non-canonical line terminator is located before the
 * load is refused, so one Lint reports each such file at its first offending
 * position rather than one anonymous whole-Atlas failure.
 */
export function loadAtlasText(
  capturedFiles: readonly CapturedAtlasFile[],
): readonly AtlasTextFile[] {
  if (capturedFiles.some((file) => hasSharedBackingBuffer(file.bytes))) {
    throw new AtlasLoadError("SHARED_BYTES_NOT_ALLOWED");
  }

  const normalized = [...capturedFiles].map((file) => ({
    bytes: file.bytes,
    path: normalizeAtlasTextPath(file.path),
  }));
  normalized.sort((left, right) => compareCodePoints(left.path, right.path));

  let previousPath: string | undefined;
  for (const file of normalized) {
    if (file.path === previousPath) {
      throw new AtlasLoadError("DUPLICATE_PATH");
    }
    previousPath = file.path;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: AtlasTextFile[] = [];
  const lineTerminators: NonCanonicalLineTerminator[] = [];
  for (const file of normalized) {
    let content: string;
    try {
      content = decoder.decode(file.bytes);
    } catch (error: unknown) {
      rethrowProcessLimit(error);
      throw new AtlasLoadError("INVALID_UTF8");
    }
    const terminator = locateNonCanonicalLineTerminator(content);
    if (terminator !== undefined) {
      lineTerminators.push(Object.freeze({ ...terminator, path: file.path }));
    }
    files.push(Object.freeze({ content, path: file.path }));
  }
  if (lineTerminators.length > 0) {
    throw new AtlasLoadError(
      "NON_CANONICAL_LINE_TERMINATOR",
      Object.freeze(lineTerminators),
    );
  }
  return Object.freeze(files);
}
