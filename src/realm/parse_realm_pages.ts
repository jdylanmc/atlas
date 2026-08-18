import { parseDocument } from "yaml";
import {
  checkRealmPageEnvelope,
  type RealmPageEnvelope,
} from "../domain/realm_page.ts";
import type { RealmTextFile } from "./load_realm_text.ts";
import { classifyRealmTextPath } from "./realm_path.ts";
export { classifyRealmTextPath } from "./realm_path.ts";

export interface SourceLines {
  readonly endLine: number;
  readonly startLine: number;
}

export interface RealmPageSource {
  readonly body: SourceLines;
  readonly frontmatter: SourceLines;
  readonly path: string;
}

export interface ParsedRealmPage {
  readonly page: RealmPageEnvelope;
  readonly source: RealmPageSource;
}

export interface RealmFrontmatterBounds {
  readonly closingEnd: number;
  readonly closingStart: number;
  readonly openingEnd: number;
}

export type RealmPageParseErrorCode =
  "INVALID_PAGE_ENVELOPE" | "MALFORMED_FRONTMATTER" | "MISSING_FRONTMATTER";

const errorMessages: Readonly<Record<RealmPageParseErrorCode, string>> = Object.freeze({
  INVALID_PAGE_ENVELOPE: "Realm page frontmatter does not satisfy the page envelope.",
  MALFORMED_FRONTMATTER: "Realm page frontmatter is malformed.",
  MISSING_FRONTMATTER: "Realm page frontmatter is missing.",
});

export class RealmPageParseError extends Error {
  readonly code: RealmPageParseErrorCode;
  readonly path: string;
  readonly sourceLine: number;

  constructor(code: RealmPageParseErrorCode, path: string, sourceLine: number) {
    super(errorMessages[code]);
    this.name = "RealmPageParseError";
    this.code = code;
    this.path = path;
    this.sourceLine = sourceLine;
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

function lineEndCount(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\n") {
      count += 1;
    } else if (character === "\r") {
      count += 1;
      if (text[index + 1] === "\n") {
        index += 1;
      }
    }
  }
  return count;
}

function lineAt(content: string, offset: number): number {
  return lineEndCount(content.slice(0, offset)) + 1;
}

function bodyEndLine(body: string, startLine: number): number {
  if (body === "") {
    return startLine;
  }
  return startLine + lineEndCount(body) - (/[\n\r]$/u.test(body) ? 1 : 0);
}

function lineEndingLengthAt(content: string, offset: number): number {
  if (content[offset] === "\r") {
    return content[offset + 1] === "\n" ? 2 : 1;
  }
  return content[offset] === "\n" ? 1 : 0;
}

function frontmatterOpeningEnd(content: string): number | undefined {
  if (!content.startsWith("---")) {
    return undefined;
  }
  const lineEndingLength = lineEndingLengthAt(content, 3);
  return lineEndingLength === 0 ? undefined : 3 + lineEndingLength;
}

function frontmatterDelimiterEnd(
  content: string,
  lineStart: number,
): number | undefined {
  if (!content.startsWith("---", lineStart)) {
    return undefined;
  }
  const lineEndingLength = lineEndingLengthAt(content, lineStart + 3);
  if (lineEndingLength !== 0) {
    return lineStart + 3 + lineEndingLength;
  }
  return lineStart + 3 === content.length ? lineStart + 3 : undefined;
}

function nextLineStart(content: string, lineStart: number): number | undefined {
  let lineEnd = lineStart;
  while (
    lineEnd < content.length &&
    content[lineEnd] !== "\n" &&
    content[lineEnd] !== "\r"
  ) {
    lineEnd += 1;
  }
  return lineEnd === content.length
    ? undefined
    : lineEnd + lineEndingLengthAt(content, lineEnd);
}

function parseFrontmatterDocument(content: string) {
  return parseDocument(content, {
    customTags: ["binary", "set", "timestamp"],
    strict: true,
    uniqueKeys: true,
  });
}

export function parseRealmFrontmatter(content: string) {
  const document = parseFrontmatterDocument(content);
  return (document.errors.length > 0 || document.warnings.length > 0) &&
    /\r(?!\n)/u.test(content)
    ? parseFrontmatterDocument(content.replace(/\r(?!\n)/gu, "\n"))
    : document;
}

function frontmatterBounds(
  content: string,
  openingEnd: number,
): RealmFrontmatterBounds | undefined {
  let lineStart = openingEnd;
  for (;;) {
    const closingEnd = frontmatterDelimiterEnd(content, lineStart);
    if (closingEnd !== undefined) {
      return Object.freeze({
        closingEnd,
        closingStart: lineStart,
        openingEnd,
      });
    }
    const followingLineStart = nextLineStart(content, lineStart);
    if (followingLineStart === undefined) {
      return undefined;
    }
    lineStart = followingLineStart;
  }
}

export function realmFrontmatterBounds(
  content: string,
): RealmFrontmatterBounds | undefined {
  const openingEnd = frontmatterOpeningEnd(content);
  return openingEnd === undefined ? undefined : frontmatterBounds(content, openingEnd);
}

function parsePage(file: RealmTextFile): ParsedRealmPage {
  const bounds = realmFrontmatterBounds(file.content);
  if (bounds === undefined) {
    throw new RealmPageParseError(
      frontmatterOpeningEnd(file.content) === undefined
        ? "MISSING_FRONTMATTER"
        : "MALFORMED_FRONTMATTER",
      file.path,
      1,
    );
  }

  const closingLine = lineAt(file.content, bounds.closingStart);
  const frontmatterText = file.content.slice(bounds.openingEnd, bounds.closingStart);
  const body = file.content.slice(bounds.closingEnd);
  const document = parseRealmFrontmatter(frontmatterText);
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new RealmPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }

  let frontmatter: unknown;
  try {
    frontmatter = cloneAndFreezeJson(
      document.toJS({ mapAsMap: true, maxAliasCount: 0 }),
    );
  } catch {
    throw new RealmPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }
  const page = isRecord(frontmatter) ? { ...frontmatter, body } : undefined;
  if (page === undefined || !checkRealmPageEnvelope(page)) {
    throw new RealmPageParseError("INVALID_PAGE_ENVELOPE", file.path, 2);
  }
  const frozenPage = cloneAndFreezeJson(page) as RealmPageEnvelope;

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

export function parseRealmPages(
  files: readonly RealmTextFile[],
): readonly ParsedRealmPage[] {
  const pageFiles = files
    .filter((file) => classifyRealmTextPath(file.path) === "page")
    .toSorted((left, right) => compareCodePoints(left.path, right.path));
  return Object.freeze(pageFiles.map(parsePage));
}
