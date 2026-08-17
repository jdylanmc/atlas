import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { FormatRegistry } from "@sinclair/typebox";
import {
  checkRealmPageEnvelope,
  RealmPageEnvelopeSchema,
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
  return `---\natlas:\n  atlas-schema: '1'\n  realm-schema: '2'\n  id: ${id}\n  type: custom\n  title: Page\n  created-at: "2026-08-17T00:00:00Z"\n  updated-at: "2026-08-17T00:00:00Z"\n  created-by: { kind: agent, name: Test Agent }\n  updated-by: { kind: human, name: Test Reviewer }\n  tags: []\nrealm: {}\n---`;
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
  const page = pages[1].page as unknown as {
    readonly realm: Readonly<Record<string, unknown>>;
  };
  assert.equal(page.realm["confidence"], "reviewed");
});

test("preserves canonical Atlas and Realm mappings for a custom type", () => {
  const [parsed] = parseRealmPages([
    text(
      ".atlas/types/field-guide/custom.md",
      [
        "---",
        "atlas:",
        "  atlas-schema: atlas-next",
        "  realm-schema: realm-next",
        "  id: field-guide:custom",
        "  type: field-guide",
        "  title: Custom Guide",
        '  created-at: "2026-08-17T00:00:00Z"',
        '  updated-at: "2026-08-17T01:00:00+00:00"',
        "  created-by: { kind: agent, name: Test Agent }",
        "  updated-by: { kind: human, name: Test Reviewer }",
        "  originating-operation: operation:custom",
        "  tags: [custom]",
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
      "atlas-schema": "atlas-next",
      "created-at": "2026-08-17T00:00:00Z",
      "created-by": { kind: "agent", name: "Test Agent" },
      id: "field-guide:custom",
      "originating-operation": "operation:custom",
      "realm-schema": "realm-next",
      tags: ["custom"],
      title: "Custom Guide",
      type: "field-guide",
      "updated-at": "2026-08-17T01:00:00+00:00",
      "updated-by": { kind: "human", name: "Test Reviewer" },
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
  const realm = (parsed.page as unknown as { readonly realm: unknown }).realm as {
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
    text(".atlas/index.md", validPage("root").replace("  type: custom", "  type: ' '")),
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
        validPage("root").replace("realm: {}", "realm: &copy {}\ncopy: *copy"),
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

test("rejects non-string YAML mapping keys", () => {
  for (const mapping of [
    "realm:\n  true: value",
    "realm:\n  null: value",
    "realm:\n  ? [one, two]\n  : value",
  ]) {
    assert.equal(
      parseError(
        text(
          ".atlas/types/custom/key.md",
          validPage("custom:key").replace("realm: {}", mapping),
        ),
      ).code,
      "MALFORMED_FRONTMATTER",
    );
  }
});

test("preserves body bytes and stable source lines", () => {
  const [parsed] = parseRealmPages([
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

test("counts bare carriage returns as line endings in source lines", () => {
  const [parsed] = parseRealmPages([
    text(".atlas/index.md", `${validPage("root")}\n# Page\r\rClaim\r`),
  ]);
  assert.ok(parsed);
  assert.equal(parsed.page.body, "# Page\r\rClaim\r");
  assert.deepEqual(parsed.source.body, { endLine: 17, startLine: 15 });

  const [shifted] = parseRealmPages([
    text(
      ".atlas/index.md",
      `${validPage("root").replace("  title: Page", "  title: a\rb")}\n# Page\n`,
    ),
  ]);
  assert.ok(shifted);
  assert.equal(shifted.page.atlas.title, "a\rb");
  assert.deepEqual(shifted.source, {
    body: { endLine: 16, startLine: 16 },
    frontmatter: { endLine: 14, startLine: 2 },
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
  const page = {
    atlas: {
      "atlas-schema": "1.0.0",
      "created-at": "2026-08-17T00:00:00Z",
      "created-by": { kind: "agent", name: "Test Agent" },
      id: "custom:page",
      "realm-schema": "2.0.0",
      tags: [],
      title: "Page",
      type: "custom",
      "updated-at": "2026-08-17T01:00:00Z",
      "updated-by": { kind: "human", name: "Test Reviewer" },
    },
    body: "Body",
    realm: { nested: { enabled: true } },
  };

  assert.equal(checkRealmPageEnvelope(page), true);
  assert.equal(
    RealmPageEnvelopeSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(RealmPageEnvelopeSchema.additionalProperties, false);
  assert.equal(RealmPageEnvelopeSchema.properties.atlas.additionalProperties, false);
});

test("JSON value schema accepts only nested JSON-compatible values", () => {
  const valid = {
    atlas: {
      "atlas-schema": "1",
      "created-at": "2026-08-17T00:00:00Z",
      "created-by": { kind: "agent", name: "Agent" },
      id: "custom:json",
      "realm-schema": "2",
      tags: ["json"],
      title: "JSON",
      type: "custom",
      "updated-at": "2026-08-17T00:00:00Z",
      "updated-by": { kind: "human", name: "Reviewer" },
    },
    body: "",
    realm: { nested: [null, true, 3, "text", { value: false }] },
  };
  assert.equal(checkRealmPageEnvelope(valid), true);

  for (const value of [
    undefined,
    1n,
    (): void => undefined,
    new Date(),
    new Set(),
    Buffer.from("binary"),
  ]) {
    assert.equal(
      checkRealmPageEnvelope({
        ...valid,
        realm: { value },
      }),
      false,
    );
  }
});

test("validates canonical date-time calendar and clock values", () => {
  const withCreatedAt = (timestamp: string): RealmTextFile =>
    text(
      ".atlas/index.md",
      validPage("bonfire:root").replace("2026-08-17T00:00:00Z", timestamp),
    );

  for (const timestamp of [
    "2024-02-29T23:59:59Z",
    "1990-12-31T23:59:60Z",
    "2026-08-17t12:34:56z",
    "2026-08-17T12:34:56+05:30",
  ]) {
    assert.equal(parseRealmPages([withCreatedAt(timestamp)]).length, 1);
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
    const modulePath = "../src/domain/realm_page.ts?format-registry-isolation";
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
  const [parsed] = parseRealmPages([
    text(".atlas/index.md", validPage("bonfire:root")),
  ]);
  assert.ok(parsed);
  assert.equal(parsed.page.body, "");
  assert.deepEqual(parsed.source.body, { endLine: 15, startLine: 15 });
});
