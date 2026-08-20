import {
  stringify,
  type CreateNodeOptions,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
  type ToStringOptions,
} from "yaml";
import {
  checkAtlasPageEnvelope,
  type AtlasPageEnvelope,
} from "../domain/atlas_page.ts";
import { compareCodePoints } from "./compare_code_points.ts";
import type { AtlasTextFile } from "./load_atlas_text.ts";
import type { ParsedAtlasPage } from "./parse_atlas_pages.ts";

export type AtlasPageSerializeErrorCode =
  "DUPLICATE_PAGE_PATH" | "INVALID_PAGE_ENVELOPE" | "UNREPRESENTABLE_VALUE";

const errorMessages: Readonly<Record<AtlasPageSerializeErrorCode, string>> =
  Object.freeze({
    DUPLICATE_PAGE_PATH: "Atlas pages share one canonical path.",
    INVALID_PAGE_ENVELOPE: "Atlas page does not satisfy the page envelope.",
    UNREPRESENTABLE_VALUE: "Atlas page frontmatter holds an unrepresentable value.",
  });

export class AtlasPageSerializeError extends Error {
  readonly code: AtlasPageSerializeErrorCode;
  readonly path: string;

  constructor(code: AtlasPageSerializeErrorCode, path: string) {
    super(errorMessages[code]);
    this.name = "AtlasPageSerializeError";
    this.code = code;
    this.path = path;
  }
}

// Canonical frontmatter emission is pinned so that identical values always produce
// identical bytes: the parser's tag set (so timestamp-shaped strings stay quoted),
// YAML 1.2 core resolution, no anchors or aliases, no directives, no line wrapping,
// and no emitter-side reordering. Every non-plain scalar is a single-line JSON style
// double-quoted string (`blockQuote: false` with `doubleQuotedAsJSON: true`), so no
// value is folded across lines or emitted in a form whose meaning depends on trailing
// whitespace. Explicit mapping keys stay available, so keys longer than the simple
// key limit serialize instead of throwing. Collections are block style; only empty
// ones use the inline form.
const canonicalYamlOptions: CreateNodeOptions &
  DocumentOptions &
  ParseOptions &
  SchemaOptions &
  ToStringOptions = {
  aliasDuplicateObjects: false,
  blockQuote: false,
  customTags: ["binary", "set", "timestamp"],
  directives: false,
  doubleQuotedAsJSON: true,
  falseStr: "false",
  indent: 2,
  indentSeq: true,
  lineWidth: 0,
  nullStr: "null",
  schema: "core",
  singleQuote: false,
  sortMapEntries: false,
  trueStr: "true",
  version: "1.2",
};

// Canonical serialization reaches mapping entries through `Object.keys` and array
// entries through their indices, so own properties outside that reach - symbols,
// non-enumerable mapping keys, and named properties hung off an array - would be
// dropped silently. The envelope contract cannot see any of them, so the page root
// and every object or array descendant is scanned before any bytes exist. That is
// the one serializer-specific rejection.
// Only ECMAScript array indices - 0 through 2^32 - 2 - participate in an array's
// length and are visited when its entries are canonicalized. Any other own key,
// including a canonical numeric string at or above that bound, is a named property
// the emitter would drop.
const maximumArrayIndex = 2 ** 32 - 2;

function isArrayIndexKey(key: string): boolean {
  const index = Number(key);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index <= maximumArrayIndex &&
    String(index) === key
  );
}

function assertRepresentable(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  const isArray = Array.isArray(value);
  for (const key of Reflect.ownKeys(value)) {
    const kept =
      typeof key === "string" &&
      (isArray
        ? key === "length" || isArrayIndexKey(key)
        : Object.prototype.propertyIsEnumerable.call(value, key));
    if (!kept) {
      throw new AtlasPageSerializeError("UNREPRESENTABLE_VALUE", path);
    }
  }
  const entries = isArray
    ? (value as readonly unknown[])
    : Object.values(value as Readonly<Record<string, unknown>>);
  for (const entry of entries) {
    assertRepresentable(entry, path);
  }
}

// Envelope pre-validation and the representability scan guarantee every frontmatter
// value is JSON compatible, so canonicalization only has to order keys.
function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((entry) => canonicalizeValue(entry));
  }
  // A Map keeps every own key literal: assigning onto a fresh object would let an
  // own `__proto__` key mutate the result's prototype instead of becoming an entry.
  const record = value as Readonly<Record<string, unknown>>;
  const canonical = new Map<string, unknown>();
  for (const key of Object.keys(record).toSorted(compareCodePoints)) {
    canonical.set(key, canonicalizeValue(record[key]));
  }
  return canonical;
}

// The envelope's two blocks use a pinned order rather than sorted keys, so a page
// opens with its identity instead of a usually-empty extension. Nested keys stay
// sorted, and a fixed order is equally canonical: one input still yields one output.
function serializePage(page: AtlasPageEnvelope): string {
  const frontmatter = new Map<string, unknown>([
    ["sdk", canonicalizeValue(page.sdk)],
    ["atlas", canonicalizeValue(page.atlas)],
  ]);
  return `---\n${stringify(frontmatter, canonicalYamlOptions)}---\n${page.body}`;
}

export function serializeAtlasPages(
  pages: readonly ParsedAtlasPage[],
): readonly AtlasTextFile[] {
  const ordered = pages.toSorted((left, right) =>
    compareCodePoints(left.source.path, right.source.path),
  );

  // Every page is checked against the parser's envelope contract, and scanned for
  // values the emitter would drop, before any bytes are produced, so a page the
  // parser would reject can never be half emitted.
  let previousPath: string | undefined;
  for (const parsed of ordered) {
    const path = parsed.source.path;
    if (path === previousPath) {
      throw new AtlasPageSerializeError("DUPLICATE_PAGE_PATH", path);
    }
    if (!checkAtlasPageEnvelope(parsed.page)) {
      throw new AtlasPageSerializeError("INVALID_PAGE_ENVELOPE", path);
    }
    assertRepresentable(parsed.page, path);
    previousPath = path;
  }

  const files = ordered.map((parsed) =>
    Object.freeze({
      content: serializePage(parsed.page),
      path: parsed.source.path,
    }),
  );
  return Object.freeze(files);
}
