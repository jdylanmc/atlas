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
  return `---\natlas:\n  schema: '1'\n  realm-schema: '2'\n  id: ${id}\n  type: custom\n  title: Page\nrealm: {}\n---`;
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
    ".atlas/types/field-guide/page.md",
    ".atlas/types/field-guide/nested/page.md",
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
    ".atlas/types/page.md",
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
      id: page.atlas.id,
      path: source.path,
      type: page.atlas.type,
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
  assert.equal(pages[1].page.realm["confidence"], "reviewed");
});

test("preserves canonical Atlas and Realm mappings for a custom type", () => {
  const [parsed] = parseRealmPages([
    text(
      ".atlas/types/field-guide/custom.md",
      [
        "---",
        "atlas:",
        "  schema: atlas-next",
        "  realm-schema: realm-next",
        "  id: field-guide:custom",
        "  type: field-guide",
        "  title: Custom Guide",
        "realm:",
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
    atlas: {
      id: "field-guide:custom",
      "realm-schema": "realm-next",
      schema: "atlas-next",
      title: "Custom Guide",
      type: "field-guide",
    },
    body: "Custom body",
    realm: { nested: { labels: ["one", "two"] }, rank: 2 },
  });
});

test("returns a deeply immutable page tree", () => {
  const [parsed] = parseRealmPages([
    text(
      ".atlas/types/field-guide/custom.md",
      validPage("field-guide:custom").replace(
        "realm: {}",
        "realm:\n  nested:\n    labels: [one, two]",
      ),
    ),
  ]);
  assert.ok(parsed);
  const realm = parsed.page.realm as {
    readonly nested: { readonly labels: readonly string[] };
  };

  assert.equal(Object.isFrozen(parsed.page), true);
  assert.equal(Object.isFrozen(parsed.page.atlas), true);
  assert.equal(Object.isFrozen(realm.nested), true);
  assert.equal(Object.isFrozen(realm.nested.labels), true);
  assert.throws(() => {
    (parsed.page.atlas as { title: string }).title = "Changed";
  }, TypeError);
  assert.throws(() => {
    (realm.nested.labels as string[]).push("changed");
  }, TypeError);
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
      "---\natlas:\n  schema: 1.0.0\n  realm-schema: 1.0.0\n  id: root\n  type: ' '\n  title: Root\nrealm: {}\n---\n",
    ),
  );
  assert.equal(invalid.code, "INVALID_PAGE_ENVELOPE");
  assert.equal(invalid.sourceLine, 2);

  assert.equal(
    parseError(text(".atlas/index.md", "---\natlas:\n  schema: 1\n")).code,
    "MALFORMED_FRONTMATTER",
  );
  for (const frontmatter of ["[]", "atlas: []\nrealm: {}", "atlas: null\nrealm: {}"]) {
    assert.equal(
      parseError(text(".atlas/index.md", `---\n${frontmatter}\n---\n`)).code,
      "INVALID_PAGE_ENVELOPE",
    );
  }
  assert.equal(
    parseError(
      text(
        ".atlas/index.md",
        "---\natlas: &page\n  schema: '1'\n  realm-schema: '1'\n  id: root\n  type: custom\n  title: Root\nrealm: *page\n---\n",
      ),
    ).code,
    "MALFORMED_FRONTMATTER",
  );

  const atlasExtension = validPage("custom:page").replace(
    "  title: Page",
    "  title: Page\n  extension: misplaced",
  );
  assert.equal(
    parseError(text(".atlas/index.md", atlasExtension)).code,
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
      "realm: {}",
      `realm:\n  value: ${taggedValue}`,
    );
    assert.equal(
      parseError(text(".atlas/types/custom/tagged.md", content)).code,
      "MALFORMED_FRONTMATTER",
      taggedValue,
    );
  }
});

test("preserves body bytes and stable source lines", () => {
  const [parsed] = parseRealmPages([
    text(
      ".atlas/index.md",
      "---\r\natlas:\r\n  schema: '1'\r\n  realm-schema: '2'\r\n  id: root\r\n  type: custom\r\n  title: Root\r\nrealm: {}\r\n---\r\nfirst\r\nsecond\r\n",
    ),
  ]);

  assert.ok(parsed);
  assert.equal(parsed.page.body, "first\r\nsecond\r\n");
  assert.deepEqual(parsed.source, {
    body: { endLine: 11, startLine: 10 },
    frontmatter: { endLine: 8, startLine: 2 },
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
    atlas: {
      id: "custom:page",
      "realm-schema": "2.0.0",
      schema: "1.0.0",
      title: "Page",
      type: "custom",
    },
    body: "Body",
    realm: { nested: { enabled: true } },
  };

  assert.equal(Value.Check(RealmPageEnvelopeSchema, page), true);
  assert.equal(
    RealmPageEnvelopeSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(RealmPageEnvelopeSchema.additionalProperties, false);
  assert.equal(RealmPageEnvelopeSchema.properties.atlas.additionalProperties, false);
});

test("accepts an empty body after an end-of-file delimiter", () => {
  const [parsed] = parseRealmPages([
    text(".atlas/index.md", validPage("bonfire:root")),
  ]);
  assert.ok(parsed);
  assert.equal(parsed.page.body, "");
  assert.deepEqual(parsed.source.body, { endLine: 10, startLine: 10 });
});
