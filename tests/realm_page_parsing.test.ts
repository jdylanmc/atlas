import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  RealmPageEnvelopeSchema,
  type RealmPageEnvelope,
} from "../src/domain/realm_page.ts";
import {
  classifyRealmTextPath,
  parseRealmPages,
  RealmPageParseError,
} from "../src/realm/parse_realm_pages.ts";
import type { RealmTextFile } from "../src/realm/load_realm_text.ts";

const fixtureRoot = resolve(import.meta.dirname, "fixtures", "realm-pages");

function text(path: string, content: string): RealmTextFile {
  return Object.freeze({ content, path });
}

function fixture(path: string): RealmTextFile {
  return text(path, readFileSync(resolve(fixtureRoot, path), "utf8"));
}

function validPage(id: string): string {
  return `---\natlas:\n  schema: '1'\n  id: ${id}\n  type: custom\n  title: Page\n---`;
}

function parseError(file: RealmTextFile): RealmPageParseError {
  try {
    parseRealmPages([file]);
  } catch (error: unknown) {
    assert.ok(error instanceof RealmPageParseError);
    return error;
  }
  assert.fail("Expected RealmPageParseError.");
}

test("classifies only settled core Realm page locations", () => {
  for (const path of [
    ".atlas/index.md",
    ".atlas/bonfires/entry.md",
    ".atlas/insights/topic.md",
    ".atlas/lore/source.md",
    ".atlas/pillars/truth.md",
    ".atlas/threads/path.md",
  ]) {
    assert.equal(classifyRealmTextPath(path), "page", path);
  }

  for (const path of [
    ".atlas/CHANGELOG.md",
    ".atlas/framework/README.md",
    ".atlas/framework/insights/not-a-page.md",
    ".atlas/skills/gather.md",
    ".atlas/directives/guide.md",
    ".atlas/realm/schemas/page.md",
    ".atlas/notes.md",
    ".atlas/insights/not-markdown.txt",
  ]) {
    assert.equal(classifyRealmTextPath(path), "opaque", path);
  }
});

test("parses the canonical fixture and ignores opaque Markdown", () => {
  const records = [
    fixture(".atlas/framework/README.md"),
    fixture(".atlas/insights/parsing.md"),
    fixture(".atlas/CHANGELOG.md"),
    fixture(".atlas/index.md"),
  ];

  const pages = parseRealmPages(records);
  assert.deepEqual(
    pages.map(({ page, source }) => ({
      id: page.id,
      path: source.path,
      type: page.type,
    })),
    [
      {
        id: "bonfire:root",
        path: ".atlas/index.md",
        type: "bonfire",
      },
      {
        id: "insight:parsing",
        path: ".atlas/insights/parsing.md",
        type: "insight",
      },
    ],
  );
  assert.ok(pages[1]);
  assert.equal(pages[1].page["confidence"], "reviewed");
});

test("accepts an open custom archetype with extension fields", () => {
  const [parsed] = parseRealmPages([
    text(
      ".atlas/insights/custom.md",
      [
        "---",
        "atlas:",
        "  schema: next",
        "  id: field-guide:custom",
        "  type: field-guide",
        "  title: Custom Guide",
        "  custom:",
        "    rank: 2",
        "---",
        "Custom body",
      ].join("\n"),
    ),
  ]);

  assert.ok(parsed);
  assert.deepEqual(parsed.page["custom"], { rank: 2 });
  assert.equal(parsed.page.type, "field-guide");
});

test("rejects missing, malformed, and invalid frontmatter", () => {
  const missing = parseError(text(".atlas/index.md", "# No frontmatter\n"));
  assert.deepEqual(
    { code: missing.code, line: missing.sourceLine, path: missing.path },
    { code: "MISSING_FRONTMATTER", line: 1, path: ".atlas/index.md" },
  );

  const malformed = parseError(
    text(".atlas/index.md", "---\natlas:\n  schema: [broken\n---\nbody\n"),
  );
  assert.equal(malformed.code, "MALFORMED_FRONTMATTER");
  assert.equal(malformed.sourceLine, 2);

  const invalid = parseError(
    text(
      ".atlas/index.md",
      "---\natlas:\n  schema: 1.0.0\n  id: root\n  type: ' '\n  title: Root\n---\n",
    ),
  );
  assert.equal(invalid.code, "INVALID_PAGE_ENVELOPE");
  assert.equal(invalid.sourceLine, 2);

  assert.equal(
    parseError(text(".atlas/index.md", "---\natlas:\n  schema: 1\n")).code,
    "MALFORMED_FRONTMATTER",
  );
  for (const frontmatter of ["[]", "atlas: []", "atlas: null"]) {
    assert.equal(
      parseError(text(".atlas/index.md", `---\n${frontmatter}\n---\n`)).code,
      "INVALID_PAGE_ENVELOPE",
    );
  }
  assert.equal(
    parseError(
      text(
        ".atlas/index.md",
        "---\natlas: &page\n  schema: '1'\n  id: root\n  type: custom\n  title: Root\ncopy: *page\n---\n",
      ),
    ).code,
    "MALFORMED_FRONTMATTER",
  );
});

test("preserves body bytes and stable source lines", () => {
  const [parsed] = parseRealmPages([
    text(
      ".atlas/index.md",
      "---\r\natlas:\r\n  schema: '1'\r\n  id: root\r\n  type: custom\r\n  title: Root\r\n---\r\nfirst\r\nsecond\r\n",
    ),
  ]);

  assert.ok(parsed);
  assert.equal(parsed.page.body, "first\r\nsecond\r\n");
  assert.deepEqual(parsed.source, {
    body: { endLine: 9, startLine: 8 },
    frontmatter: { endLine: 6, startLine: 2 },
    path: ".atlas/index.md",
  });
});

test("reversed record input produces identical ordered pages and errors", () => {
  const valid = [fixture(".atlas/insights/parsing.md"), fixture(".atlas/index.md")];
  assert.deepEqual(parseRealmPages(valid), parseRealmPages([...valid].reverse()));

  const invalid = [
    text(".atlas/threads/z.md", "missing"),
    text(".atlas/bonfires/a.md", "also missing"),
  ];
  assert.throws(
    () => parseRealmPages(invalid),
    (error: unknown) =>
      error instanceof RealmPageParseError && error.path === ".atlas/bonfires/a.md",
  );
  assert.throws(
    () => parseRealmPages([...invalid].reverse()),
    (error: unknown) =>
      error instanceof RealmPageParseError && error.path === ".atlas/bonfires/a.md",
  );

  const prefixPaths = [
    text(".atlas/insights/a.md/b.md", validPage("custom:child")),
    text(".atlas/insights/a.md", validPage("custom:parent")),
  ];
  assert.deepEqual(
    parseRealmPages(prefixPaths).map(({ source }) => source.path),
    [".atlas/insights/a.md", ".atlas/insights/a.md/b.md"],
  );
});

test("schema and inferred TypeScript type describe the same envelope", () => {
  const page: RealmPageEnvelope = {
    body: "Body",
    id: "custom:page",
    schema: "1.0.0",
    title: "Page",
    type: "custom",
  };

  assert.equal(Value.Check(RealmPageEnvelopeSchema, page), true);
  assert.equal(
    RealmPageEnvelopeSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.notEqual(RealmPageEnvelopeSchema.additionalProperties, false);
});

test("accepts an empty body after an end-of-file delimiter", () => {
  const [parsed] = parseRealmPages([
    text(".atlas/index.md", validPage("bonfire:root")),
  ]);
  assert.ok(parsed);
  assert.equal(parsed.page.body, "");
  assert.deepEqual(parsed.source.body, { endLine: 8, startLine: 8 });
});
