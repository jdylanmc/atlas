import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkFinding, FindingSchema, type Finding } from "../src/domain/finding.ts";
import type { RealmTextFile } from "../src/realm/load_realm_text.ts";
import { validateRealmStructure } from "../src/weave/validate_realm_structure.ts";

const fixturesRoot = resolve(import.meta.dirname, "fixtures");

function fixture(root: string, path: string): RealmTextFile {
  return Object.freeze({
    content: readFileSync(resolve(fixturesRoot, root, path), "utf8"),
    path,
  });
}

function page(
  path: string,
  body: string,
  options: {
    readonly id?: string;
    readonly title?: string;
    readonly type?: string;
  } = {},
): RealmTextFile {
  const title = options.title ?? "Page";
  return Object.freeze({
    content: [
      "---",
      "atlas:",
      "  atlas-schema: 1.0.0",
      "  realm-schema: 1.0.0",
      `  id: ${options.id ?? "insight:page"}`,
      `  type: ${options.type ?? "insight"}`,
      `  title: ${title}`,
      '  created-at: "2026-08-17T00:00:00Z"',
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  created-by: { kind: agent, name: Fixture Agent }",
      "  updated-by: { kind: human, name: Fixture Reviewer }",
      "  tags: []",
      "realm: {}",
      "---",
      body,
    ].join("\n"),
    path,
  });
}

const validFiles = [
  ".atlas/framework/README.md",
  ".atlas/CHANGELOG.md",
  ".atlas/index.md",
  ".atlas/insights/parsing.md",
].map((path) => fixture("realm-pages", path));

const invalidFiles = [
  ".atlas/framework/README.md",
  ".atlas/index.md",
  ".atlas/insights/second.md",
  ".atlas/lore/malformed.md",
  ".atlas/types/guide/page.md",
].map((path) => fixture("structural-validation", path));

test("parses and accepts the valid minimal Realm itself", () => {
  assert.deepEqual(validateRealmStructure(validFiles), []);
});

test("aggregates exact sanitized structural Findings", () => {
  const findings = validateRealmStructure(invalidFiles);
  assert.deepEqual(
    findings.map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_PAGE_ID_DUPLICATE",
        location: {
          end: { column: 5, line: 5 },
          start: { column: 3, line: 5 },
        },
        path: ".atlas/index.md",
      },
      {
        code: "ATLAS_ROOT_BONFIRE_ID_INVALID",
        location: {
          end: { column: 5, line: 5 },
          start: { column: 3, line: 5 },
        },
        path: ".atlas/index.md",
      },
      {
        code: "ATLAS_PAGE_TYPE_PATH_MISMATCH",
        location: {
          end: { column: 7, line: 6 },
          start: { column: 3, line: 6 },
        },
        path: ".atlas/index.md",
      },
      {
        code: "ATLAS_PAGE_UPDATED_BEFORE_CREATED",
        location: {
          end: { column: 13, line: 9 },
          start: { column: 3, line: 9 },
        },
        path: ".atlas/index.md",
      },
      {
        code: "ATLAS_PAGE_TITLE_H1_MISMATCH",
        location: {
          end: { column: 8, line: 16 },
          start: { column: 1, line: 16 },
        },
        path: ".atlas/index.md",
      },
      {
        code: "ATLAS_PAGE_ID_DUPLICATE",
        location: {
          end: { column: 5, line: 5 },
          start: { column: 3, line: 5 },
        },
        path: ".atlas/insights/second.md",
      },
      {
        code: "ATLAS_PAGE_MALFORMED_FRONTMATTER",
        location: {
          end: { column: 44, line: 2 },
          start: { column: 1, line: 2 },
        },
        path: ".atlas/lore/malformed.md",
      },
      {
        code: "ATLAS_PAGE_TYPE_PATH_MISMATCH",
        location: {
          end: { column: 7, line: 6 },
          start: { column: 3, line: 6 },
        },
        path: ".atlas/types/guide/page.md",
      },
      {
        code: "ATLAS_PAGE_TITLE_H1_REQUIRED",
        location: {
          end: { column: 12, line: 16 },
          start: { column: 1, line: 16 },
        },
        path: ".atlas/types/guide/page.md",
      },
    ],
  );
  assert.equal(findings.every(checkFinding), true);
  assert.equal(JSON.stringify(findings).includes("secret parser stack"), false);
});

test("requires the first CommonMark block to be the matching H1", () => {
  for (const body of [
    "",
    "Prose first.\n\n# Page",
    "````markdown\n# Page\n````\n\n# Page",
    "~~~~~\n# Page\n~~~~~\n\n# Page",
    "<!-- comment -->\n\n# Page",
    "> # Page\n\n# Page",
  ]) {
    const findings = validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(".atlas/insights/page.md", body),
    ]);
    assert.equal(
      findings.some(({ code }) => code === "ATLAS_PAGE_TITLE_H1_REQUIRED"),
      true,
      body,
    );
  }
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(".atlas/insights/page.md", "# **Pa**ge"),
    ]),
    [],
  );
});

test("reports an empty body at EOF without fabricating a location", () => {
  const emptyAtEof = page(".atlas/insights/empty.md", "");
  const [finding] = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    { ...emptyAtEof, content: emptyAtEof.content.slice(0, -1) },
  ]);
  assert.ok(finding);
  assert.equal(finding.code, "ATLAS_PAGE_TITLE_H1_REQUIRED");
  assert.equal(finding.location, undefined);
});

test("rejects Atlas core archetype names in Realm-owned custom paths", () => {
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/types/insight/page.md", "# Page"),
  ]);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.ok(finding);
  assert.equal(finding.code, "ATLAS_CUSTOM_TYPE_NAME_RESERVED");
  assert.equal(finding.location, undefined);
});

test("uses YAML AST locations and never confuses realm.id with atlas.id", () => {
  const root = Object.freeze({
    content: [
      "---",
      "realm:",
      "  id: realm-local",
      "atlas:",
      "  atlas-schema: 1.0.0",
      "  realm-schema: 1.0.0",
      "  id: wrong:root",
      "  type: bonfire",
      "  title: Root",
      '  created-at: "2026-08-17T00:00:00Z"',
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  created-by: { kind: human, name: Author }",
      "  updated-by: { kind: human, name: Author }",
      "  tags: []",
      "---",
      "# Root",
    ].join("\n"),
    path: ".atlas/index.md",
  });
  const idFinding = validateRealmStructure([root]).find(
    ({ code }) => code === "ATLAS_ROOT_BONFIRE_ID_INVALID",
  );
  assert.deepEqual(idFinding?.location, {
    end: { column: 5, line: 7 },
    start: { column: 3, line: 7 },
  });

  const absent = page(".atlas/insights/absent.md", "# Page").content.replace(
    "  type: insight\n",
    "",
  );
  const [schemaFinding] = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    { content: absent, path: ".atlas/insights/absent.md" },
  ]);
  assert.equal(schemaFinding?.code, "ATLAS_PAGE_INVALID_ENVELOPE");
  assert.equal(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      { content: absent, path: ".atlas/insights/absent.md" },
    ]).some(({ code }) => code === "ATLAS_PAGE_TYPE_PATH_MISMATCH"),
    false,
  );

  const flow = {
    content: [
      "---",
      'atlas: { atlas-schema: 1.0.0, realm-schema: 1.0.0, id: wrong:root, type: insight, title: Root, created-at: "2026-08-17T00:00:00Z", updated-at: "2026-08-17T00:00:00Z", created-by: { kind: human, name: Author }, updated-by: { kind: human, name: Author }, tags: [] }',
      "realm: {}",
      "---",
      "# Root",
    ].join("\n"),
    path: ".atlas/index.md",
  };
  const flowLocations = validateRealmStructure([flow])
    .filter(({ code }) =>
      ["ATLAS_PAGE_TYPE_PATH_MISMATCH", "ATLAS_ROOT_BONFIRE_ID_INVALID"].includes(code),
    )
    .map(({ location }) => location?.start.column);
  assert.equal(flowLocations.length, 2);
  assert.notEqual(flowLocations[0], flowLocations[1]);
});

test("sanitizes hostile captured records without accepting stale parse results", () => {
  const hostileContent = Object.freeze({
    get content(): string {
      throw new Error("secret hostile content");
    },
    path: ".atlas/insights/hostile.md",
  });
  const hostilePath = Object.freeze({
    content: "# ignored",
    get path(): string {
      throw new Error("secret hostile path");
    },
  });
  const hostileTypes = [
    { content: "# ignored", path: 42 },
    { content: 42, path: ".atlas/insights/non-text.md" },
  ] as unknown as readonly RealmTextFile[];
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    hostileContent,
    hostilePath,
    ...hostileTypes,
  ]);
  assert.deepEqual(
    findings.map(({ code, path }) => ({ code, path })),
    [
      { code: "ATLAS_PAGE_PARSE_FAILED", path: ".atlas/insights/hostile.md" },
      { code: "ATLAS_PAGE_PARSE_FAILED", path: ".atlas/insights/non-text.md" },
      { code: "ATLAS_PAGE_PARSE_FAILED", path: ".atlas/unknown" },
      { code: "ATLAS_PAGE_PARSE_FAILED", path: ".atlas/unknown" },
    ],
  );
  assert.equal(JSON.stringify(findings).includes("secret hostile"), false);
});

test("supports extensible attribution with severity as the only state", () => {
  const base = {
    code: "REALM_CHECK_EXAMPLE",
    "finding-schema": "1.0.0",
    message: "Realm check result.",
    path: ".atlas/index.md",
  } as const;
  assert.equal(
    checkFinding({
      ...base,
      attribution: {
        checkId: "realm.example",
        kind: "realm-owned",
        trusted: false,
      },
      severity: "warning",
    }),
    true,
  );
  assert.equal(
    checkFinding({
      ...base,
      attribution: {
        checkId: "realm.dependent",
        kind: "realm-owned",
        trusted: false,
      },
      severity: "skipped",
    }),
    true,
  );
  assert.equal(
    checkFinding({
      ...base,
      attribution: {
        checkId: "realm.untrusted",
        kind: "realm-owned",
        trusted: true,
      },
      severity: "error",
    }),
    false,
  );
  assert.equal(
    checkFinding({
      ...base,
      attribution: {
        checkId: "realm.dependent",
        kind: "realm-owned",
        trusted: false,
      },
      severity: "skipped",
      status: "reported",
    }),
    false,
  );
  assert.equal(FindingSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
});

test("orders independently of input and deeply freezes every Finding", () => {
  const forward = validateRealmStructure(invalidFiles);
  assert.deepEqual(validateRealmStructure(invalidFiles.toReversed()), forward);
  assert.equal(Object.isFrozen(forward), true);
  assert.equal(Object.isFrozen(forward[0]), true);
  assert.equal(Object.isFrozen(forward[0]?.attribution), true);
  assert.equal(Object.isFrozen(forward[0]?.location), true);
  assert.equal(Object.isFrozen(forward[0]?.location?.start), true);
  assert.throws(() => {
    (forward as Finding[]).push(forward[0] as Finding);
  }, TypeError);
  assert.throws(() => {
    (forward[0] as { message: string }).message = "changed";
  }, TypeError);
});

test("preserves opaque Markdown and reports a missing Root Bonfire", () => {
  const [finding] = validateRealmStructure([invalidFiles[0] as RealmTextFile]);
  assert.ok(finding);
  assert.equal(finding.code, "ATLAS_ROOT_BONFIRE_REQUIRED");
  assert.deepEqual(finding.attribution, {
    checkId: "atlas-core.structural-validation",
    kind: "atlas-core",
    trusted: true,
  });
});
