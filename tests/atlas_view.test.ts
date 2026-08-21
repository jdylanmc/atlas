import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildAtlasView } from "../src/atlas/atlas_view.ts";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import { loadAndValidateAtlasInput } from "../src/lint/validate_atlas_input.ts";
import { assertGrowthRatio, assertWallClockUnder } from "./growth.ts";

const encoder = new TextEncoder();

const budgets = Object.freeze({
  maxFileBytes: 8192,
  maxTotalBytes: 65536,
});

function captured(path: string, content: string): CapturedAtlasFile {
  return { bytes: encoder.encode(content), path };
}

function page(
  path: string,
  id: string,
  type: string,
  title: string,
  body: string,
  atlas = "{}",
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
      '  created-at: "2026-08-17T00:00:00Z"',
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  created-by: { kind: human, name: Fixture Author }",
      "  updated-by: { kind: agent, name: Fixture Agent }",
      "  tags: [beta, alpha]",
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
    name,
    `# ${name}`,
    `{ from: ${from}, to: ${to}, semantics: [related] }`,
  );
}

test("Atlas View carries normalized objects, locations, digests, ownership, validation, snapshots, and graph indexes", () => {
  const files = [
    captured(".atlas/CHANGELOG.md", "# Changelog\n"),
    page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
    page(
      ".atlas/concepts/target.md",
      "concept:target",
      "concept",
      "Target",
      "# Target",
    ),
    edge("root-target", "anchor:root", "concept:target"),
  ];
  const validated = loadAndValidateAtlasInput(files, budgets);
  const identity = Object.freeze({
    atlas: Object.freeze({ reference: "local-home-atlas", state: "known" as const }),
    role: "home" as const,
    slug: "local-home-atlas",
    snapshot: Object.freeze({ reference: "abc123", state: "known" as const }),
  });
  const atlasView = buildAtlasView({
    files: validated.files,
    identity,
    pages: validated.pages,
    validationState: Object.freeze({
      findings: validated.findings,
      state: validated.validationState,
    }),
  });

  assert.equal(Object.isFrozen(atlasView), true);
  assert.deepEqual(atlasView.snapshots, [identity]);
  assert.equal(atlasView.validationState.state, "valid");
  assert.deepEqual(atlasView.validationState.findings, []);

  const target = atlasView.graphIndexes.objectsById.get("concept:target");
  assert.ok(target);
  assert.equal(target.path, ".atlas/concepts/target.md");
  assert.equal(target.title, "Target");
  assert.deepEqual(target.tags, ["alpha", "beta"]);
  assert.deepEqual(target.ownership, {
    createdBy: { kind: "human", name: "Fixture Author" },
    updatedBy: { kind: "agent", name: "Fixture Agent" },
  });
  assert.deepEqual(target.sourceLocation, {
    body: { endLine: 15, startLine: 15 },
    frontmatter: { endLine: 13, startLine: 2 },
    path: ".atlas/concepts/target.md",
    snapshot: identity,
  });

  const digest = atlasView.fileDigests.find(
    (entry) => entry.path === ".atlas/concepts/target.md",
  );
  assert.ok(digest);
  assert.equal(digest.algorithm, "sha256");
  assert.equal(
    digest.sha256,
    createHash("sha256")
      .update(validated.files.find((file) => file.path === digest.path)?.content ?? "")
      .digest("hex"),
  );

  assert.equal(atlasView.graphIndexes.objectsByPath.get(target.path), target);
  assert.equal(atlasView.graphIndexes.objectsById.size, 3);
  assert.equal(atlasView.graphIndexes.objectsById.has("concept:target"), true);
  assert.deepEqual([...atlasView.graphIndexes.objectsById.keys()].toSorted(), [
    "anchor:root",
    "concept:target",
    "edge:root-target",
  ]);
  assert.deepEqual(
    [...atlasView.graphIndexes.objectsByPath.values()]
      .map((object) => object.path)
      .toSorted(),
    [".atlas/concepts/target.md", ".atlas/edges/root-target.md", ".atlas/index.md"],
  );
  const pathsByForEach: string[] = [];
  atlasView.graphIndexes.objectsById.forEach((object) =>
    pathsByForEach.push(object.path),
  );
  assert.deepEqual(pathsByForEach.toSorted(), [
    ".atlas/concepts/target.md",
    ".atlas/edges/root-target.md",
    ".atlas/index.md",
  ]);
  assert.deepEqual(
    [...atlasView.graphIndexes.objectsById].map(([id]) => id).toSorted(),
    ["anchor:root", "concept:target", "edge:root-target"],
  );
  assert.deepEqual(
    [...atlasView.graphIndexes.objectsById.entries()].map(([id]) => id).toSorted(),
    ["anchor:root", "concept:target", "edge:root-target"],
  );
  assert.deepEqual(atlasView.graphIndexes.adjacencyByObjectId.get("anchor:root"), [
    "concept:target",
  ]);
  assert.equal(atlasView.graphIndexes.edgesById.get("edge:root-target")?.to, target.id);
});

test("Atlas View does not invent graph indexes for Edge pages without endpoints", () => {
  const files = [
    page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
    page(
      ".atlas/edges/incomplete.md",
      "edge:incomplete",
      "edge",
      "incomplete",
      "# incomplete",
    ),
  ];
  const validated = loadAndValidateAtlasInput(files, budgets);
  const atlasView = buildAtlasView({
    files: validated.files,
    identity: {
      atlas: { reference: "local-home-atlas", state: "known" },
      role: "home",
      slug: "local-home-atlas",
      snapshot: { reference: "abc123", state: "known" },
    },
    pages: validated.pages,
    validationState: {
      findings: validated.findings,
      state: validated.validationState,
    },
  });

  assert.equal(atlasView.validationState.state, "valid");
  assert.equal(atlasView.graphIndexes.edgeByObjectId.has("edge:incomplete"), false);
  assert.equal(atlasView.graphIndexes.edgesById.has("edge:incomplete"), false);
});

test("Atlas View carries invalid validation state decided before it is built", () => {
  const files = [
    page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
    page(".atlas/concepts/wrong.md", "concept:wrong", "anchor", "Wrong", "# Wrong"),
  ];
  const validated = loadAndValidateAtlasInput(files, budgets);
  const atlasView = buildAtlasView({
    files: validated.files,
    identity: {
      atlas: { reference: "local-home-atlas", state: "known" },
      role: "home",
      slug: "local-home-atlas",
      snapshot: { reference: "abc123", state: "known" },
    },
    pages: validated.pages,
    validationState: {
      findings: validated.findings,
      state: validated.validationState,
    },
  });

  assert.equal(atlasView.validationState.state, "invalid");
  assert.equal(
    atlasView.validationState.findings[0]?.code,
    "ATLAS_PAGE_TYPE_PATH_MISMATCH",
  );
});

test("Atlas View carries tracked snapshot identity beside the Home Atlas", () => {
  const home = loadAndValidateAtlasInput(
    [page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root")],
    budgets,
  );
  const tracked = loadAndValidateAtlasInput(
    [page(".atlas/index.md", "anchor:tracked", "anchor", "Tracked", "# Tracked")],
    budgets,
  );
  const atlasView = buildAtlasView(
    {
      files: home.files,
      identity: {
        atlas: { reference: "home", state: "known" },
        role: "home",
        slug: "home",
        snapshot: { reference: "home-sha", state: "known" },
      },
      pages: home.pages,
      validationState: {
        findings: home.findings,
        state: home.validationState,
      },
    },
    [
      {
        files: tracked.files,
        identity: {
          atlas: { reference: "tracked", state: "known" },
          role: "tracked",
          slug: "tracked",
          snapshot: { reference: "tracked-sha", state: "known" },
        },
        pages: tracked.pages,
        validationState: {
          findings: tracked.findings,
          state: tracked.validationState,
        },
      },
    ],
  );

  assert.deepEqual(
    atlasView.snapshots.map((snapshot) => `${snapshot.role}:${snapshot.slug}`),
    ["home:home", "tracked:tracked"],
  );
  assert.deepEqual(
    atlasView.files.map((file) => `${file.snapshot.slug}:${file.path}`),
    ["home:.atlas/index.md", "tracked:.atlas/index.md"],
  );
});

test("Atlas View construction stays within the declared growth budget", () => {
  const generated = (count: number): CapturedAtlasFile[] => [
    page(".atlas/index.md", "anchor:root", "anchor", "Root", "# Root"),
    ...Array.from({ length: count }, (_, index) =>
      page(
        `.atlas/concepts/generated-${String(index)}.md`,
        `concept:generated-${String(index)}`,
        "concept",
        `Generated ${String(index)}`,
        `# Generated ${String(index)}\n\nneedle `.repeat(8),
      ),
    ),
  ];
  const small = generated(40);
  const large = generated(80);
  const run = (files: readonly CapturedAtlasFile[]): void => {
    const validated = loadAndValidateAtlasInput(files, {
      maxFileBytes: 8192,
      maxTotalBytes: 1024 * 1024,
    });
    buildAtlasView({
      files: validated.files,
      identity: {
        atlas: { reference: "local-home-atlas", state: "known" },
        role: "home",
        slug: "local-home-atlas",
        snapshot: { reference: "growth", state: "known" },
      },
      pages: validated.pages,
      validationState: {
        findings: validated.findings,
        state: validated.validationState,
      },
    });
  };

  assertWallClockUnder("constructing an Atlas View from 80 pages", 2000, () => {
    run(large);
  });
  assertGrowthRatio({
    large: () => {
      run(large);
    },
    name: "Atlas View construction",
    small: () => {
      run(small);
    },
  });
});
