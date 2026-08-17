import { Value } from "@sinclair/typebox/value";
import { parseDocument } from "yaml";
import {
  RealmPageEnvelopeSchema,
  type RealmPageEnvelope,
} from "../domain/realm_page.ts";
import type { RealmTextFile } from "./load_realm_text.ts";

const pageDirectories = new Set(["bonfires", "insights", "lore", "pillars", "threads"]);

export type RealmTextClassification = "page" | "opaque";

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
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype === Object.prototype || prototype === null) {
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [key, cloneAndFreezeJson(entry)]),
        ),
      );
    }
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

export function classifyRealmTextPath(path: string): RealmTextClassification {
  if (path === ".atlas/index.md") {
    return "page";
  }
  if (/^\.atlas\/types\/[^/]+\/.+\.md$/u.test(path)) {
    return "page";
  }
  const match = /^\.atlas\/([^/]+)\/.+\.md$/u.exec(path);
  return match !== null && pageDirectories.has(match[1] as string) ? "page" : "opaque";
}

function parsePage(file: RealmTextFile): ParsedRealmPage {
  const openingLength = file.content.startsWith("---\r\n")
    ? 5
    : file.content.startsWith("---\n")
      ? 4
      : 0;
  if (openingLength === 0) {
    throw new RealmPageParseError("MISSING_FRONTMATTER", file.path, 1);
  }

  const closing = /^---(?:\r?\n|$)/gmu;
  closing.lastIndex = openingLength;
  const match = closing.exec(file.content);
  if (match === null) {
    throw new RealmPageParseError("MALFORMED_FRONTMATTER", file.path, 1);
  }

  const closingLine = lineAt(file.content, match.index);
  const frontmatterText = file.content.slice(openingLength, match.index);
  const body = file.content.slice(match.index + match[0].length);
  const document = parseDocument(frontmatterText, {
    customTags: ["binary", "set", "timestamp"],
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new RealmPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }

  let frontmatter: unknown;
  try {
    frontmatter = cloneAndFreezeJson(document.toJS({ maxAliasCount: 0 }));
  } catch {
    throw new RealmPageParseError("MALFORMED_FRONTMATTER", file.path, 2);
  }
  const page = isRecord(frontmatter) ? { ...frontmatter, body } : undefined;
  if (page === undefined || !Value.Check(RealmPageEnvelopeSchema, page)) {
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
