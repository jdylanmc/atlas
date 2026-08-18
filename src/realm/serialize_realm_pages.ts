import {
  stringify,
  type CreateNodeOptions,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
  type ToStringOptions,
} from "yaml";
import {
  checkRealmPageEnvelope,
  type RealmPageEnvelope,
} from "../domain/realm_page.ts";
import { compareCodePoints } from "./compare_code_points.ts";
import type { RealmTextFile } from "./load_realm_text.ts";
import type { ParsedRealmPage } from "./parse_realm_pages.ts";

export type RealmPageSerializeErrorCode =
  "DUPLICATE_PAGE_PATH" | "INVALID_PAGE_ENVELOPE" | "UNREPRESENTABLE_VALUE";

const errorMessages: Readonly<Record<RealmPageSerializeErrorCode, string>> =
  Object.freeze({
    DUPLICATE_PAGE_PATH: "Realm pages share one canonical path.",
    INVALID_PAGE_ENVELOPE: "Realm page does not satisfy the page envelope.",
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

// Envelope pre-validation guarantees every frontmatter value is JSON compatible, so
// canonicalization only has to order keys. Own symbol keys survive that contract -
// JSON compatibility checks and schema validation never see them - and the emitter
// would drop them silently, so any object or array carrying one is rejected before
// bytes exist. That is the one serializer-specific rejection.
function canonicalizeValue(value: unknown, path: string): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new RealmPageSerializeError("UNREPRESENTABLE_VALUE", path);
  }
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((entry) => canonicalizeValue(entry, path));
  }
  // A Map keeps every own key literal: assigning onto a fresh object would let an
  // own `__proto__` key mutate the result's prototype instead of becoming an entry.
  const record = value as Readonly<Record<string, unknown>>;
  const canonical = new Map<string, unknown>();
  for (const key of Object.keys(record).toSorted(compareCodePoints)) {
    canonical.set(key, canonicalizeValue(record[key], path));
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

  // Every page is checked against the parser's envelope contract before any bytes are
  // produced, so a page the parser would reject can never be half emitted.
  let previousPath: string | undefined;
  for (const parsed of ordered) {
    const path = parsed.source.path;
    if (path === previousPath) {
      throw new RealmPageSerializeError("DUPLICATE_PAGE_PATH", path);
    }
    if (!checkRealmPageEnvelope(parsed.page)) {
      throw new RealmPageSerializeError("INVALID_PAGE_ENVELOPE", path);
    }
    previousPath = path;
  }

  const files = ordered.map((parsed) =>
    Object.freeze({
      content: serializePage(parsed.page, parsed.source.path),
      path: parsed.source.path,
    }),
  );
  return Object.freeze(files);
}
