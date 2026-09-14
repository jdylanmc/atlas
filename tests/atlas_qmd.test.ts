import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  atlasQmdRelease,
  createLocalAtlasQmdRuntime,
  prepareAtlasQmd,
  type AtlasQmdRuntime,
} from "../src/extensions/atlas_qmd.ts";
import type {
  ExploreCandidate,
  ExploreBudgets,
  ExploreSearchDocument,
  SearchProviderRanking,
} from "../src/graph/explore_atlas.ts";

const budgets: Pick<ExploreBudgets, "maxQueryCharacters" | "maxTerms"> = Object.freeze({
  maxQueryCharacters: 256,
  maxTerms: 128,
});

const documents: readonly ExploreSearchDocument[] = Object.freeze([
  Object.freeze({
    body: "deterministic canonical serialization",
    id: "concept:canonical",
    path: ".atlas/concepts/canonical.md",
    tags: Object.freeze(["serialization"]),
    title: "Canonical serialization",
    type: "concept",
  }),
]);
const workspace = resolve(import.meta.dirname, "..", ".test-workspaces", "atlas-qmd");

test.beforeEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

test.after(() => {
  rmSync(workspace, { force: true, recursive: true });
});

function candidatesOf(
  ranking: readonly ExploreCandidate[] | SearchProviderRanking,
): readonly ExploreCandidate[] {
  return Array.isArray(ranking)
    ? ranking
    : (ranking as SearchProviderRanking).candidates;
}

function runtime(
  initialState: "corrupt" | "missing" | "ready" = "ready",
): AtlasQmdRuntime & {
  readonly calls: {
    readonly install: string[];
    readonly modes: string[];
  };
} {
  let state = initialState;
  const calls = {
    install: [] as string[],
    modes: [] as string[],
  };
  return {
    calls,
    inspectToolRuntime: () =>
      state === "ready" ? { state } : { reason: `${state} fixture runtime`, state },
    installToolRuntime: (proposal) => {
      calls.install.push(proposal.digest);
      state = "ready";
    },
    rank: (request) => {
      calls.modes.push(request.mode);
      return Object.freeze([
        Object.freeze({ objectId: request.documents[0]?.id ?? "", score: 1 }),
      ]);
    },
  };
}

test("atlas-qmd reports unsupported targets and preserves lexical Explore", () => {
  const prepared = prepareAtlasQmd({
    architecture: "arm64",
    atlasHostDirectory: "/fixture/atlas",
    atlasVersion: "commit-a",
    platform: "win32",
  });

  assert.equal(prepared.capability.state, "unsupported");
  assert.equal(prepared.mode, "lexical-fallback");
  assert.match(prepared.capability.reason, /win32-arm64/u);
  const ranking = prepared.provider.rank(documents, "canonical", budgets);
  assert.deepEqual(
    candidatesOf(ranking).map((candidate) => candidate.objectId),
    ["concept:canonical"],
  );
});

test("atlas-qmd proposes the pinned Tool Runtime before installation", () => {
  const fake = runtime("missing");
  const prepared = prepareAtlasQmd(
    {
      architecture: "arm64",
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      platform: "darwin",
      toolRuntimeRoot: "/fixture/cache/tool-runtimes/qmd/2.8.3",
    },
    fake,
  );

  assert.equal(prepared.mode, "lexical-fallback");
  assert.ok(prepared.installationProposal);
  assert.equal(prepared.installationProposal.package.name, "@tobilu/qmd");
  assert.equal(prepared.installationProposal.package.version, "2.8.3");
  assert.equal(
    prepared.installationProposal.package.unpackedBytes,
    atlasQmdRelease.packageUnpackedBytes,
  );
  assert.equal(
    prepared.installationProposal.location,
    "/fixture/cache/tool-runtimes/qmd/2.8.3",
  );
  assert.deepEqual(fake.calls.install, []);
});

test("atlas-qmd installs only with approval bound to the exact proposal", () => {
  const fake = runtime("missing");
  const first = prepareAtlasQmd(
    {
      architecture: "arm64",
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      platform: "darwin",
      toolRuntimeRoot: "/fixture/runtime",
    },
    fake,
  );
  assert.ok(first.installationProposal);

  const mismatched = prepareAtlasQmd(
    {
      architecture: "arm64",
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      installationApproval: {
        approvedAt: "2026-09-13T20:30:00Z",
        approvedBy: "Fixture Maintainer",
        proposalDigest: "wrong",
      },
      platform: "darwin",
      toolRuntimeRoot: "/fixture/runtime",
    },
    fake,
  );
  assert.equal(mismatched.mode, "lexical-fallback");
  assert.deepEqual(fake.calls.install, []);

  const approved = prepareAtlasQmd(
    {
      architecture: "arm64",
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      installationApproval: {
        approvedAt: "2026-09-13T20:30:00Z",
        approvedBy: "Fixture Maintainer",
        proposalDigest: first.installationProposal.digest,
      },
      platform: "darwin",
      toolRuntimeRoot: "/fixture/runtime",
    },
    fake,
  );

  assert.equal(approved.mode, "qmd-lexical");
  assert.deepEqual(fake.calls.install, [first.installationProposal.digest]);
});

test("atlas-qmd requires separate model approval and keeps lexical paths", () => {
  const fake = runtime();
  const lexical = prepareAtlasQmd(
    {
      architecture: "arm64",
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      platform: "darwin",
      semantic: true,
    },
    fake,
  );

  assert.equal(lexical.mode, "qmd-lexical");
  assert.ok(lexical.modelProposal);
  lexical.provider.rank(documents, "canonical", budgets);
  assert.deepEqual(fake.calls.modes, ["lexical"]);

  const semantic = prepareAtlasQmd(
    {
      architecture: "arm64",
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      modelApproval: {
        approvedAt: "2026-09-13T20:31:00Z",
        approvedBy: "Fixture Maintainer",
        proposalDigest: lexical.modelProposal.digest,
      },
      platform: "darwin",
      semantic: true,
    },
    fake,
  );
  assert.equal(semantic.mode, "qmd-semantic");
  semantic.provider.rank(documents, "canonical", budgets);
  assert.deepEqual(fake.calls.modes, ["lexical", "semantic"]);
});

test("atlas-qmd repairs corrupt owned runtime state only after bound approval", () => {
  const fake = runtime("corrupt");
  const first = prepareAtlasQmd(
    {
      architecture: "x64",
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      platform: "linux",
    },
    fake,
  );
  assert.ok(first.installationProposal);
  assert.match(first.installationProposal.reason, /corrupt/u);

  const repaired = prepareAtlasQmd(
    {
      architecture: "x64",
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      installationApproval: {
        approvedAt: "2026-09-13T20:32:00Z",
        approvedBy: "Fixture Maintainer",
        proposalDigest: first.installationProposal.digest,
      },
      platform: "linux",
    },
    fake,
  );

  assert.equal(repaired.mode, "qmd-lexical");
  assert.deepEqual(fake.calls.install, [first.installationProposal.digest]);
});

test("the local atlas-qmd runtime builds and repairs an exact-version disposable index", () => {
  const toolRuntimeRoot = join(workspace, "runtime");
  const packageRoot = join(toolRuntimeRoot, "node_modules", "@tobilu", "qmd");
  const bin = join(packageRoot, "bin", "qmd");
  mkdirSync(join(packageRoot, "bin"), { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: "@tobilu/qmd",
      type: "module",
      version: "2.8.3",
    })}\n`,
    "utf8",
  );
  writeFileSync(
    bin,
    [
      'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      "const [command] = process.argv.slice(2);",
      'mkdirSync(".qmd", { recursive: true });',
      'appendFileSync(join(".qmd", "commands.log"), `${process.argv.slice(2).join(" ")}\\n`);',
      'if (command === "--version") process.stdout.write("qmd 2.8.3\\n");',
      'if (command === "init") {',
      '  writeFileSync(join(".qmd", "index.yml"), "collections: {}\\n");',
      '  writeFileSync(join(".qmd", "index.sqlite"), "fixture");',
      "}",
      'if (command === "search" || command === "query") {',
      '  process.stdout.write(JSON.stringify([{ file: "documents/000000.md", score: 0.91 }]));',
      "}",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(toolRuntimeRoot, "atlas-qmd-runtime.json"),
    `${JSON.stringify({
      architecture: process.arch,
      nodeExecutable: process.execPath,
      nodeMajor: 22,
      packageName: "@tobilu/qmd",
      packageVersion: "2.8.3",
      platform: process.platform,
      schema: "1.0.0",
    })}\n`,
    "utf8",
  );
  writeFileSync(
    join(toolRuntimeRoot, ".atlas-qmd-owned"),
    "atlas-qmd-tool-runtime-owned\n",
    "utf8",
  );

  const indexRoot = join(workspace, "indexes");
  const unrelated = join(indexRoot, "unrelated.txt");
  mkdirSync(indexRoot, { recursive: true });
  writeFileSync(unrelated, "preserve", "utf8");
  const prepared = prepareAtlasQmd(
    {
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      toolRuntimeRoot,
    },
    createLocalAtlasQmdRuntime({ indexRoot }),
  );

  assert.equal(prepared.mode, "qmd-lexical");
  assert.deepEqual(
    candidatesOf(prepared.provider.rank(documents, "canonical", budgets)),
    [{ objectId: "concept:canonical", score: 0.91 }],
  );

  const hostKey = createHash("sha256")
    .update(resolve("/fixture/atlas"))
    .digest("hex")
    .slice(0, 24);
  const versionKey = createHash("sha256").update("commit-a").digest("hex").slice(0, 24);
  const indexDirectory = join(indexRoot, hostKey, versionKey);
  const manifestPath = join(indexDirectory, "atlas-qmd-index.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly atlasVersion: string;
    readonly documents: Readonly<Record<string, string>>;
  };
  assert.equal(manifest.atlasVersion, "commit-a");
  assert.deepEqual(manifest.documents, {
    "000000.md": "concept:canonical",
  });
  assert.match(
    readFileSync(join(indexDirectory, ".qmd", "commands.log"), "utf8"),
    /init\ncollection add .* --name atlas --mask \*\.md\nupdate\nsearch --format json -n 1 -c atlas -- canonical/u,
  );

  writeFileSync(manifestPath, "{corrupt", "utf8");
  assert.deepEqual(
    candidatesOf(prepared.provider.rank(documents, "canonical", budgets)),
    [{ objectId: "concept:canonical", score: 0.91 }],
  );
  assert.equal(readFileSync(unrelated, "utf8"), "preserve");
  assert.equal(
    (
      readFileSync(join(indexDirectory, ".qmd", "commands.log"), "utf8").match(
        /^init$/gmu,
      ) ?? []
    ).length,
    1,
  );
});

test("the local atlas-qmd runtime refuses to replace unowned state", () => {
  const toolRuntimeRoot = join(workspace, "unowned-runtime");
  const sentinel = join(toolRuntimeRoot, "sentinel.txt");
  mkdirSync(toolRuntimeRoot, { recursive: true });
  writeFileSync(sentinel, "preserve", "utf8");
  const fake = runtime("missing");
  const prepared = prepareAtlasQmd(
    {
      atlasHostDirectory: "/fixture/atlas",
      atlasVersion: "commit-a",
      toolRuntimeRoot,
    },
    fake,
  );
  assert.ok(prepared.installationProposal);
  const proposal = prepared.installationProposal;

  const local = createLocalAtlasQmdRuntime({
    run: () => {
      throw new Error("package manager must not run for unowned state");
    },
  });
  assert.throws(
    () =>
      local.installToolRuntime(proposal, {
        architecture: process.arch,
        atlasHostDirectory: "/fixture/atlas",
        atlasVersion: "commit-a",
        platform: process.platform,
        toolRuntimeRoot,
      }),
    /unowned atlas-qmd state/u,
  );
  assert.equal(readFileSync(sentinel, "utf8"), "preserve");
});

test("atlas-qmd requires an exact Atlas identity before touching a runtime", () => {
  assert.throws(
    () =>
      prepareAtlasQmd({
        atlasHostDirectory: "/fixture/atlas",
        atlasVersion: " ",
      }),
    /exact resolved Atlas version/u,
  );
  assert.throws(
    () =>
      prepareAtlasQmd({
        atlasHostDirectory: " ",
        atlasVersion: "commit-a",
      }),
    /Atlas Host Directory/u,
  );
});
