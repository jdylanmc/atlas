import { compareCodePoints } from "./compare_code_points.ts";
import { sha256Bytes } from "./sha256.ts";
import type { AtlasTextFile } from "./load_atlas_text.ts";
// Atlas View only names Lint output as an opaque type; it does not run Lint.
// eslint-disable-next-line atlas/inward-imports
import type { AtlasInputValidation } from "../lint/validate_atlas_input.ts";
import type { ParsedAtlasPage } from "./parse_atlas_pages.ts";
import type { AtlasPageEnvelope } from "../domain/atlas_page.ts";
import type { Finding } from "../domain/finding.ts";

export interface AtlasViewSnapshotReference {
  readonly reason?: string;
  readonly reference?: string;
  readonly state: "known" | "not-applicable" | "unknown";
}

export interface AtlasViewSnapshotIdentity {
  readonly atlas: AtlasViewSnapshotReference;
  readonly role: "home" | "tracked";
  readonly slug: string;
  readonly snapshot: AtlasViewSnapshotReference;
}

export interface AtlasViewFileDigest {
  readonly algorithm: "sha256";
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
  readonly snapshot: AtlasViewSnapshotIdentity;
}

export interface AtlasViewFile {
  readonly content: string;
  readonly path: string;
  readonly snapshot: AtlasViewSnapshotIdentity;
}

export interface AtlasViewSourceLocation {
  readonly body: ParsedAtlasPage["source"]["body"];
  readonly frontmatter: ParsedAtlasPage["source"]["frontmatter"];
  readonly path: string;
  readonly snapshot: AtlasViewSnapshotIdentity;
}

export interface AtlasViewOwnership {
  readonly createdBy: AtlasPageEnvelope["sdk"]["created-by"];
  readonly updatedBy: AtlasPageEnvelope["sdk"]["updated-by"];
}

export interface AtlasViewObject {
  readonly body: string;
  readonly id: string;
  readonly ownership: AtlasViewOwnership;
  readonly page: AtlasPageEnvelope;
  readonly path: string;
  readonly sourceLocation: AtlasViewSourceLocation;
  readonly snapshot: AtlasViewSnapshotIdentity;
  readonly tags: readonly string[];
  readonly title: string;
  readonly type: string;
}

export interface AtlasViewEdge {
  readonly from: string;
  readonly id: string;
  readonly path: string;
  readonly snapshot: AtlasViewSnapshotIdentity;
  readonly to: string;
}

export interface AtlasViewGraphIndexes {
  readonly adjacencyByObjectId: ReadonlyMap<string, readonly string[]>;
  readonly edgeByObjectId: ReadonlyMap<string, AtlasViewEdge>;
  readonly edgesById: ReadonlyMap<string, AtlasViewEdge>;
  readonly objectsById: ReadonlyMap<string, AtlasViewObject>;
  readonly objectsByPath: ReadonlyMap<string, AtlasViewObject>;
}

export interface AtlasViewValidationState {
  readonly findings: readonly Finding[];
  readonly state: "invalid" | "valid";
}

export interface AtlasViewSnapshotInput {
  readonly identity: AtlasViewSnapshotIdentity;
  readonly validation: AtlasInputValidation;
}

export interface AtlasView {
  readonly fileDigests: readonly AtlasViewFileDigest[];
  readonly files: readonly AtlasViewFile[];
  readonly graphIndexes: AtlasViewGraphIndexes;
  readonly objects: readonly AtlasViewObject[];
  readonly snapshots: readonly AtlasViewSnapshotIdentity[];
  readonly sourceLocations: readonly AtlasViewSourceLocation[];
  readonly validationState: AtlasViewValidationState;
}

const encoder = new TextEncoder();

type DeepReadonlyJson =
  | null
  | boolean
  | number
  | string
  | readonly DeepReadonlyJson[]
  | { readonly [key: string]: DeepReadonlyJson };

function frozenReference(
  reference: AtlasViewSnapshotReference,
): AtlasViewSnapshotReference {
  return Object.freeze({
    ...(reference.reason === undefined ? {} : { reason: reference.reason }),
    ...(reference.reference === undefined ? {} : { reference: reference.reference }),
    state: reference.state,
  });
}

function frozenIdentity(
  identity: AtlasViewSnapshotIdentity,
): AtlasViewSnapshotIdentity {
  return Object.freeze({
    atlas: frozenReference(identity.atlas),
    role: identity.role,
    slug: identity.slug,
    snapshot: frozenReference(identity.snapshot),
  });
}

function frozenJson(value: unknown): DeepReadonlyJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(frozenJson));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).map(
      ([key, entry]) => [key, frozenJson(entry)] as const,
    );
    return Object.freeze(Object.fromEntries(entries));
  }
  throw new TypeError("Atlas View can only own JSON-compatible page values.");
}

function frozenSourceLines(
  lines: ParsedAtlasPage["source"]["body"],
): ParsedAtlasPage["source"]["body"] {
  return Object.freeze({ endLine: lines.endLine, startLine: lines.startLine });
}

function frozenParsedPage(parsed: ParsedAtlasPage): ParsedAtlasPage {
  return Object.freeze({
    page: Object.freeze({
      atlas: frozenJson(parsed.page.atlas) as AtlasPageEnvelope["atlas"],
      body: parsed.page.body,
      sdk: frozenJson(parsed.page.sdk) as AtlasPageEnvelope["sdk"],
    }),
    source: Object.freeze({
      body: frozenSourceLines(parsed.source.body),
      frontmatter: frozenSourceLines(parsed.source.frontmatter),
      path: parsed.source.path,
    }),
  });
}

function frozenTextFile(file: AtlasTextFile): AtlasTextFile {
  return Object.freeze({ content: file.content, path: file.path });
}

interface OwnedAtlasViewSnapshotInput {
  readonly files: readonly AtlasTextFile[];
  readonly identity: AtlasViewSnapshotIdentity;
  readonly pages: readonly ParsedAtlasPage[];
  readonly validationState: AtlasViewValidationState;
}

function ownedSnapshotInput(
  input: AtlasViewSnapshotInput,
): OwnedAtlasViewSnapshotInput {
  const validation = input.validation;
  return Object.freeze({
    files: Object.freeze(validation.files.map(frozenTextFile)),
    identity: frozenIdentity(input.identity),
    pages: Object.freeze(validation.pages.map(frozenParsedPage)),
    validationState: Object.freeze({
      findings: Object.freeze(validation.findings),
      state: validation.validationState,
    }),
  });
}

class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>;

  constructor(entries: readonly (readonly [K, V])[]) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#map.size;
  }

  [Symbol.iterator](): ReturnType<Map<K, V>[typeof Symbol.iterator]> {
    return this.#map[Symbol.iterator]();
  }

  entries(): ReturnType<Map<K, V>["entries"]> {
    return this.#map.entries();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.#map) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  get(key: K): V | undefined {
    return this.#map.get(key);
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  keys(): ReturnType<Map<K, V>["keys"]> {
    return this.#map.keys();
  }

  values(): ReturnType<Map<K, V>["values"]> {
    return this.#map.values();
  }
}

function immutableMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  return new ImmutableMap(entries);
}

function sourceLocationOf(
  parsed: ParsedAtlasPage,
  snapshot: AtlasViewSnapshotIdentity,
): AtlasViewSourceLocation {
  return Object.freeze({
    body: parsed.source.body,
    frontmatter: parsed.source.frontmatter,
    path: parsed.source.path,
    snapshot,
  });
}

function edgeOf(object: AtlasViewObject): AtlasViewEdge | undefined {
  const atlas = object.page.atlas;
  if (typeof atlas["from"] !== "string" || typeof atlas["to"] !== "string") {
    return undefined;
  }
  return Object.freeze({
    from: atlas["from"],
    id: object.id,
    path: object.path,
    snapshot: object.snapshot,
    to: atlas["to"],
  });
}

function objectOf(
  parsed: ParsedAtlasPage,
  snapshot: AtlasViewSnapshotIdentity,
): AtlasViewObject {
  const sourceLocation = sourceLocationOf(parsed, snapshot);
  return Object.freeze({
    body: parsed.page.body,
    id: parsed.page.sdk.id,
    ownership: Object.freeze({
      createdBy: parsed.page.sdk["created-by"],
      updatedBy: parsed.page.sdk["updated-by"],
    }),
    page: parsed.page,
    path: parsed.source.path,
    sourceLocation,
    snapshot,
    tags: Object.freeze([...parsed.page.sdk.tags].sort(compareCodePoints)),
    title: parsed.page.sdk.title,
    type: parsed.page.sdk.type,
  });
}

function snapshotFileDigests(
  input: OwnedAtlasViewSnapshotInput,
): readonly AtlasViewFileDigest[] {
  return Object.freeze(
    input.files.map((file) => {
      const bytes = encoder.encode(file.content);
      return Object.freeze({
        algorithm: "sha256" as const,
        bytes: bytes.byteLength,
        path: file.path,
        sha256: sha256Bytes(bytes),
        snapshot: input.identity,
      });
    }),
  );
}

function snapshotFiles(input: OwnedAtlasViewSnapshotInput): readonly AtlasViewFile[] {
  return Object.freeze(
    input.files.map((file) =>
      Object.freeze({
        content: file.content,
        path: file.path,
        snapshot: input.identity,
      }),
    ),
  );
}

function graphIndexes(objects: readonly AtlasViewObject[]): AtlasViewGraphIndexes {
  const objectsById = new Map<string, AtlasViewObject>();
  const objectsByPath = new Map<string, AtlasViewObject>();
  const edgesById = new Map<string, AtlasViewEdge>();
  const edgeByObjectId = new Map<string, AtlasViewEdge>();
  const adjacency = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    const entries = adjacency.get(from) ?? [];
    entries.push(to);
    adjacency.set(from, entries);
  };

  for (const object of objects) {
    objectsById.set(object.id, object);
    objectsByPath.set(object.path, object);
    const edge = object.type === "edge" ? edgeOf(object) : undefined;
    if (edge !== undefined) {
      edgesById.set(edge.id, edge);
      edgeByObjectId.set(object.id, edge);
      add(edge.from, edge.to);
      add(edge.to, edge.from);
    }
  }

  const adjacencyEntries = [...adjacency].map(
    ([key, values]) =>
      [key, Object.freeze(values.toSorted(compareCodePoints))] as const,
  );
  return Object.freeze({
    adjacencyByObjectId: immutableMap(adjacencyEntries),
    edgeByObjectId: immutableMap([...edgeByObjectId]),
    edgesById: immutableMap([...edgesById]),
    objectsById: immutableMap([...objectsById]),
    objectsByPath: immutableMap([...objectsByPath]),
  });
}

export function buildAtlasView(
  home: AtlasViewSnapshotInput,
  tracked: readonly AtlasViewSnapshotInput[] = Object.freeze([]),
): AtlasView {
  const inputs = Object.freeze([home, ...tracked].map(ownedSnapshotInput));
  const snapshots = Object.freeze(inputs.map((entry) => entry.identity));
  const objects = Object.freeze(
    inputs.flatMap((input) =>
      input.pages.map((page) => objectOf(page, input.identity)),
    ),
  );
  const files = Object.freeze(inputs.flatMap(snapshotFiles));
  let fileDigests: readonly AtlasViewFileDigest[] | undefined;
  return Object.freeze({
    get fileDigests(): readonly AtlasViewFileDigest[] {
      fileDigests ??= Object.freeze(inputs.flatMap(snapshotFileDigests));
      return fileDigests;
    },
    files,
    graphIndexes: graphIndexes(objects),
    objects,
    snapshots,
    sourceLocations: Object.freeze(objects.map((object) => object.sourceLocation)),
    validationState: Object.freeze({
      findings: Object.freeze(
        inputs.flatMap((input) => input.validationState.findings),
      ),
      state: inputs.some((input) => input.validationState.state === "invalid")
        ? ("invalid" as const)
        : ("valid" as const),
    }),
  });
}
