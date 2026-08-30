import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import { buildAtlasView } from "../src/atlas/atlas_view.ts";
import {
  exploreAtlas,
  type ExploreBudgets,
  type SearchProvider,
} from "../src/graph/explore_atlas.ts";
import {
  exploreLexicalTokens,
  lexicalSearchProvider,
} from "../src/graph/lexical_search_provider.ts";
import { loadAndValidateAtlasInput } from "../src/lint/validate_atlas_input.ts";
import {
  runExploreOperation,
  runExploreOperationFromSnapshotCapture,
} from "../src/operations/explore_operation.ts";
import { runLintOperation } from "../src/operations/lint_operation.ts";
import { captureLocalAtlasSnapshot } from "../src/platform/local_atlas_snapshot.ts";
import { assertGrowthRatio } from "./growth.ts";

declare global {
  var __atlasExploreExecuted: boolean | undefined;
}

const encoder = new TextEncoder();
const fixturesRoot = resolve(import.meta.dirname, "fixtures", "complete-atlas");
const singleAtlasResultFixture = readFileSync(
  resolve(
    import.meta.dirname,
    "fixtures",
    "explore-operation-single-atlas-result.json",
  ),
  "utf8",
);
const workspaceRoot = resolve(import.meta.dirname, "..", ".test-workspaces");

const budgets: ExploreBudgets = Object.freeze({
  maxContextCharacters: 4096,
  maxEdges: 128,
  maxFileBytes: 8192,
  maxObjects: 128,
  maxQueryCharacters: 256,
  maxResults: 5,
  maxRouteEdges: 16,
  maxTerms: 256,
  maxTotalBytes: 65536,
});

const paths = [
  ".atlas/manifest.json",
  ".atlas/CHANGELOG.md",
  ".atlas/sources/atlas-sdk-lint.md",
  ".atlas/index.md",
  ".atlas/edges/lint-covers-canonical-serialization.md",
  ".atlas/principles/determinism.md",
  ".atlas/concepts/canonical-serialization.md",
  ".atlas/anchors/lint.md",
] as const;

function captured(path: string, content: string): CapturedAtlasFile {
  return { bytes: encoder.encode(content), path };
}

function fixture(path: string): CapturedAtlasFile {
  return captured(path, readFileSync(resolve(fixturesRoot, path), "utf8"));
}

function completeAtlas(): CapturedAtlasFile[] {
  return paths.map(fixture);
}

function requireSnapshot(
  capture: ReturnType<typeof captureLocalAtlasSnapshot>,
): Extract<
  ReturnType<typeof captureLocalAtlasSnapshot>,
  { readonly state: "captured" }
>["snapshot"] {
  assert.equal(capture.state, "captured");
  return capture.snapshot;
}

function exploreCaptured(
  files: readonly CapturedAtlasFile[],
  query: string,
  provider: SearchProvider = lexicalSearchProvider,
  exploreBudgets: ExploreBudgets = budgets,
): ReturnType<typeof exploreAtlas> {
  const validated = loadAndValidateAtlasInput(files, exploreBudgets);
  const atlasView = buildAtlasView({
    identity: {
      atlas: { reference: "fixture", state: "known" },
      role: "home",
      slug: "fixture",
      snapshot: { reference: "fixture-base", state: "known" },
    },
    validation: validated,
  });
  return exploreAtlas(atlasView, query, provider, exploreBudgets);
}

function page(
  path: string,
  id: string,
  type: string,
  title: string,
  body: string,
  atlas = "{}",
  dates: { readonly created: string; readonly updated: string } = Object.freeze({
    created: "2026-08-17T00:00:00Z",
    updated: "2026-08-17T00:00:00Z",
  }),
): CapturedAtlasFile {
  return captured(
    path,
    [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      "  local-atlas-schema: 1.0.0",
      `  id: ${id}`,
      `  type: ${type}`,
      `  title: ${title}`,
      `  created-at: "${dates.created}"`,
      `  updated-at: "${dates.updated}"`,
      "  created-by: { kind: human, name: Fixture Author }",
      "  updated-by: { kind: human, name: Fixture Author }",
      "  tags: []",
      `atlas: ${atlas}`,
      "---",
      body,
    ].join("\n"),
  );
}

function edge(name: string, from: string, to: string): CapturedAtlasFile {
  return page(
    `.atlas/edges/${name}.md`,
    `edge:${name}`,
    "edge",
    name
      .split("-")
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join(" "),
    `# ${name}`,
    `{ from: ${from}, to: ${to}, semantics: [related] }`,
  );
}

function graphAtlas(): CapturedAtlasFile[] {
  return [
    page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
    page(".atlas/anchors/a.md", "anchor:a", "anchor", "A", "# A"),
    page(".atlas/anchors/b.md", "anchor:b", "anchor", "B", "# B"),
    page(
      ".atlas/principles/one.md",
      "principle:one",
      "principle",
      "One",
      "# One\n\n## Active truths\n\n- `truth:one` Use deterministic routing\n  with wrapped Markdown continuation.\nnot a continuation\n- `truth:two` Preserve cited evidence.",
    ),
    page(
      ".atlas/concepts/target.md",
      "concept:target",
      "concept",
      "Target",
      "# Target\n\nneedle topic.[^s]\n\n[^s]: [[.atlas/sources/s]] Source.",
    ),
    page(
      ".atlas/concepts/other.md",
      "concept:other",
      "concept",
      "Other",
      "# Other\n\nneedle.",
    ),
    page(
      ".atlas/concepts/independent.md",
      "concept:independent",
      "concept",
      "Independent",
      "# Independent\n\nneedle.",
    ),
    page(".atlas/sources/s.md", "source:s", "source", "S", "# S\n\nCited source."),
    edge("a-principle", "anchor:a", "principle:one"),
    edge("a-target", "anchor:a", "concept:target"),
    edge("b-independent", "anchor:b", "concept:independent"),
    edge("b-other", "anchor:b", "concept:other"),
    edge("target-other", "concept:target", "concept:other"),
    edge("other-a", "concept:other", "anchor:a"),
  ];
}

test("single-Atlas Explore output remains byte-identical for the complete fixture", () => {
  const result = runExploreOperation({
    baseSnapshot: {
      reference: "0123456789abcdef0123456789abcdef01234567",
      state: "known",
    },
    capturedFiles: completeAtlas(),
    homeAtlas: { reference: "github.com/jdylanmc/atlas", state: "known" },
    query: "canonical bytes",
    budgets,
  });

  assert.equal(`${JSON.stringify(result, null, 2)}\n`, singleAtlasResultFixture);
});

test("Explore returns shortest Anchor-to-result route with cited context", () => {
  const result = runExploreOperation({
    baseSnapshot: {
      reference: "0123456789abcdef0123456789abcdef01234567",
      state: "known",
    },
    capturedFiles: completeAtlas(),
    homeAtlas: { reference: "github.com/jdylanmc/atlas", state: "known" },
    query: "canonical bytes",
    budgets,
  });

  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.payload.degradation.level, "valid-structured");
  const firstResult = result.payload.results[0];
  assert.ok(firstResult);
  assert.deepEqual(
    firstResult.route.map((step) => step.objectId),
    ["anchor:root", "anchor:lint", "concept:canonical-serialization"],
  );
  assert.deepEqual(
    firstResult.citedContext.map((context) => context.id),
    ["concept:canonical-serialization", "source:atlas-sdk-lint"],
  );
  assert.deepEqual(
    result.payload.reanchors.map((entry) => entry.anchor.id),
    ["anchor:root", "anchor:lint"],
  );
});

test("every reached Anchor re-anchors with directly connected active Principles", () => {
  const result = exploreCaptured(
    graphAtlas(),
    "needle",
    lexicalSearchProvider,
    budgets,
  );

  assert.deepEqual(
    result.reanchors.map((entry) => ({
      anchor: entry.anchor.id,
      objective: entry.activeObjective,
      principles: entry.activePrinciples.map((principle) => principle.id),
      truths: entry.governingTruths.map((truth) => [
        truth.principleId,
        truth.truthId,
        truth.text,
      ]),
    })),
    [
      { anchor: "anchor:root", objective: "needle", principles: [], truths: [] },
      {
        anchor: "anchor:a",
        objective: "needle",
        principles: ["principle:one"],
        truths: [
          [
            "principle:one",
            "truth:one",
            "Use deterministic routing with wrapped Markdown continuation.",
          ],
          ["principle:one", "truth:two", "Preserve cited evidence."],
        ],
      },
      { anchor: "anchor:b", objective: "needle", principles: [], truths: [] },
    ],
  );
});

test("cyclic Edges terminate and preserve independently reachable results", () => {
  const result = exploreCaptured(
    graphAtlas(),
    "needle",
    lexicalSearchProvider,
    budgets,
  );

  assert.deepEqual(
    result.results.map((entry) => entry.result.id),
    ["concept:other", "concept:target", "concept:independent"],
  );
  assert.deepEqual(
    result.results.map((entry) => entry.route.map((step) => step.objectId)),
    [
      ["anchor:root", "anchor:a", "concept:other"],
      ["anchor:root", "anchor:a", "concept:target"],
      ["anchor:root", "anchor:b", "concept:independent"],
    ],
  );
});

test("Root Anchor catalogs otherwise unreachable non-Anchor pages", () => {
  const result = exploreCaptured(
    [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(
        ".atlas/principles/cataloged.md",
        "principle:cataloged",
        "principle",
        "Cataloged",
        "# Cataloged\n\n## Active truths\n\n- `truth:cataloged` needle principle.",
      ),
    ],
    "needle",
    lexicalSearchProvider,
    budgets,
  );

  assert.deepEqual(
    result.results.map((entry) => ({
      id: entry.result.id,
      route: entry.route.map((step) => step.objectId),
    })),
    [
      {
        id: "principle:cataloged",
        route: ["anchor:root", "principle:cataloged"],
      },
    ],
  );
});

test("equal-length route ties use the declared route code-point order", () => {
  const provider: SearchProvider = Object.freeze({
    rank: () =>
      Object.freeze([
        Object.freeze({ objectId: "concept:z", score: 1 }),
        Object.freeze({ objectId: "concept:a", score: 1 }),
      ]),
  });
  const atlas = [
    page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
    page(".atlas/anchors/a.md", "anchor:a", "anchor", "A", "# A"),
    page(".atlas/anchors/b.md", "anchor:b", "anchor", "B", "# B"),
    page(".atlas/concepts/a.md", "concept:a", "concept", "A Result", "# A Result"),
    page(".atlas/concepts/z.md", "concept:z", "concept", "Z Result", "# Z Result"),
    edge("a-z", "anchor:a", "concept:z"),
    edge("b-a", "anchor:b", "concept:a"),
  ];

  const result = exploreCaptured(atlas, "ignored", provider, budgets);

  assert.deepEqual(
    result.results.map((entry) => entry.result.id),
    ["concept:z", "concept:a"],
  );
});

test("Explore tie-breakers cover route length, duplicate routes, and Edge IDs", () => {
  const duplicateProvider: SearchProvider = Object.freeze({
    rank: () =>
      Object.freeze([
        Object.freeze({ objectId: "concept:a", score: 1 }),
        Object.freeze({ objectId: "concept:a", score: 1 }),
      ]),
  });
  const duplicate = exploreCaptured(
    [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(".atlas/anchors/a.md", "anchor:a", "anchor", "A", "# A"),
      page(".atlas/concepts/a.md", "concept:a", "concept", "A Result", "# A Result"),
      edge("a", "anchor:a", "concept:a"),
      edge("root-a", "anchor:root", "anchor:a"),
      edge("root-a-second", "anchor:root", "anchor:a"),
    ],
    "ignored",
    duplicateProvider,
    budgets,
  );
  assert.deepEqual(
    duplicate.results.map((entry) => entry.result.id),
    ["concept:a"],
  );
  assert.ok(
    duplicate.degradation.diagnostics.some(
      (diagnostic) => diagnostic.code === "ATLAS_EXPLORE_PROVIDER_CANDIDATE_INVALID",
    ),
  );

  const lengthProvider: SearchProvider = Object.freeze({
    rank: () =>
      Object.freeze([
        Object.freeze({ objectId: "concept:target", score: 1 }),
        Object.freeze({ objectId: "anchor:a", score: 1 }),
      ]),
  });
  const byLength = exploreCaptured(graphAtlas(), "ignored", lengthProvider, budgets);
  assert.deepEqual(
    byLength.results.map((entry) => entry.result.id),
    ["anchor:a", "concept:target"],
  );
});

test("route-edge budget bounds traversal without dropping Re-anchoring", () => {
  const result = exploreCaptured(graphAtlas(), "needle", lexicalSearchProvider, {
    ...budgets,
    maxRouteEdges: 0,
  });

  assert.deepEqual(
    result.reanchors.map((entry) => entry.anchor.id),
    ["anchor:root"],
  );
  assert.deepEqual(
    result.results.map((entry) => entry.result.id),
    [],
  );
});

test("malformed material degrades to partial structure before traversal", () => {
  const atlas = graphAtlas().map((file) =>
    file.path === ".atlas/concepts/other.md"
      ? captured(file.path, "# no frontmatter\nneedle")
      : file,
  );
  const result = exploreCaptured(atlas, "target", lexicalSearchProvider, budgets);

  assert.equal(result.degradation.level, "partial-structure");
  assert.equal(result.results[0]?.result.id, "concept:target");
  assert.ok(
    result.degradation.diagnostics.some(
      (diagnostic) => diagnostic.code === "ATLAS_PAGE_MISSING_FRONTMATTER",
    ),
  );

  const operation = runExploreOperation({
    baseSnapshot: { reason: "unit", state: "unknown" },
    capturedFiles: atlas,
    homeAtlas: { reason: "unit", state: "unknown" },
    query: "target",
    budgets,
  });
  assert.equal(operation.handoff.validationState.state, "failed");
});

test("Edge pages without route endpoints are ignored deterministically", () => {
  const result = exploreCaptured(
    [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(
        ".atlas/edges/incomplete.md",
        "edge:incomplete",
        "edge",
        "Incomplete",
        "# Incomplete",
      ),
    ],
    "root",
    lexicalSearchProvider,
    budgets,
  );

  assert.equal(result.results[0]?.result.id, "anchor:root");
});

test("raw Markdown degradation is visible when no structured page is usable", () => {
  const result = exploreCaptured(
    [
      captured(".atlas/notes.md", "# Note\n\nraw needle"),
      captured(".atlas/notes.txt", "ignored raw needle"),
    ],
    "needle",
    lexicalSearchProvider,
    budgets,
  );

  assert.equal(result.degradation.level, "raw-markdown");
  const firstResult = result.results[0];
  assert.ok(firstResult);
  assert.deepEqual(firstResult.route, []);
  assert.equal(firstResult.result.id, "raw-markdown/.atlas/notes.md");

  const hostileProvider: SearchProvider = Object.freeze({
    rank: () => Object.freeze([Object.freeze({ objectId: "missing", score: 1 })]),
  });
  const hostile = exploreCaptured(
    [captured(".atlas/notes.md", "# Note\n\nraw needle")],
    "needle",
    hostileProvider,
    budgets,
  );
  assert.equal(hostile.degradation.level, "partial-structure");
  assert.ok(
    hostile.degradation.diagnostics.some(
      (diagnostic) => diagnostic.code === "ATLAS_EXPLORE_PROVIDER_CANDIDATE_INVALID",
    ),
  );
});

test("no usable material returns blocked remediation", () => {
  const result = runExploreOperation({
    baseSnapshot: { reason: "unit", state: "unknown" },
    capturedFiles: [],
    homeAtlas: { reason: "unit", state: "unknown" },
    query: "anything",
    budgets,
  });

  assert.equal(result.completion, "not-completed");
  assert.equal(result.payload.degradation.level, "blocked");
  assert.match(result.handoff.recommendedNextAction, /Provide at least one/u);
});

test("invalid budgets and oversized queries block before traversal", () => {
  assert.throws(
    () =>
      exploreCaptured(graphAtlas(), "needle", lexicalSearchProvider, {
        ...budgets,
        maxEdges: -1,
      }),
    /Explore budgets/u,
  );

  const result = exploreCaptured(graphAtlas(), "needle", lexicalSearchProvider, {
    ...budgets,
    maxQueryCharacters: 3,
  });

  assert.equal(result.degradation.level, "blocked");
  assert.equal(
    result.degradation.diagnostics[0]?.code,
    "ATLAS_EXPLORE_QUERY_TOO_LARGE",
  );
});

test("load failures and missing Root Anchor are visible degradations", () => {
  const loadFailure = exploreCaptured(
    [{ bytes: encoder.encode("x"), path: "/not-atlas.md" }],
    "needle",
    lexicalSearchProvider,
    budgets,
  );
  assert.equal(loadFailure.degradation.level, "blocked");
  assert.equal(loadFailure.degradation.diagnostics[0]?.code, "ATLAS_LOAD_INVALID_PATH");

  const noRoot = exploreCaptured(
    [
      page(
        ".atlas/concepts/only.md",
        "concept:only",
        "concept",
        "Only",
        "# Only\n\nneedle",
      ),
    ],
    "needle",
    lexicalSearchProvider,
    budgets,
  );
  assert.equal(noRoot.degradation.level, "blocked");
  assert.equal(noRoot.degradation.diagnostics[0]?.code, "ATLAS_ROOT_ANCHOR_REQUIRED");
  assert.deepEqual(noRoot.reanchors, []);
  assert.deepEqual(noRoot.results, []);

  const nonAtlasLoadFailure = exploreCaptured(
    [{ bytes: "not bytes" as unknown as Uint8Array, path: ".atlas/index.md" }],
    "needle",
    lexicalSearchProvider,
    budgets,
  );
  assert.equal(
    nonAtlasLoadFailure.degradation.diagnostics[0]?.message,
    "Captured Atlas files could not be loaded.",
  );
});

test("structurally invalid Atlases cannot report valid structured Explore", () => {
  const duplicateIds = exploreCaptured(
    [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(".atlas/concepts/a.md", "concept:dup", "concept", "A", "# A\n\nneedle"),
      page(".atlas/concepts/b.md", "concept:dup", "concept", "B", "# B\n\nneedle"),
    ],
    "needle",
    lexicalSearchProvider,
    budgets,
  );
  assert.equal(duplicateIds.degradation.level, "partial-structure");
  assert.ok(
    duplicateIds.degradation.diagnostics.some(
      (diagnostic) => diagnostic.code === "ATLAS_PAGE_ID_DUPLICATE",
    ),
  );

  const invalidTypePath = exploreCaptured(
    [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(".atlas/concepts/wrong.md", "concept:wrong", "anchor", "Wrong", "# Wrong"),
    ],
    "wrong",
    lexicalSearchProvider,
    budgets,
  );
  assert.equal(invalidTypePath.degradation.level, "partial-structure");
  assert.ok(
    invalidTypePath.degradation.diagnostics.some(
      (diagnostic) => diagnostic.code === "ATLAS_PAGE_TYPE_PATH_MISMATCH",
    ),
  );
});

test("structurally invalid Atlases cannot yield a successful Explore operation", () => {
  const duplicateIds = runExploreOperation({
    baseSnapshot: { reference: "duplicate-fixture", state: "known" },
    capturedFiles: [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(".atlas/concepts/a.md", "concept:dup", "concept", "A", "# A\n\nneedle"),
      page(".atlas/concepts/b.md", "concept:dup", "concept", "B", "# B\n\nneedle"),
    ],
    homeAtlas: { reference: "fixture", state: "known" },
    query: "needle",
    budgets,
  });
  assert.equal(duplicateIds.completion, "completed");
  assert.equal(duplicateIds.disposition, "failed");
  assert.equal(duplicateIds.handoff.validationState.state, "failed");
  assert.ok(
    duplicateIds.handoff.validationState.findings.some(
      (finding) => finding.code === "ATLAS_PAGE_ID_DUPLICATE",
    ),
  );

  const invalidTypePath = runExploreOperation({
    baseSnapshot: { reference: "type-path-fixture", state: "known" },
    capturedFiles: [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(".atlas/concepts/wrong.md", "concept:wrong", "anchor", "Wrong", "# Wrong"),
    ],
    homeAtlas: { reference: "fixture", state: "known" },
    query: "wrong",
    budgets,
  });
  assert.equal(invalidTypePath.completion, "completed");
  assert.equal(invalidTypePath.disposition, "failed");
  assert.equal(invalidTypePath.handoff.validationState.state, "failed");
  assert.ok(
    invalidTypePath.handoff.validationState.findings.some(
      (finding) => finding.code === "ATLAS_PAGE_TYPE_PATH_MISMATCH",
    ),
  );
});

test("all accepted invalid Atlas variants preserve Explore degradation levels", () => {
  const root = (): CapturedAtlasFile =>
    page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root\n\nneedle");
  const cases = [
    {
      expectedCode: "ATLAS_PAGE_ID_DUPLICATE",
      expectedDegradation: "partial-structure",
      files: [
        root(),
        page(".atlas/concepts/a.md", "concept:dup", "concept", "A", "# A\n\nneedle"),
        page(".atlas/concepts/b.md", "concept:dup", "concept", "B", "# B\n\nneedle"),
      ],
      name: "duplicate-id",
    },
    {
      expectedCode: "ATLAS_PAGE_TYPE_PATH_MISMATCH",
      expectedDegradation: "partial-structure",
      files: [
        root(),
        page(".atlas/concepts/wrong.md", "concept:wrong", "anchor", "Wrong", "# Wrong"),
      ],
      name: "type-path-mismatch",
    },
    {
      expectedCode: "ATLAS_PAGE_TITLE_H1_MISMATCH",
      expectedDegradation: "partial-structure",
      files: [
        root(),
        page(
          ".atlas/concepts/title.md",
          "concept:title",
          "concept",
          "Title",
          "# Different\n\nneedle",
        ),
      ],
      name: "title-h1-mismatch",
    },
    {
      expectedCode: "ATLAS_PAGE_UPDATED_BEFORE_CREATED",
      expectedDegradation: "partial-structure",
      files: [
        root(),
        page(
          ".atlas/concepts/dates.md",
          "concept:dates",
          "concept",
          "Dates",
          "# Dates\n\nneedle",
          "{}",
          {
            created: "2026-08-18T00:00:00Z",
            updated: "2026-08-17T00:00:00Z",
          },
        ),
      ],
      name: "updated-before-created",
    },
    {
      expectedCode: "ATLAS_CITATION_TARGET_MISSING",
      expectedDegradation: "partial-structure",
      files: [
        root(),
        page(
          ".atlas/concepts/cite.md",
          "concept:cite",
          "concept",
          "Cite",
          "# Cite\n\nneedle.[^s]\n\n[^s]: [[.atlas/sources/missing]]",
        ),
      ],
      name: "citation-target-missing",
    },
    {
      expectedCode: "ATLAS_CITATION_TARGET_NOT_SOURCE",
      expectedDegradation: "partial-structure",
      files: [
        root(),
        page(
          ".atlas/concepts/cite.md",
          "concept:cite",
          "concept",
          "Cite",
          "# Cite\n\nneedle.[^s]\n\n[^s]: [[.atlas/concepts/target]]",
        ),
        page(
          ".atlas/concepts/target.md",
          "concept:target",
          "concept",
          "Target",
          "# Target",
        ),
      ],
      name: "citation-target-not-source",
    },
    {
      expectedCode: "ATLAS_PAGE_MISSING_FRONTMATTER",
      expectedDegradation: "partial-structure",
      files: [
        root(),
        captured(".atlas/concepts/no-frontmatter.md", "# No Frontmatter\n\nneedle"),
      ],
      name: "missing-frontmatter",
    },
    {
      expectedCode: "ATLAS_CUSTOM_TYPE_NAME_RESERVED",
      expectedDegradation: "partial-structure",
      files: [
        root(),
        page(
          ".atlas/types/concept/custom.md",
          "concept:custom",
          "concept",
          "Custom",
          "# Custom\n\nneedle",
        ),
      ],
      name: "reserved-custom-type",
    },
    {
      expectedCode: "ATLAS_ROOT_ANCHOR_REQUIRED",
      expectedDegradation: "blocked",
      files: [
        page(
          ".atlas/concepts/only.md",
          "concept:only",
          "concept",
          "Only",
          "# Only\n\nneedle",
        ),
      ],
      name: "root-anchor-missing",
    },
  ] as const;

  for (const entry of cases) {
    const lint = runLintOperation(entry.files, budgets);
    const explore = runExploreOperation({
      baseSnapshot: { reference: `${entry.name}-base`, state: "known" },
      capturedFiles: entry.files,
      homeAtlas: { reference: "fixture", state: "known" },
      query: "needle",
      budgets,
    });
    assert.equal(lint.disposition, "failed", entry.name);
    assert.equal(explore.disposition, "failed", entry.name);
    assert.equal(
      explore.payload.degradation.level,
      entry.expectedDegradation,
      entry.name,
    );
    assert.ok(
      lint.handoff.validationState.findings.some(
        (finding) => finding.code === entry.expectedCode,
      ),
      entry.name,
    );
    assert.deepEqual(
      explore.handoff.validationState.findings,
      lint.handoff.validationState.findings,
      entry.name,
    );
  }
});

test("Explore budgets cap object loading and context citation scans", () => {
  const capped = exploreCaptured(graphAtlas(), "needle", lexicalSearchProvider, {
    ...budgets,
    maxObjects: 1,
  });
  assert.equal(capped.results.length, 0);

  const edgeCapped = exploreCaptured(graphAtlas(), "needle", lexicalSearchProvider, {
    ...budgets,
    maxEdges: 0,
  });
  assert.equal(edgeCapped.degradation.level, "partial-structure");
  assert.ok(
    edgeCapped.degradation.diagnostics.some(
      (diagnostic) => diagnostic.code === "ATLAS_EXPLORE_EDGE_BUDGET_EXHAUSTED",
    ),
  );

  const malformedCitation = exploreCaptured(
    [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(
        ".atlas/concepts/cited.md",
        "concept:cited",
        "concept",
        "Cited",
        "# Cited\n\nneedle.[^s]\n\n[^s]: [[.atlas/sources/s",
      ),
      edge("root-cited", "anchor:root", "concept:cited"),
    ],
    "needle",
    lexicalSearchProvider,
    budgets,
  );
  assert.deepEqual(
    malformedCitation.results[0]?.citedContext.map((context) => context.id),
    ["concept:cited"],
  );
});

test("Explore cited context uses parser-recognized Citation definitions only", () => {
  const result = exploreCaptured(
    [
      page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
      page(
        ".atlas/concepts/citations.md",
        "concept:citations",
        "concept",
        "Citations",
        [
          "# Citations",
          "",
          "needle valid.[^valid] invalid.[^inline][^html][^link][^image][^duplicate][^rule][^break][^bad][^space][^concept][^dotted][^traversal]",
          "",
          "`not a citation [[.atlas/sources/inline-code]]`",
          "",
          "```",
          "[[.atlas/sources/fenced-code]]",
          "```",
          "",
          "<span>[[.atlas/sources/html]]</span>",
          "",
          "[[.atlas/sources/link-text]](https://example.invalid)",
          "",
          "![image [[.atlas/sources/image-alt]]](image.png)",
          "",
          "[^inline]: `[[.atlas/sources/inline-code]]`.",
          "[^fenced]:",
          "",
          "    [[.atlas/sources/fenced-code]]",
          "[^html]: <span>[[.atlas/sources/html]]</span>.",
          "[^link]: [[[.atlas/sources/link-text]]](https://example.invalid).",
          "[^image]: ![image [[.atlas/sources/image-alt]]](image.png).",
          "[^duplicate]: [[.atlas/sources/unused]] One.",
          "[^duplicate]: [[.atlas/sources/inline-code]] Two.",
          "[^rule]:",
          "",
          "***",
          "[^break]: line\\",
          "break.",
          "[^bad]: [[bad]] Bad.",
          "[^space]: [[.atlas/sources/bad target]] Bad.",
          "[^concept]: [[.atlas/concepts/not-source]] Concept.",
          "[^dotted]: [[.atlas/sources/dotted.md]] Dotted.",
          "[^traversal]: [[.atlas/sources/../valid]] Traversal.",
          "[^unused]: [[.atlas/sources/unused]] Unused.",
          "[^valid]: [[.atlas/sources/valid]] Valid.",
        ].join("\n"),
      ),
      page(".atlas/sources/valid.md", "source:valid", "source", "Valid", "# Valid"),
      page(
        ".atlas/sources/inline-code.md",
        "source:inline-code",
        "source",
        "Inline Code",
        "# Inline Code",
      ),
      page(
        ".atlas/sources/fenced-code.md",
        "source:fenced-code",
        "source",
        "Fenced Code",
        "# Fenced Code",
      ),
      page(".atlas/sources/html.md", "source:html", "source", "HTML", "# HTML"),
      page(
        ".atlas/sources/link-text.md",
        "source:link-text",
        "source",
        "Link Text",
        "# Link Text",
      ),
      page(
        ".atlas/sources/image-alt.md",
        "source:image-alt",
        "source",
        "Image Alt",
        "# Image Alt",
      ),
      page(".atlas/sources/unused.md", "source:unused", "source", "Unused", "# Unused"),
      edge("root-citations", "anchor:root", "concept:citations"),
    ],
    "needle",
    lexicalSearchProvider,
    budgets,
  );

  assert.deepEqual(
    result.results[0]?.citedContext.map((context) => context.id),
    ["concept:citations", "source:valid"],
  );
});

test("completed Explore can return no reachable result", () => {
  const result = runExploreOperation({
    baseSnapshot: { reason: "unit", state: "unknown" },
    capturedFiles: completeAtlas(),
    homeAtlas: { reason: "unit", state: "unknown" },
    query: "absent",
    budgets,
  });

  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "failed");
  assert.equal(result.handoff.validationState.state, "passed");
  assert.equal(result.handoff.result.summary, "Explore found no reachable result.");
  assert.equal(
    result.handoff.recommendedNextAction,
    "Refine the Explore request or add reachable Atlas knowledge.",
  );
});

test("invalid Search Provider candidates degrade visibly instead of throwing", () => {
  const provider: SearchProvider = Object.freeze({
    rank: () =>
      Object.freeze([
        Object.freeze({ objectId: "missing", score: 1 }),
        Object.freeze({ objectId: "concept:target", score: Number.NaN }),
        Object.freeze({ objectId: "concept:target", score: 1 }),
        Object.freeze({ objectId: "concept:target", score: 1 }),
      ]),
  });
  const result = exploreCaptured(graphAtlas(), "needle", provider, budgets);

  assert.equal(result.degradation.level, "partial-structure");
  assert.ok(
    result.degradation.diagnostics.some(
      (diagnostic) => diagnostic.code === "ATLAS_EXPLORE_PROVIDER_CANDIDATE_INVALID",
    ),
  );
  assert.deepEqual(
    result.results.map((entry) => entry.result.id),
    ["concept:target"],
  );
});

test("Atlas-owned executable material is not executed during Explore", () => {
  globalThis.__atlasExploreExecuted = false;
  const result = exploreCaptured(
    [
      ...graphAtlas(),
      captured(
        ".atlas/checks/observable.js",
        "globalThis.__atlasExploreExecuted = true;",
      ),
      captured(
        ".atlas/prompts/observable.md",
        "<script>globalThis.__atlasExploreExecuted = true;</script>",
      ),
      captured(
        ".atlas/skills/observable.ts",
        "globalThis.__atlasExploreExecuted = true;",
      ),
      captured(
        ".atlas/personas/observable.md",
        "${globalThis.__atlasExploreExecuted = true}",
      ),
      captured(
        ".atlas/directives/observable.md",
        "${globalThis.__atlasExploreExecuted = true}",
      ),
    ],
    "needle",
    lexicalSearchProvider,
    budgets,
  );

  assert.equal(result.results.length > 0, true);
  assert.equal(globalThis.__atlasExploreExecuted, false);
});

test("the lexical provider owns only deterministic candidate ranking", () => {
  const first = lexicalSearchProvider.rank(
    [
      {
        body: "alpha",
        id: "concept:b",
        path: "b",
        tags: [],
        title: "B",
        type: "concept",
      },
      {
        body: "alpha alpha",
        id: "concept:a",
        path: "a",
        tags: [],
        title: "A",
        type: "concept",
      },
    ],
    "alpha",
    budgets,
  );

  assert.deepEqual(first, [
    { objectId: "concept:a", score: 2 },
    { objectId: "concept:b", score: 1 },
  ]);
  assert.deepEqual(
    lexicalSearchProvider.rank(
      [
        {
          body: "alpha alpha",
          id: "concept:a",
          path: "a",
          tags: [],
          title: "A",
          type: "concept",
        },
        {
          body: "alpha",
          id: "concept:b",
          path: "b",
          tags: [],
          title: "B",
          type: "concept",
        },
      ],
      "alpha",
      budgets,
    ),
    first,
  );
  assert.deepEqual(exploreLexicalTokens("alpha beta", 1), ["alpha"]);
  assert.deepEqual(exploreLexicalTokens("alpha beta", 0), []);
  assert.deepEqual(exploreLexicalTokens("alpha", 0), []);
});

test("one Home Atlas commit remains fixed when the worktree changes", () => {
  const repo = resolve(workspaceRoot, "explore-snapshot");
  rmSync(repo, { force: true, recursive: true });
  mkdirSync(repo, { recursive: true });
  cpSync(resolve(fixturesRoot, ".atlas"), resolve(repo, ".atlas"), { recursive: true });
  exec(repo, ["init"]);
  exec(repo, ["config", "user.email", "fixture@example.invalid"]);
  exec(repo, ["config", "user.name", "Fixture"]);
  exec(repo, ["add", "."]);
  exec(repo, ["commit", "-m", "initial"]);
  const snapshot = requireSnapshot(captureLocalAtlasSnapshot(repo));
  writeFileSync(resolve(repo, ".atlas/concepts/canonical-serialization.md"), "changed");
  const result = runExploreOperationFromSnapshotCapture(
    {
      snapshot,
      state: "captured",
    },
    {
      query: "canonical bytes",
      budgets,
      provider: lexicalSearchProvider,
    },
  );
  const defaultBudgetResult = runExploreOperationFromSnapshotCapture(
    { snapshot, state: "captured" },
    { query: "canonical bytes" },
  );

  test("local Atlas snapshot ignores hostile Git executable resolution and environment", () => {
    const repo = resolve(workspaceRoot, "explore-snapshot-hostile");
    rmSync(repo, { force: true, recursive: true });
    mkdirSync(repo, { recursive: true });
    cpSync(resolve(fixturesRoot, ".atlas"), resolve(repo, ".atlas"), {
      recursive: true,
    });
    exec(repo, ["init"]);
    exec(repo, ["config", "user.email", "fixture@example.invalid"]);
    exec(repo, ["config", "user.name", "Fixture"]);
    exec(repo, ["add", "."]);
    exec(repo, ["commit", "-m", "initial"]);
    const realHead = execOutput(repo, ["rev-parse", "HEAD"]).trim();
    const hostileBin = resolve(repo, ".atlas", "bin");
    mkdirSync(hostileBin, { recursive: true });
    writeFileSync(
      resolve(hostileBin, "git"),
      "#!/bin/sh\necho ffffffffffffffffffffffffffffffffffffffff\n",
    );
    chmodSync(resolve(hostileBin, "git"), 0o755);

    const redirected = resolve(workspaceRoot, "explore-snapshot-redirected");
    rmSync(redirected, { force: true, recursive: true });
    mkdirSync(redirected, { recursive: true });
    cpSync(resolve(fixturesRoot, ".atlas"), resolve(redirected, ".atlas"), {
      recursive: true,
    });
    writeFileSync(
      resolve(redirected, ".atlas", "concepts", "canonical-serialization.md"),
      page(
        ".atlas/concepts/canonical-serialization.md",
        "concept:canonical-serialization",
        "concept",
        "Redirected",
        "# Redirected",
      ).bytes,
    );
    exec(redirected, ["init"]);
    exec(redirected, ["config", "user.email", "fixture@example.invalid"]);
    exec(redirected, ["config", "user.name", "Fixture"]);
    exec(redirected, ["add", "."]);
    exec(redirected, ["commit", "-m", "redirected"]);

    const originalPath = process.env["PATH"];
    const originalGitDir = process.env["GIT_DIR"];
    const originalGitWorkTree = process.env["GIT_WORK_TREE"];
    try {
      process.env["PATH"] = `${hostileBin}:${originalPath ?? ""}`;
      process.env["GIT_DIR"] = resolve(redirected, ".git");
      process.env["GIT_WORK_TREE"] = redirected;
      const snapshot = requireSnapshot(captureLocalAtlasSnapshot(repo));
      assert.deepEqual(snapshot.baseSnapshot, { reference: realHead, state: "known" });
      const result = runExploreOperation({ ...snapshot, query: "canonical", budgets });
      assert.equal(result.payload.results[0]?.result.title, "Canonical Serialization");
    } finally {
      if (originalPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = originalPath;
      if (originalGitDir === undefined) delete process.env["GIT_DIR"];
      else process.env["GIT_DIR"] = originalGitDir;
      if (originalGitWorkTree === undefined) delete process.env["GIT_WORK_TREE"];
      else process.env["GIT_WORK_TREE"] = originalGitWorkTree;
    }
    rmSync(repo, { force: true, recursive: true });
    rmSync(redirected, { force: true, recursive: true });
  });

  assert.equal(snapshot.baseSnapshot.state, "known");
  assert.match(snapshot.baseSnapshot.reference, /^[0-9a-f]{40}$/u);
  assert.equal(result.payload.results[0]?.result.title, "Canonical Serialization");
  assert.equal(
    defaultBudgetResult.payload.results[0]?.result.title,
    "Canonical Serialization",
  );
  rmSync(repo, { force: true, recursive: true });
});

test("local Atlas snapshot reports Git failures", () => {
  const missing = captureLocalAtlasSnapshot(resolve(workspaceRoot, "missing-repo"));
  assert.equal(missing.state, "failed");
  assert.match(missing.reason, /Git failed while capturing/u);
  const missingResult = runExploreOperationFromSnapshotCapture(missing, {
    query: "needle",
    budgets,
  });
  assert.equal(missingResult.completion, "not-completed");
  assert.equal(missingResult.disposition, "failed");
  assert.equal(
    missingResult.payload.degradation.diagnostics[0]?.code,
    "ATLAS_EXPLORE_SNAPSHOT_CAPTURE_FAILED",
  );

  const corruptTree = resolve(workspaceRoot, "explore-snapshot-corrupt-tree");
  rmSync(corruptTree, { force: true, recursive: true });
  mkdirSync(corruptTree, { recursive: true });
  cpSync(resolve(fixturesRoot, ".atlas"), resolve(corruptTree, ".atlas"), {
    recursive: true,
  });
  exec(corruptTree, ["init"]);
  exec(corruptTree, ["config", "user.email", "fixture@example.invalid"]);
  exec(corruptTree, ["config", "user.name", "Fixture"]);
  exec(corruptTree, ["add", "."]);
  exec(corruptTree, ["commit", "-m", "initial"]);
  const tree = execOutput(corruptTree, ["rev-parse", "HEAD^{tree}"]).trim();
  rmSync(resolve(corruptTree, ".git", "objects", tree.slice(0, 2), tree.slice(2)));
  const corruptTreeResult = captureLocalAtlasSnapshot(corruptTree);
  assert.equal(corruptTreeResult.state, "failed");
  assert.match(corruptTreeResult.reason, /Git failed while capturing/u);
  rmSync(corruptTree, { force: true, recursive: true });

  const repo = resolve(workspaceRoot, "explore-snapshot-corrupt");
  rmSync(repo, { force: true, recursive: true });
  mkdirSync(repo, { recursive: true });
  cpSync(resolve(fixturesRoot, ".atlas"), resolve(repo, ".atlas"), {
    recursive: true,
  });
  exec(repo, ["init"]);
  exec(repo, ["config", "user.email", "fixture@example.invalid"]);
  exec(repo, ["config", "user.name", "Fixture"]);
  exec(repo, ["add", "."]);
  exec(repo, ["commit", "-m", "initial"]);
  const object = execOutput(repo, ["ls-tree", "HEAD", ".atlas/index.md"])
    .trim()
    .split(/\s+/u)[2] as string;
  rmSync(resolve(repo, ".git", "objects", object.slice(0, 2), object.slice(2)));
  const corrupt = captureLocalAtlasSnapshot(repo);
  assert.equal(corrupt.state, "failed");
  assert.match(corrupt.reason, /Git failed while reading/u);
  rmSync(repo, { force: true, recursive: true });
});

test("Explore scanners and traversal stay within the doubling growth bound", () => {
  const generated = (count: number): CapturedAtlasFile[] =>
    Array.from({ length: count }, (_, index) => [
      page(
        `.atlas/concepts/generated-${String(index)}.md`,
        `concept:generated-${String(index)}`,
        "concept",
        `Generated ${String(index)}`,
        "# Generated\n\nneedle generated ".repeat(16),
      ),
      edge(
        `generated-${String(index)}`,
        "anchor:b",
        `concept:generated-${String(index)}`,
      ),
    ]).flat();
  const small = [...graphAtlas(), ...generated(20)];
  const large = [...graphAtlas(), ...generated(40)];
  const growthBudgets = { ...budgets, maxEdges: 256, maxObjects: 256, maxResults: 128 };
  assert.ok(
    exploreCaptured(large, "needle generated", lexicalSearchProvider, growthBudgets)
      .results.length >
      exploreCaptured(small, "needle generated", lexicalSearchProvider, growthBudgets)
        .results.length,
  );
  assertGrowthRatio({
    large: () => {
      exploreCaptured(large, "needle generated", lexicalSearchProvider, growthBudgets);
    },
    name: "Explore lexical indexing and bounded traversal",
    small: () => {
      exploreCaptured(small, "needle generated", lexicalSearchProvider, growthBudgets);
    },
  });
  assertGrowthRatio({
    large: () => {
      exploreLexicalTokens("alpha ".repeat(2048), 4096);
    },
    name: "Explore lexical tokenization",
    small: () => {
      exploreLexicalTokens("alpha ".repeat(1024), 4096);
    },
  });
});

function exec(repo: string, args: readonly string[]): void {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function execOutput(repo: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
