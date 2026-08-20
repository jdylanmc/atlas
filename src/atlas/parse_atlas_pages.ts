import { parseDocument, visit } from "yaml";
import {
  checkAtlasPageEnvelope,
  type AtlasPageEnvelope,
} from "../domain/atlas_page.ts";
import { corePageDirectories } from "../domain/core_archetype.ts";
import { compareCodePoints } from "./compare_code_points.ts";
import type { AtlasTextFile } from "./load_atlas_text.ts";

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
  | "FRONTMATTER_TOO_DEEP"
  | "FRONTMATTER_TOO_LARGE"
  | "INVALID_PAGE_ENVELOPE"
  | "MALFORMED_FRONTMATTER"
  | "MISSING_FRONTMATTER";

const errorMessages: Readonly<Record<AtlasPageParseErrorCode, string>> = Object.freeze({
  FRONTMATTER_TOO_DEEP: "Atlas page frontmatter nests deeper than Atlas SDK reads.",
  FRONTMATTER_TOO_LARGE: "Atlas page frontmatter is larger than Atlas SDK reads.",
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

// Nesting deep enough to exhaust the JavaScript stack is a property of the
// running process rather than of the input: the same bytes could parse on one
// call and exhaust the stack on the next, so the same Atlas would answer
// differently across runs. A declared bound answers the same way every time, so
// nesting is measured from the frontmatter text before any parser recurses over
// it. Every block level costs at least one column of indentation and every flow
// level one bracket, so this scan can only overstate the nesting it measures,
// and a page it refuses is refused on every run.
export const maxFrontmatterDepth = 64;

// YAML begins a line after a line feed, a carriage return, or both, so the scan
// reads the same lines the parser will.
const yamlLineBreak = /\r\n|[\n\r]/u;

// Reading YAML costs more than the characters it holds, because every mapping
// key is checked against the keys beside it, so the frontmatter Atlas SDK reads
// is declared as well. Frontmatter carries what a page is, not what it says, so
// a page needing more than this is saying it in the wrong place.
export const maxFrontmatterCharacters = 32 * 1024;

function frontmatterDepthBound(frontmatter: string): number {
  let bound = 0;
  let flowDepth = 0;
  for (const line of frontmatter.split(yamlLineBreak)) {
    let indent = 0;
    while (line[indent] === " ") indent += 1;
    bound = Math.max(bound, indent + flowDepth + 1);
    for (const character of line.slice(indent)) {
      if (character === "[" || character === "{") {
        flowDepth += 1;
        bound = Math.max(bound, indent + flowDepth + 1);
      } else if (character === "]" || character === "}") {
        flowDepth = Math.max(0, flowDepth - 1);
      }
    }
  }
  return bound;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A value YAML can hold but JSON cannot is answered rather than raised, so
// reading a page never depends on catching an exception.
const notJson = Symbol("not-json");

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
    const items: unknown[] = [];
    for (const entry of value) {
      const cloned = cloneAndFreezeJson(entry);
      if (cloned === notJson) return notJson;
      items.push(cloned);
    }
    return Object.freeze(items);
  }
  if (value instanceof Map) {
    const entries: [string, unknown][] = [];
    for (const [key, entry] of value) {
      if (typeof key !== "string") return notJson;
      const cloned = cloneAndFreezeJson(entry);
      if (cloned === notJson) return notJson;
      entries.push([key, cloned]);
    }
    return Object.freeze(Object.fromEntries(entries));
  }
  return notJson;
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
  return match !== null && corePageDirectories.has(match[1] as string)
    ? "page"
    : "opaque";
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

/**
 * Reads one captured Atlas page, answering with the parse failure rather than
 * raising it, so a caller never has to tell a failure of the page from a
 * failure of the process running the read.
 */
export function parseAtlasPage(
  file: AtlasTextFile,
): ParsedAtlasPage | AtlasPageParseError {
  const openingLength = file.content.startsWith("---\r\n")
    ? 5
    : file.content.startsWith("---\n")
      ? 4
      : 0;
  if (openingLength === 0) {
    return new AtlasPageParseError("MISSING_FRONTMATTER", file.path, 1);
  }

  const closing = findClosingDelimiter(file.content, openingLength);
  if (closing === undefined) {
    return new AtlasPageParseError("MALFORMED_FRONTMATTER", file.path, 1);
  }

  const closingLine = lineAt(file.content, closing.index);
  const frontmatterText = file.content.slice(openingLength, closing.index);
  const body = file.content.slice(closing.index + closing.length);
  if (frontmatterText.length > maxFrontmatterCharacters) {
    return new AtlasPageParseError("FRONTMATTER_TOO_LARGE", file.path, 2);
  }
  if (frontmatterDepthBound(frontmatterText) > maxFrontmatterDepth) {
    return new AtlasPageParseError("FRONTMATTER_TOO_DEEP", file.path, 2);
  }
  const document = parseDocument(frontmatterText, {
    customTags: ["binary", "set", "timestamp"],
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    return new AtlasPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }

  // An alias makes one frontmatter value stand for another, so the text no
  // longer shows what the page holds. Refusing it from the parsed shape keeps
  // the answer a property of the page rather than of an expansion budget.
  let aliases = 0;
  visit(document, {
    Alias: () => {
      aliases += 1;
      return visit.BREAK;
    },
  });
  if (aliases > 0) {
    return new AtlasPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }

  const frontmatter = cloneAndFreezeJson(
    document.toJS({ mapAsMap: true, maxAliasCount: 0 }),
  );
  if (frontmatter === notJson) {
    return new AtlasPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }
  const page = isRecord(frontmatter) ? { ...frontmatter, body } : undefined;
  if (page === undefined || !checkAtlasPageEnvelope(page)) {
    return new AtlasPageParseError("INVALID_PAGE_ENVELOPE", file.path, 2);
  }
  // Every frontmatter value is already a frozen clone and the body is a string,
  // so pinning the envelope itself leaves the whole page immutable.
  const frozenPage = Object.freeze(page) as AtlasPageEnvelope;

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
  return Object.freeze(
    pageFiles.map((file) => {
      const parsed = parseAtlasPage(file);
      if (parsed instanceof AtlasPageParseError) throw parsed;
      return parsed;
    }),
  );
}
