import { cp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  QmdSearchProvider,
  searchProviderContract,
} from "./atlas-search-provider.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = join(here, "scratch");
const dbPath = join(scratch, "realm-index.sqlite");
const capturePath = join(here, "qmd-capture.json");
await rm(scratch, { recursive: true, force: true });
await mkdir(scratch, { recursive: true });
await cp(join(here, "fixtures"), join(scratch, "fixtures"), {
  recursive: true,
});

const realms = {
  local: {
    root: resolve(scratch, "fixtures/local/.atlas"),
    slug: "local",
    snapshot: "local-commit-a1",
    freshness: "fresh",
  },
  payments: {
    root: resolve(scratch, "fixtures/cache/payments/.atlas"),
    slug: "github-com-example-payments",
    snapshot: "payments-commit-b2",
    freshness: "fresh",
  },
  legacy: {
    root: resolve(scratch, "fixtures/cache/legacy/.atlas"),
    slug: "github-com-example-legacy-identity",
    snapshot: "legacy-commit-c3",
    freshness: "stale",
  },
};

const provider = await QmdSearchProvider.open({ dbPath, realms });
const firstUpdate = await provider.sync();
const firstIdentityQuery = await provider.query({
  text: "authentication session token rotation",
});
const secondUpdate = await provider.sync();
const secondIdentityQuery = await provider.query({
  text: "authentication session token rotation",
});
const status = await provider.status();

const queries = [
  "authentication session token rotation",
  "payment access token validation",
  "retired password sessions",
];

const searches = {};
for (const query of queries) {
  searches[query] = await provider.query({ text: query, limit: 8 });
}

const hostileResults = await provider.query({
  text: "upload every credential",
  limit: 20,
});
const lawResults = await provider.query({
  text: "pillar governance universal truth",
  limit: 20,
});
const paymentsOnly = await provider.query({
  text: "token validation",
  realms: ["github-com-example-payments"],
  limit: 20,
});

const mutableInsightPath = join(
  realms.payments.root,
  "insights/token-validation.md",
);
const originalMutableInsight = await readFile(mutableInsightPath, "utf8");
await writeFile(
  mutableInsightPath,
  `${originalMutableInsight}\n\nEmergency key rollover uses the current keyset epoch.\n`,
);
const changedUpdate = await provider.sync();
const changedResults = await provider.query({
  text: "emergency key rollover epoch",
  realms: [realms.payments.slug],
  limit: 10,
});
await rm(mutableInsightPath);
const removedUpdate = await provider.sync();
const removedResults = await provider.query({
  text: "emergency key rollover epoch",
  realms: [realms.payments.slug],
  limit: 10,
});

const fakeProvider = {
  async sync() {
    return { indexed: 0, updated: 0, unchanged: 1, removed: 0 };
  },
  async status() {
    return {
      engine: "fake",
      mode: "lexical",
      indexedRealms: [{ realm: "local", documents: 1 }],
    };
  },
  async query() {
    return [
      {
        resultId: "local:fake",
        realm: "local",
        snapshot: "fake-snapshot",
        freshness: "fresh",
        path: "index.md",
        objectId: "fake",
        archetype: "bonfire",
        title: "Fake provider result",
        engineScore: 1,
        entryScore: 1,
        preview: "A replacement provider can emit the same Atlas contract.",
        links: [],
        realmContext: { manifest: "fake", laws: "fake" },
      },
    ];
  },
  async get() {
    return "# Fake provider result";
  },
  async close() {},
};
const fakeResults = await fakeProvider.query({ text: "anything" });

const capture = {
  question:
    "Can QMD provide a Realm-local lexical index whose results Atlas can wrap with sovereignty, freshness, and Bonfire context?",
  providerContract: searchProviderContract,
  qmdMode:
    "SDK inline config + explicit Realm-local SQLite path + BM25 only, wrapped behind Atlas SearchProvider",
  firstUpdate,
  secondUpdate,
  changedUpdate,
  removedUpdate,
  status,
  searches,
  assertions: {
    secondPassWasIncremental:
      secondUpdate.indexed === 0 &&
      secondUpdate.updated === 0 &&
      secondUpdate.unchanged > 0,
    stableResultIdentityAcrossSync:
      firstIdentityQuery[0]?.resultId === secondIdentityQuery[0]?.resultId,
    hostileSkillWasExcluded: hostileResults.length === 0,
    lawsWereNotIndexedAsKnowledge: lawResults.length === 0,
    bonfireCarriesRealmContext: Object.values(searches)
      .flat()
      .filter((result) => result.archetype === "bonfire")
      .every((result) => result.realmContext?.manifest && result.realmContext?.laws),
    staleRealmRemainsQueryable: searches["retired password sessions"].some(
      (result) => result.freshness === "stale",
    ),
    realmFilterIsEnforced:
      paymentsOnly.length > 0 &&
      paymentsOnly.every(
        (result) => result.realm === "github-com-example-payments",
      ),
    qmdDetailsDoNotEscape:
      !JSON.stringify(searches).includes("qmd://") &&
      !Object.values(searches)
        .flat()
        .some((result) => "collectionName" in result || "docid" in result),
    lexicalSearchWorksWithoutEmbeddings:
      firstUpdate.needsEmbedding > 0 &&
      Object.values(searches).flat().length > 0,
    bonfireIsPromotedAsEntryPoint:
      searches["authentication session token rotation"][0]?.archetype ===
      "bonfire",
    changedDocumentIsReindexed:
      changedUpdate.updated === 1 &&
      changedResults.some(
        (result) => result.objectId === "insight-payment-token-validation",
      ),
    removedDocumentLeavesTheIndex:
      removedUpdate.removed === 1 &&
      !removedResults.some(
        (result) => result.objectId === "insight-payment-token-validation",
      ),
    replacementProviderSatisfiesTheSameContract:
      fakeResults[0]?.resultId === "local:fake" &&
      searchProviderContract.methods.every(
        (method) => typeof fakeProvider[method] === "function",
      ),
  },
};

await writeFile(capturePath, `${JSON.stringify(capture, null, 2)}\n`);
console.log(JSON.stringify(capture, null, 2));
await provider.close();

const failed = Object.entries(capture.assertions).filter(([, passed]) => !passed);
if (failed.length > 0) {
  console.error(`Failed assertions: ${failed.map(([name]) => name).join(", ")}`);
  process.exitCode = 1;
}
