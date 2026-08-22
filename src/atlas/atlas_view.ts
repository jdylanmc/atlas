import { compareCodePoints } from "./compare_code_points.ts";
import type { AtlasTextFile } from "./load_atlas_text.ts";
// Atlas View only names Lint output as an opaque type; it never runs Lint.
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

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const sha256Initial = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
  0x5be0cd19,
]);

const sha256RoundConstants = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function sha256(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  for (let index = 0; index < 8; index += 1) {
    data[paddedLength - 1 - index] = Math.floor(bitLength / 2 ** (8 * index)) & 0xff;
  }

  const hash = [...sha256Initial];
  const words = new Array<number>(64).fill(0);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] =
        (((data[base] as number) << 24) |
          ((data[base + 1] as number) << 16) |
          ((data[base + 2] as number) << 8) |
          (data[base + 3] as number)) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const first =
        rightRotate(words[index - 15] as number, 7) ^
        rightRotate(words[index - 15] as number, 18) ^
        ((words[index - 15] as number) >>> 3);
      const second =
        rightRotate(words[index - 2] as number, 17) ^
        rightRotate(words[index - 2] as number, 19) ^
        ((words[index - 2] as number) >>> 10);
      words[index] =
        ((words[index - 16] as number) +
          first +
          (words[index - 7] as number) +
          second) >>>
        0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 =
        rightRotate(e as number, 6) ^
        rightRotate(e as number, 11) ^
        rightRotate(e as number, 25);
      const choose = ((e as number) & (f as number)) ^ (~(e as number) & (g as number));
      const t1 =
        ((h as number) +
          sigma1 +
          choose +
          (sha256RoundConstants[index] as number) +
          (words[index] as number)) >>>
        0;
      const sigma0 =
        rightRotate(a as number, 2) ^
        rightRotate(a as number, 13) ^
        rightRotate(a as number, 22);
      const majority =
        ((a as number) & (b as number)) ^
        ((a as number) & (c as number)) ^
        ((b as number) & (c as number));
      const t2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d as number) + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    hash[0] = ((hash[0] as number) + (a as number)) >>> 0;
    hash[1] = ((hash[1] as number) + (b as number)) >>> 0;
    hash[2] = ((hash[2] as number) + (c as number)) >>> 0;
    hash[3] = ((hash[3] as number) + (d as number)) >>> 0;
    hash[4] = ((hash[4] as number) + (e as number)) >>> 0;
    hash[5] = ((hash[5] as number) + (f as number)) >>> 0;
    hash[6] = ((hash[6] as number) + (g as number)) >>> 0;
    hash[7] = ((hash[7] as number) + (h as number)) >>> 0;
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
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
        sha256: sha256(bytes),
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
