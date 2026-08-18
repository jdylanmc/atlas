import {
  stringify,
  type CreateNodeOptions,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
  type ToStringOptions,
} from "yaml";
import type { RealmPageEnvelope } from "../domain/realm_page.ts";
import type { RealmTextFile } from "./load_realm_text.ts";
import type { ParsedRealmPage } from "./parse_realm_pages.ts";

export type RealmPageSerializeErrorCode =
  "DUPLICATE_PAGE_PATH" | "UNREPRESENTABLE_VALUE";

const errorMessages: Readonly<Record<RealmPageSerializeErrorCode, string>> =
  Object.freeze({
    DUPLICATE_PAGE_PATH: "Realm pages share one canonical path.",
    UNREPRESENTABLE_VALUE: "Realm page frontmatter holds an unrepresentable value.",
  });

export class RealmPageSerializeError extends Error {
  readonly code: RealmPageSerializeErrorCode;
  readonly path: string;

  constructor(code: RealmPageSerializeErrorCode, path: string) {
    super(errorMessages[code]);
    this.name = "RealmPageSerializeError";
    this.code = code;
    this.path = path;
  }
}

// Canonical frontmatter emission is pinned so that identical values always produce
// identical bytes: the parser's tag set (so timestamp-shaped strings stay quoted),
// YAML 1.2 core resolution, no anchors or aliases, no directives, no block scalars
// or trailing-whitespace-sensitive forms, no line wrapping, and no emitter-side
// reordering. Collections are block style; only empty ones use the inline form.
const canonicalYamlOptions: CreateNodeOptions &
  DocumentOptions &
  ParseOptions &
  SchemaOptions &
  ToStringOptions = {
  aliasDuplicateObjects: false,
  blockQuote: false,
  customTags: ["binary", "set", "timestamp"],
  directives: false,
  doubleQuotedAsJSON: false,
  falseStr: "false",
  indent: 2,
  indentSeq: true,
  lineWidth: 0,
  nullStr: "null",
  schema: "core",
  simpleKeys: true,
  singleQuote: false,
  sortMapEntries: false,
  trueStr: "true",
  version: "1.2",
};

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

function canonicalizeValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new RealmPageSerializeError("UNREPRESENTABLE_VALUE", path);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((entry) => canonicalizeValue(entry, path));
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new RealmPageSerializeError("UNREPRESENTABLE_VALUE", path);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(record).toSorted(compareCodePoints)) {
    canonical[key] = canonicalizeValue(record[key], path);
  }
  return canonical;
}

function serializePage(page: RealmPageEnvelope, path: string): string {
  const frontmatter = canonicalizeValue({ atlas: page.atlas, realm: page.realm }, path);
  return `---\n${stringify(frontmatter, canonicalYamlOptions)}---\n${page.body}`;
}

export function serializeRealmPages(
  pages: readonly ParsedRealmPage[],
): readonly RealmTextFile[] {
  const ordered = pages.toSorted((left, right) =>
    compareCodePoints(left.source.path, right.source.path),
  );

  let previousPath: string | undefined;
  const files: RealmTextFile[] = [];
  for (const parsed of ordered) {
    const path = parsed.source.path;
    if (path === previousPath) {
      throw new RealmPageSerializeError("DUPLICATE_PAGE_PATH", path);
    }
    previousPath = path;
    files.push(Object.freeze({ content: serializePage(parsed.page, path), path }));
  }
  return Object.freeze(files);
}
