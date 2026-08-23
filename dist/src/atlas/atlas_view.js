import { compareCodePoints } from "./compare_code_points.js";
import { sha256Bytes } from "./sha256.js";
const encoder = new TextEncoder();
function frozenReference(reference) {
    return Object.freeze({
        ...(reference.reason === undefined ? {} : { reason: reference.reason }),
        ...(reference.reference === undefined ? {} : { reference: reference.reference }),
        state: reference.state,
    });
}
function frozenIdentity(identity) {
    return Object.freeze({
        atlas: frozenReference(identity.atlas),
        role: identity.role,
        slug: identity.slug,
        snapshot: frozenReference(identity.snapshot),
    });
}
function frozenJson(value) {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))) {
        return value;
    }
    if (Array.isArray(value)) {
        return Object.freeze(value.map(frozenJson));
    }
    if (typeof value === "object") {
        const entries = Object.entries(value).map(([key, entry]) => [key, frozenJson(entry)]);
        return Object.freeze(Object.fromEntries(entries));
    }
    throw new TypeError("Atlas View can only own JSON-compatible page values.");
}
function frozenSourceLines(lines) {
    return Object.freeze({ endLine: lines.endLine, startLine: lines.startLine });
}
function frozenParsedPage(parsed) {
    return Object.freeze({
        page: Object.freeze({
            atlas: frozenJson(parsed.page.atlas),
            body: parsed.page.body,
            sdk: frozenJson(parsed.page.sdk),
        }),
        source: Object.freeze({
            body: frozenSourceLines(parsed.source.body),
            frontmatter: frozenSourceLines(parsed.source.frontmatter),
            path: parsed.source.path,
        }),
    });
}
function frozenTextFile(file) {
    return Object.freeze({ content: file.content, path: file.path });
}
function ownedSnapshotInput(input) {
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
class ImmutableMap {
    #map;
    constructor(entries) {
        this.#map = new Map(entries);
        Object.freeze(this);
    }
    get size() {
        return this.#map.size;
    }
    [Symbol.iterator]() {
        return this.#map[Symbol.iterator]();
    }
    entries() {
        return this.#map.entries();
    }
    forEach(callbackfn, thisArg) {
        for (const [key, value] of this.#map) {
            callbackfn.call(thisArg, value, key, this);
        }
    }
    get(key) {
        return this.#map.get(key);
    }
    has(key) {
        return this.#map.has(key);
    }
    keys() {
        return this.#map.keys();
    }
    values() {
        return this.#map.values();
    }
}
function immutableMap(entries) {
    return new ImmutableMap(entries);
}
function sourceLocationOf(parsed, snapshot) {
    return Object.freeze({
        body: parsed.source.body,
        frontmatter: parsed.source.frontmatter,
        path: parsed.source.path,
        snapshot,
    });
}
function edgeOf(object) {
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
function objectOf(parsed, snapshot) {
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
function snapshotFileDigests(input) {
    return Object.freeze(input.files.map((file) => {
        const bytes = encoder.encode(file.content);
        return Object.freeze({
            algorithm: "sha256",
            bytes: bytes.byteLength,
            path: file.path,
            sha256: sha256Bytes(bytes),
            snapshot: input.identity,
        });
    }));
}
function snapshotFiles(input) {
    return Object.freeze(input.files.map((file) => Object.freeze({
        content: file.content,
        path: file.path,
        snapshot: input.identity,
    })));
}
function graphIndexes(objects) {
    const objectsById = new Map();
    const objectsByPath = new Map();
    const edgesById = new Map();
    const edgeByObjectId = new Map();
    const adjacency = new Map();
    const add = (from, to) => {
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
    const adjacencyEntries = [...adjacency].map(([key, values]) => [key, Object.freeze(values.toSorted(compareCodePoints))]);
    return Object.freeze({
        adjacencyByObjectId: immutableMap(adjacencyEntries),
        edgeByObjectId: immutableMap([...edgeByObjectId]),
        edgesById: immutableMap([...edgesById]),
        objectsById: immutableMap([...objectsById]),
        objectsByPath: immutableMap([...objectsByPath]),
    });
}
export function buildAtlasView(home, tracked = Object.freeze([])) {
    const inputs = Object.freeze([home, ...tracked].map(ownedSnapshotInput));
    const snapshots = Object.freeze(inputs.map((entry) => entry.identity));
    const objects = Object.freeze(inputs.flatMap((input) => input.pages.map((page) => objectOf(page, input.identity))));
    const files = Object.freeze(inputs.flatMap(snapshotFiles));
    let fileDigests;
    return Object.freeze({
        get fileDigests() {
            fileDigests ??= Object.freeze(inputs.flatMap(snapshotFileDigests));
            return fileDigests;
        },
        files,
        graphIndexes: graphIndexes(objects),
        objects,
        snapshots,
        sourceLocations: Object.freeze(objects.map((object) => object.sourceLocation)),
        validationState: Object.freeze({
            findings: Object.freeze(inputs.flatMap((input) => input.validationState.findings)),
            state: inputs.some((input) => input.validationState.state === "invalid")
                ? "invalid"
                : "valid",
        }),
    });
}
