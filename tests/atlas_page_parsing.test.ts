import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { FormatRegistry } from "@sinclair/typebox";
import {
  checkAtlasPageEnvelope,
  AtlasPageEnvelopeSchema,
} from "../src/domain/atlas_page.ts";
import {
  classifyAtlasTextPath,
  parseAtlasPages,
  AtlasPageParseError,
} from "../src/atlas/parse_atlas_pages.ts";
import type { AtlasTextFile } from "../src/atlas/load_atlas_text.ts";

const fixtureRoot = resolve(import.meta.dirname, "fixtures", "atlas-pages");

function text(path: string, content: string): AtlasTextFile {
  return Object.freeze({ content, path });
}

function fixture(path: string): AtlasTextFile {
  return text(path, readFileSync(resolve(fixtureRoot, path), "utf8"));
}

function validPage(id: string): string {
  return `---\nsdk:\n  atlas-sdk-schema: '1'\n  local-atlas-schema: '2'\n  id: ${id}\n  type: custom\n  title: Page\n  created-at: "2026-08-17T00:00:00Z"\n  updated-at: "2026-08-17T00:00:00Z"\n  created-by: { kind: agent, name: Test Agent }\n  updated-by: { kind: human, name: Test Reviewer }\n  tags: []\natlas: {}\n---`;
}

function parseError(file: AtlasTextFile): AtlasPageParseError {
  try {
    parseAtlasPages([file]);
  } catch (error: unknown) {
    assert.ok(error instanceof AtlasPageParseError);
    return error;
  }
  assert.fail("Expected AtlasPageParseError.");
}

test("classifies only settled core Atlas page locations", () => {
  for (const path of [
    ".atlas/index.md",
    ".atlas/anchors/entry.md",
    ".atlas/concepts/topic.md",
    ".atlas/sources/source.md",
    ".atlas/principles/truth.md",
    ".atlas/edges/path.md",
    ".atlas/types/field-guide/page.md",
    ".atlas/types/field-guide/nested/page.md",
  ]) {
    assert.equal(classifyAtlasTextPath(path), "page", path);
  }

  for (const path of [
    ".atlas/CHANGELOG.md",
    ".atlas/framework/README.md",
    ".atlas/framework/concepts/not-a-page.md",
    ".atlas/skills/ingest.md",
    ".atlas/directives/guide.md",
    ".atlas/atlas/schemas/page.md",
    ".atlas/types/page.md",
    ".atlas/notes.md",
    ".atlas/concepts/not-markdown.txt",
  ]) {
    assert.equal(classifyAtlasTextPath(path), "opaque", path);
  }
});

test("parses the canonical fixture and ignores opaque Markdown", () => {
  const records = [
    fixture(".atlas/framework/README.md"),
    fixture(".atlas/concepts/parsing.md"),
    fixture(".atlas/CHANGELOG.md"),
    fixture(".atlas/index.md"),
  ];

  const pages = parseAtlasPages(records);
  assert.deepEqual(
    pages.map(({ page, source }) => ({
      id: page.sdk.id,
      path: source.path,
      type: page.sdk.type,
    })),
    [
      {
        id: "concept:parsing",
        path: ".atlas/concepts/parsing.md",
        type: "concept",
      },
      {
        id: "anchor:root",
        path: ".atlas/index.md",
        type: "anchor",
      },
    ],
  );
  assert.ok(pages[0]);
  const page = pages[0].page as unknown as {
    readonly atlas: Readonly<Record<string, unknown>>;
  };
  assert.equal(page.atlas["confidence"], "reviewed");
});

test("preserves canonical Atlas SDK and Atlas mappings for a custom type", () => {
  const [parsed] = parseAtlasPages([
    text(
      ".atlas/types/field-guide/custom.md",
      [
        "---",
        "sdk:",
        "  atlas-sdk-schema: atlas-next",
        "  local-atlas-schema: atlas-next",
        "  id: field-guide:custom",
        "  type: field-guide",
        "  title: Custom Guide",
        '  created-at: "2026-08-17T00:00:00Z"',
        '  updated-at: "2026-08-17T01:00:00+00:00"',
        "  created-by: { kind: agent, name: Test Agent }",
        "  updated-by: { kind: human, name: Test Reviewer }",
        "  originating-operation: operation:custom",
        "  tags: [custom]",
        "atlas:",
        "  rank: 2",
        "  nested:",
        "    labels: [one, two]",
        "---",
        "Custom body",
      ].join("\n"),
    ),
  ]);

  assert.ok(parsed);
  assert.deepEqual(parsed.page, {
    sdk: {
      "atlas-sdk-schema": "atlas-next",
      "created-at": "2026-08-17T00:00:00Z",
      "created-by": { kind: "agent", name: "Test Agent" },
      id: "field-guide:custom",
      "originating-operation": "operation:custom",
      "local-atlas-schema": "atlas-next",
      tags: ["custom"],
      title: "Custom Guide",
      type: "field-guide",
      "updated-at": "2026-08-17T01:00:00+00:00",
      "updated-by": { kind: "human", name: "Test Reviewer" },
    },
    body: "Custom body",
    atlas: { nested: { labels: ["one", "two"] }, rank: 2 },
  });
});

test("returns a deeply immutable page tree", () => {
  const [parsed] = parseAtlasPages([
    text(
      ".atlas/types/field-guide/custom.md",
      validPage("field-guide:custom").replace(
        "atlas: {}",
        "atlas:\n  nested:\n    labels: [one, two]",
      ),
    ),
  ]);
  assert.ok(parsed);
  const atlas = (parsed.page as unknown as { readonly atlas: unknown }).atlas as {
    readonly nested: { readonly labels: readonly string[] };
  };

  assert.equal(Object.isFrozen(parsed.page), true);
  assert.equal(Object.isFrozen(parsed.page.sdk), true);
  assert.equal(Object.isFrozen(atlas.nested), true);
  assert.equal(Object.isFrozen(atlas.nested.labels), true);
  assert.throws(() => {
    (parsed.page.sdk as { title: string }).title = "Changed";
  }, TypeError);
  assert.throws(() => {
    (atlas.nested.labels as string[]).push("changed");
  }, TypeError);
});

test("rejects missing, malformed, and invalid frontmatter", () => {
  const missing = parseError(text(".atlas/index.md", "# No frontmatter\n"));
  assert.deepEqual(
    { code: missing.code, line: missing.sourceLine, path: missing.path },
    { code: "MISSING_FRONTMATTER", line: 1, path: ".atlas/index.md" },
  );

  const malformed = parseError(
    text(".atlas/index.md", "---\nsdk:\n  schema: [broken\n---\nbody\n"),
  );
  assert.equal(malformed.code, "MALFORMED_FRONTMATTER");
  assert.equal(malformed.sourceLine, 2);

  const invalid = parseError(
    text(".atlas/index.md", validPage("root").replace("  type: custom", "  type: ' '")),
  );
  assert.equal(invalid.code, "INVALID_PAGE_ENVELOPE");
  assert.equal(invalid.sourceLine, 2);

  assert.equal(
    parseError(text(".atlas/index.md", "---\nsdk:\n  schema: 1\n")).code,
    "MALFORMED_FRONTMATTER",
  );
  assert.equal(
    parseError(text(".atlas/index.md", "---\nsdk:\n  schema: 1")).code,
    "MALFORMED_FRONTMATTER",
  );
  for (const frontmatter of ["[]", "sdk: []\natlas: {}", "sdk: null\natlas: {}"]) {
    assert.equal(
      parseError(text(".atlas/index.md", `---\n${frontmatter}\n---\n`)).code,
      "INVALID_PAGE_ENVELOPE",
    );
  }
  assert.equal(
    parseError(
      text(
        ".atlas/index.md",
        validPage("root").replace("atlas: {}", "atlas: &copy {}\ncopy: *copy"),
      ),
    ).code,
    "MALFORMED_FRONTMATTER",
  );

  const sdkExtension = validPage("custom:page").replace(
    "  title: Page",
    "  title: Page\n  extension: misplaced",
  );
  assert.equal(
    parseError(text(".atlas/index.md", sdkExtension)).code,
    "INVALID_PAGE_ENVELOPE",
  );
});

test("rejects non-JSON and unresolved YAML tags", () => {
  for (const taggedValue of [
    "!!timestamp 2026-08-17T00:00:00Z",
    "!!set { one: null }",
    "!!binary SGVsbG8=",
    ".nan",
    "!custom value",
  ]) {
    const content = validPage("custom:tagged").replace(
      "atlas: {}",
      `atlas:\n  value: ${taggedValue}`,
    );
    assert.equal(
      parseError(text(".atlas/types/custom/tagged.md", content)).code,
      "MALFORMED_FRONTMATTER",
      taggedValue,
    );
  }
});

test("rejects non-string YAML mapping keys", () => {
  for (const mapping of [
    "atlas:\n  true: value",
    "atlas:\n  null: value",
    "atlas:\n  ? [one, two]\n  : value",
  ]) {
    assert.equal(
      parseError(
        text(
          ".atlas/types/custom/key.md",
          validPage("custom:key").replace("atlas: {}", mapping),
        ),
      ).code,
      "MALFORMED_FRONTMATTER",
    );
  }
});

test("preserves body bytes and stable source lines", () => {
  const [parsed] = parseAtlasPages([
    text(
      ".atlas/index.md",
      `${validPage("root").replaceAll("\n", "\r\n")}\r\nfirst\r\nsecond\r\n`,
    ),
  ]);

  assert.ok(parsed);
  assert.equal(parsed.page.body, "first\r\nsecond\r\n");
  assert.deepEqual(parsed.source, {
    body: { endLine: 16, startLine: 15 },
    frontmatter: { endLine: 13, startLine: 2 },
    path: ".atlas/index.md",
  });
});

test("only an LF starts a closing delimiter line", () => {
  for (const separator of ["\u2028", "\u2029"]) {
    const frontmatter = validPage("concept:separators").replace(
      "atlas: {}",
      `atlas:\n  note: "a${separator}---${separator}b"\n  zebra: last`,
    );
    const [parsed] = parseAtlasPages([
      text(".atlas/concepts/separators.md", `${frontmatter}\nbody\n`),
    ]);

    assert.ok(parsed);
    assert.deepEqual(parsed.page.atlas, {
      note: `a${separator}---${separator}b`,
      zebra: "last",
    });
    assert.equal(parsed.page.body, "body\n");
  }
});

test("reversed record input produces identical ordered pages and errors", () => {
  const valid = [fixture(".atlas/concepts/parsing.md"), fixture(".atlas/index.md")];
  assert.deepEqual(parseAtlasPages(valid), parseAtlasPages([...valid].reverse()));

  const invalid = [
    text(".atlas/edges/z.md", "missing"),
    text(".atlas/anchors/a.md", "also missing"),
  ];
  assert.throws(
    () => parseAtlasPages(invalid),
    (error: unknown) =>
      error instanceof AtlasPageParseError && error.path === ".atlas/anchors/a.md",
  );
  assert.throws(
    () => parseAtlasPages([...invalid].reverse()),
    (error: unknown) =>
      error instanceof AtlasPageParseError && error.path === ".atlas/anchors/a.md",
  );

  const prefixPaths = [
    text(".atlas/concepts/a.md/b.md", validPage("custom:child")),
    text(".atlas/concepts/a.md", validPage("custom:parent")),
  ];
  assert.deepEqual(
    parseAtlasPages(prefixPaths).map(({ source }) => source.path),
    [".atlas/concepts/a.md", ".atlas/concepts/a.md/b.md"],
  );
});

test("schema and inferred TypeScript type describe the same envelope", () => {
  const page = {
    sdk: {
      "atlas-sdk-schema": "1.0.0",
      "created-at": "2026-08-17T00:00:00Z",
      "created-by": { kind: "agent", name: "Test Agent" },
      id: "custom:page",
      "local-atlas-schema": "2.0.0",
      tags: [],
      title: "Page",
      type: "custom",
      "updated-at": "2026-08-17T01:00:00Z",
      "updated-by": { kind: "human", name: "Test Reviewer" },
    },
    body: "Body",
    atlas: { nested: { enabled: true } },
  };

  assert.equal(checkAtlasPageEnvelope(page), true);
  assert.equal(
    AtlasPageEnvelopeSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(AtlasPageEnvelopeSchema.additionalProperties, false);
  assert.equal(AtlasPageEnvelopeSchema.properties.sdk.additionalProperties, false);
});

test("JSON value schema accepts only nested JSON-compatible values", () => {
  const valid = {
    sdk: {
      "atlas-sdk-schema": "1",
      "created-at": "2026-08-17T00:00:00Z",
      "created-by": { kind: "agent", name: "Agent" },
      id: "custom:json",
      "local-atlas-schema": "2",
      tags: ["json"],
      title: "JSON",
      type: "custom",
      "updated-at": "2026-08-17T00:00:00Z",
      "updated-by": { kind: "human", name: "Reviewer" },
    },
    body: "",
    atlas: { nested: [null, true, 3, "text", { value: false }] },
  };
  assert.equal(checkAtlasPageEnvelope(valid), true);

  for (const value of [
    undefined,
    1n,
    (): void => undefined,
    new Date(),
    new Set(),
    Buffer.from("binary"),
  ]) {
    assert.equal(
      checkAtlasPageEnvelope({
        ...valid,
        atlas: { value },
      }),
      false,
    );
  }
});

test("validates canonical date-time calendar and clock values", () => {
  const withCreatedAt = (timestamp: string): AtlasTextFile =>
    text(
      ".atlas/index.md",
      validPage("anchor:root").replace("2026-08-17T00:00:00Z", timestamp),
    );

  for (const timestamp of [
    "2024-02-29T23:59:59Z",
    "1990-12-31T23:59:60Z",
    "2026-08-17t12:34:56z",
    "2026-08-17T12:34:56+05:30",
  ]) {
    assert.equal(parseAtlasPages([withCreatedAt(timestamp)]).length, 1);
  }
  for (const timestamp of [
    "not-a-date",
    "2026-99-99T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
  ]) {
    assert.equal(parseError(withCreatedAt(timestamp)).code, "INVALID_PAGE_ENVELOPE");
  }
});

test("does not mutate TypeBox date-time format registration", async () => {
  const previous = FormatRegistry.Get("date-time");
  const sentinel = (): boolean => false;
  FormatRegistry.Set("date-time", sentinel);
  try {
    const modulePath = "../src/domain/atlas_page.ts?format-registry-isolation";
    await import(modulePath);
    assert.equal(FormatRegistry.Get("date-time"), sentinel);
  } finally {
    if (previous === undefined) {
      FormatRegistry.Delete("date-time");
    } else {
      FormatRegistry.Set("date-time", previous);
    }
  }
});

test("accepts an empty body after an end-of-file delimiter", () => {
  const [parsed] = parseAtlasPages([text(".atlas/index.md", validPage("anchor:root"))]);
  assert.ok(parsed);
  assert.equal(parsed.page.body, "");
  assert.deepEqual(parsed.source.body, { endLine: 15, startLine: 15 });
});
