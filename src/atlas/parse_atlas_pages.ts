import { parseDocument } from "yaml";
import {
  checkAtlasPageEnvelope,
  type AtlasPageEnvelope,
} from "../domain/atlas_page.ts";
import { compareCodePoints } from "./compare_code_points.ts";
import type { AtlasTextFile } from "./load_atlas_text.ts";

const pageDirectories = new Set([
  "anchors",
  "concepts",
  "sources",
  "principles",
  "edges",
]);

export type AtlasTextClassification = "page" | "opaque";

export interface SourceLines {
  readonly endLine: number;
  readonly startLine: number;
}

export interface AtlasPageSource {
  readonly body: SourceLines;
  readonly frontmatter: SourceLines;
  readonly path: string;
}

export interface ParsedAtlasPage {
  readonly page: AtlasPageEnvelope;
  readonly source: AtlasPageSource;
}

export type AtlasPageParseErrorCode =
  "INVALID_PAGE_ENVELOPE" | "MALFORMED_FRONTMATTER" | "MISSING_FRONTMATTER";

const errorMessages: Readonly<Record<AtlasPageParseErrorCode, string>> = Object.freeze({
  INVALID_PAGE_ENVELOPE: "Atlas page frontmatter does not satisfy the page envelope.",
  MALFORMED_FRONTMATTER: "Atlas page frontmatter is malformed.",
  MISSING_FRONTMATTER: "Atlas page frontmatter is missing.",
});

export class AtlasPageParseError extends Error {
  readonly code: AtlasPageParseErrorCode;
  readonly path: string;
  readonly sourceLine: number;

  constructor(code: AtlasPageParseErrorCode, path: string, sourceLine: number) {
    super(errorMessages[code]);
    this.name = "AtlasPageParseError";
    this.code = code;
    this.path = path;
    this.sourceLine = sourceLine;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAndFreezeJson(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreezeJson));
  }
  if (value instanceof Map) {
    const entries: [string, unknown][] = [];
    for (const [key, entry] of value) {
      if (typeof key !== "string") {
        throw new TypeError("Frontmatter mapping keys must be strings.");
      }
      entries.push([key, cloneAndFreezeJson(entry)]);
    }
    return Object.freeze(Object.fromEntries(entries));
  }
  if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, cloneAndFreezeJson(entry)]),
      ),
    );
  }
  throw new TypeError("Frontmatter contains a non-JSON value.");
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function bodyEndLine(body: string, startLine: number): number {
  if (body === "") {
    return startLine;
  }
  const newlines = Array.from(body).filter((character) => character === "\n").length;
  return startLine + newlines - (body.endsWith("\n") ? 1 : 0);
}

export function classifyAtlasTextPath(path: string): AtlasTextClassification {
  if (path === ".atlas/index.md") {
    return "page";
  }
  if (/^\.atlas\/types\/[^/]+\/.+\.md$/u.test(path)) {
    return "page";
  }
  const match = /^\.atlas\/([^/]+)\/.+\.md$/u.exec(path);
  return match !== null && pageDirectories.has(match[1] as string) ? "page" : "opaque";
}

// Only the document start or a position immediately after an actual LF begins a
// line, so separators that JavaScript regular expressions treat as line starts
// (U+2028 and U+2029, which YAML emits literally inside scalars) can never be
// mistaken for the closing frontmatter delimiter.
function findClosingDelimiter(
  content: string,
  from: number,
): { readonly index: number; readonly length: number } | undefined {
  let index = from;
  while (index < content.length) {
    if (content.startsWith("---", index)) {
      const rest = index + 3;
      if (rest === content.length) {
        return { index, length: 3 };
      }
      if (content.startsWith("\r\n", rest)) {
        return { index, length: 5 };
      }
      if (content[rest] === "\n") {
        return { index, length: 4 };
      }
    }
    const newline = content.indexOf("\n", index);
    if (newline === -1) {
      return undefined;
    }
    index = newline + 1;
  }
  return undefined;
}

function parsePage(file: AtlasTextFile): ParsedAtlasPage {
  const openingLength = file.content.startsWith("---\r\n")
    ? 5
    : file.content.startsWith("---\n")
      ? 4
      : 0;
  if (openingLength === 0) {
    throw new AtlasPageParseError("MISSING_FRONTMATTER", file.path, 1);
  }

  const closing = findClosingDelimiter(file.content, openingLength);
  if (closing === undefined) {
    throw new AtlasPageParseError("MALFORMED_FRONTMATTER", file.path, 1);
  }

  const closingLine = lineAt(file.content, closing.index);
  const frontmatterText = file.content.slice(openingLength, closing.index);
  const body = file.content.slice(closing.index + closing.length);
  const document = parseDocument(frontmatterText, {
    customTags: ["binary", "set", "timestamp"],
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new AtlasPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }

  let frontmatter: unknown;
  try {
    frontmatter = cloneAndFreezeJson(
      document.toJS({ mapAsMap: true, maxAliasCount: 0 }),
    );
  } catch {
    throw new AtlasPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }
  const page = isRecord(frontmatter) ? { ...frontmatter, body } : undefined;
  if (page === undefined || !checkAtlasPageEnvelope(page)) {
    throw new AtlasPageParseError("INVALID_PAGE_ENVELOPE", file.path, 2);
  }
  const frozenPage = cloneAndFreezeJson(page) as AtlasPageEnvelope;

  const bodyStartLine = closingLine + 1;
  return Object.freeze({
    page: frozenPage,
    source: Object.freeze({
      body: Object.freeze({
        endLine: bodyEndLine(body, bodyStartLine),
        startLine: bodyStartLine,
      }),
      frontmatter: Object.freeze({
        endLine: closingLine - 1,
        startLine: 2,
      }),
      path: file.path,
    }),
  });
}

export function parseAtlasPages(
  files: readonly AtlasTextFile[],
): readonly ParsedAtlasPage[] {
  const pageFiles = files
    .filter((file) => classifyAtlasTextPath(file.path) === "page")
    .toSorted((left, right) => compareCodePoints(left.path, right.path));
  return Object.freeze(pageFiles.map(parsePage));
}
