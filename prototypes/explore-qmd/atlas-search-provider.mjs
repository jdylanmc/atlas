import { createStore } from "@tobilu/qmd";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PAGE_PATTERN =
  "{index.md,bonfires/**/*.md,insights/**/*.md,pillars/**/*.md,threads/**/*.md,lore/**/*.md}";

function parseAtlasHeader(markdown) {
  return {
    archetype:
      markdown.match(/^\s+type:\s*(.+)$/m)?.[1]?.trim() ?? "unknown",
    objectId: markdown.match(/^\s+id:\s*(.+)$/m)?.[1]?.trim() ?? "unknown",
    title:
      markdown.match(/^\s+title:\s*(.+)$/m)?.[1]?.trim() ??
      markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
      "Untitled",
  };
}

function parseLinks(markdown) {
  return [...markdown.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]);
}

function preview(markdown) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^#.*$/m, "")
    .replace(/\[\^.+?\]/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function atlasPath(result) {
  const prefix = `qmd://${result.collectionName}/`;
  return result.filepath.startsWith(prefix)
    ? result.filepath.slice(prefix.length)
    : result.displayPath.replace(prefix, "");
}

function entryBoost(archetype) {
  if (archetype === "bonfire") return 0.2;
  if (archetype === "insight" || archetype === "pillar") return 0.08;
  if (archetype === "thread") return 0.02;
  return 0;
}

export class QmdSearchProvider {
  #store;
  #realms;

  static async open({ dbPath, realms }) {
    const config = {
      global_context:
        "Atlas Realm knowledge pages. Skills, checks, prompts, and generated state are excluded.",
      collections: Object.fromEntries(
        Object.entries(realms).map(([key, realm]) => [
          key,
          {
            path: realm.root,
            pattern: PAGE_PATTERN,
            context: {
              "/": `Realm ${realm.slug}; snapshot ${realm.snapshot}; freshness ${realm.freshness}.`,
              "/bonfires":
                "Bonfire entry points return Realm Manifest and Laws context.",
            },
          },
        ]),
      ),
    };

    return new QmdSearchProvider({
      store: await createStore({ dbPath, config }),
      realms,
    });
  }

  constructor({ store, realms }) {
    this.#store = store;
    this.#realms = realms;
  }

  async sync() {
    return this.#store.update();
  }

  async status() {
    const collections = await this.#store.listCollections();
    return {
      engine: "qmd",
      mode: "lexical",
      indexedRealms: collections.map((collection) => ({
        realm: this.#realms[collection.name].slug,
        documents: collection.active_count,
      })),
    };
  }

  async query({ text, realms, limit = 8 }) {
    const collections = realms
      ? Object.entries(this.#realms)
          .filter(([, realm]) => realms.includes(realm.slug))
          .map(([key]) => key)
      : undefined;
    const raw = await this.#store.searchLex(text, {
      limit,
      collection: collections,
    });
    const results = await Promise.all(raw.map((result) => this.#wrap(result)));
    return results
      .sort((left, right) => right.entryScore - left.entryScore)
      .slice(0, limit);
  }

  async get(result) {
    const realmEntry = Object.entries(this.#realms).find(
      ([, realm]) => realm.slug === result.realm,
    );
    if (!realmEntry) return null;
    const [key] = realmEntry;
    return this.#store.getDocumentBody(`qmd://${key}/${result.path}`, {
      maxLines: 160,
    });
  }

  async #wrap(result) {
    const realm = this.#realms[result.collectionName];
    const markdown =
      (await this.#store.getDocumentBody(result.filepath, { maxLines: 160 })) ??
      "";
    const header = parseAtlasHeader(markdown);
    const wrapped = {
      resultId: `${realm.slug}:${header.objectId}`,
      realm: realm.slug,
      snapshot: realm.snapshot,
      freshness: realm.freshness,
      path: atlasPath(result),
      objectId: header.objectId,
      archetype: header.archetype,
      title: header.title,
      engineScore: result.score,
      entryScore: Math.min(1, result.score + entryBoost(header.archetype)),
      preview: preview(markdown),
      links: parseLinks(markdown),
    };

    if (header.archetype === "bonfire") {
      const [manifest, laws] = await Promise.all([
        readFile(join(realm.root, "realm/manifest.yaml"), "utf8"),
        readFile(join(realm.root, "realm/laws.md"), "utf8"),
      ]);
      wrapped.realmContext = { manifest, laws };
    }

    return wrapped;
  }

  async close() {
    await this.#store.close();
  }
}

export const searchProviderContract = {
  methods: ["sync", "status", "query", "get", "close"],
  queryResultFields: [
    "resultId",
    "realm",
    "snapshot",
    "freshness",
    "path",
    "objectId",
    "archetype",
    "title",
    "engineScore",
    "entryScore",
    "preview",
    "links",
    "realmContext?",
  ],
};

