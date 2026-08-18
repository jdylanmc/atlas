import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { RealmTextFile } from "../src/realm/load_realm_text.ts";
import {
  parseRealmPages,
  type ParsedRealmPage,
} from "../src/realm/parse_realm_pages.ts";
import {
  RealmPageSerializeError,
  serializeRealmPages,
} from "../src/realm/serialize_realm_pages.ts";

const fixtureRoot = resolve(import.meta.dirname, "fixtures", "realm-pages");

function text(path: string, content: string): RealmTextFile {
  return Object.freeze({ content, path });
}

function fixture(path: string): RealmTextFile {
  return text(path, readFileSync(resolve(fixtureRoot, path), "utf8"));
}

function pageSource(
  id: string,
  options: { readonly body?: string; readonly realm?: readonly string[] } = {},
): string {
  return [
    "---",
    "atlas:",
    "  atlas-schema: '1'",
    "  realm-schema: '2'",
    `  id: ${id}`,
    "  type: custom",
    "  title: Page",
    '  created-at: "2026-08-17T00:00:00Z"',
    '  updated-at: "2026-08-17T00:00:00Z"',
    "  created-by: { kind: agent, name: Test Agent }",
    "  updated-by: { kind: human, name: Test Reviewer }",
    "  tags: []",
    ...(options.realm === undefined ? ["realm: {}"] : ["realm:", ...options.realm]),
    "---",
    options.body ?? "",
  ].join("\n");
}

function serializeOne(path: string, source: string): string {
  const [file] = serializeRealmPages(parseRealmPages([text(path, source)]));
  assert.ok(file);
  return file.content;
}

function fabricatedPage(path: string, realm: unknown): ParsedRealmPage {
  return {
    page: {
      atlas: {
        "atlas-schema": "1",
        "created-at": "2026-08-17T00:00:00Z",
        "created-by": { kind: "agent", name: "Test Agent" },
        id: "custom:fabricated",
        "realm-schema": "2",
        tags: [],
        title: "Page",
        type: "custom",
        "updated-at": "2026-08-17T00:00:00Z",
        "updated-by": { kind: "human", name: "Test Reviewer" },
      },
      body: "",
      realm,
    },
    source: {
      body: { endLine: 15, startLine: 15 },
      frontmatter: { endLine: 13, startLine: 2 },
      path,
    },
  } as unknown as ParsedRealmPage;
}

function serializeError(page: ParsedRealmPage): RealmPageSerializeError {
  try {
    serializeRealmPages([page]);
  } catch (error: unknown) {
    assert.ok(error instanceof RealmPageSerializeError);
    return error;
  }
  assert.fail("Expected RealmPageSerializeError.");
}

test("serializes fixture pages to canonical bytes in code point path order", () => {
  const files = serializeRealmPages(
    parseRealmPages([
      fixture(".atlas/lore/parser-source.md"),
      fixture(".atlas/insights/parsing.md"),
      fixture(".atlas/CHANGELOG.md"),
      fixture(".atlas/index.md"),
    ]),
  );

  assert.deepEqual(
    files.map((file) => file.path),
    [".atlas/index.md", ".atlas/insights/parsing.md", ".atlas/lore/parser-source.md"],
  );
  assert.equal(
    files[0]?.content,
    [
      "---",
      "atlas:",
      "  atlas-schema: 1.0.0",
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by:",
      "    kind: human",
      "    name: Fixture Author",
      "  id: bonfire:root",
      "  realm-schema: 1.0.0",
      "  tags: []",
      "  title: Fixture Realm",
      "  type: bonfire",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Fixture Author",
      "realm: {}",
      "---",
      "",
      "# Fixture Realm",
      "",
      "Enter here.",
      "",
    ].join("\n"),
  );
  assert.equal(
    files[1]?.content,
    [
      "---",
      "atlas:",
      "  atlas-schema: 1.0.0",
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by:",
      "    kind: agent",
      "    name: Fixture Agent",
      "  id: insight:parsing",
      "  realm-schema: 1.0.0",
      "  tags:",
      "    - parsing",
      "  title: Parsing",
      "  type: insight",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Fixture Reviewer",
      "realm:",
      "  confidence: reviewed",
      "---",
      "",
      "# Parsing",
      "",
      "Atlas parses each page body once with maintained GFM footnote support.[^parser]",
      "",
      "[^parser]: [[.atlas/lore/parser-source]] Maintained parser documentation.",
      "",
    ].join("\n"),
  );
  assert.equal(
    files[2]?.content,
    [
      "---",
      "atlas:",
      "  atlas-schema: 1.0.0",
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by:",
      "    kind: human",
      "    name: Fixture Author",
      "  id: lore:parser-source",
      "  realm-schema: 1.0.0",
      "  tags:",
      "    - parsing",
      "  title: Parser Source",
      "  type: lore",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Fixture Author",
      "realm: {}",
      "---",
      "",
      "# Parser Source",
      "",
      "Maintained parser documentation.",
      "",
    ].join("\n"),
  );
});

test("canonical bytes ignore source key order, quoting, and collection style", () => {
  const ordered = serializeOne(
    ".atlas/insights/order.md",
    pageSource("insight:order", {
      body: "Body\n",
      realm: [
        "  alpha:",
        "    beta: 1",
        "    gamma: 2",
        "  delta:",
        "    - first",
        "    - second",
      ],
    }),
  );
  const shuffled = serializeOne(
    ".atlas/insights/order.md",
    [
      "---",
      "atlas:",
      "  tags: []",
      "  updated-by: { kind: human, name: Test Reviewer }",
      "  created-by:",
      "    name: Test Agent",
      "    kind: agent",
      '  updated-at: "2026-08-17T00:00:00Z"',
      '  created-at: "2026-08-17T00:00:00Z"',
      "  title: 'Page'",
      "  type: custom",
      "  id: insight:order",
      "  realm-schema: '2'",
      "  atlas-schema: '1'",
      "realm: { delta: [first, second], alpha: { gamma: 2, beta: 1 } }",
      "---",
      "Body",
      "",
    ].join("\n"),
  );

  assert.equal(shuffled, ordered);
  assert.equal(
    ordered,
    [
      "---",
      "atlas:",
      '  atlas-schema: "1"',
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by:",
      "    kind: agent",
      "    name: Test Agent",
      "  id: insight:order",
      '  realm-schema: "2"',
      "  tags: []",
      "  title: Page",
      "  type: custom",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Test Reviewer",
      "realm:",
      "  alpha:",
      "    beta: 1",
      "    gamma: 2",
      "  delta:",
      "    - first",
      "    - second",
      "---",
      "Body",
      "",
    ].join("\n"),
  );
});

test("quotes ambiguous scalars and preserves Unicode and array order", () => {
  const source = pageSource("insight:scalars", {
    body: "Body\n",
    realm: [
      '  zeta: "yes"',
      '  "\u00fcn\u00efcode": "\u{1f600} \u{1d518} e\u0301"',
      '  timestamp: "2026-08-17T00:00:00Z"',
      '  order: ["zulu", "alpha", 10, 9]',
      '  "null": "null"',
      '  hash: "#one"',
      '  trailing: "value "',
      '  colon: "12:00"',
      '  empty: ""',
      "  flag: true",
      "  missing: null",
      "  number: 1.5",
      '  multiline: "line one\\nline two"',
    ],
  });
  const content = serializeOne(".atlas/insights/scalars.md", source);

  assert.equal(
    content.slice(content.indexOf("realm:")),
    [
      "realm:",
      "  colon: 12:00",
      '  empty: ""',
      "  flag: true",
      '  hash: "#one"',
      "  missing: null",
      '  multiline: "line one\\nline two"',
      '  "null": "null"',
      "  number: 1.5",
      "  order:",
      "    - zulu",
      "    - alpha",
      "    - 10",
      "    - 9",
      '  timestamp: "2026-08-17T00:00:00Z"',
      '  trailing: "value "',
      "  zeta: yes",
      "  \u00fcn\u00efcode: \u{1f600} \u{1d518} e\u0301",
      "---",
      "Body",
      "",
    ].join("\n"),
  );

  const [reparsed] = parseRealmPages([text(".atlas/insights/scalars.md", content)]);
  const [original] = parseRealmPages([text(".atlas/insights/scalars.md", source)]);
  assert.ok(reparsed);
  assert.ok(original);
  assert.deepEqual(reparsed.page, original.page);
});

test("orders pages by code point rather than UTF-16 code unit", () => {
  const files = serializeRealmPages(
    parseRealmPages([
      text(".atlas/insights/\u{10000}.md", pageSource("insight:astral")),
      text(".atlas/insights/\uff00.md", pageSource("insight:halfwidth")),
    ]),
  );

  assert.deepEqual(
    files.map((file) => file.path),
    [".atlas/insights/\uff00.md", ".atlas/insights/\u{10000}.md"],
  );
});

test("repeated serialization and reserialization stay byte identical", () => {
  const pages = parseRealmPages([
    fixture(".atlas/index.md"),
    fixture(".atlas/insights/parsing.md"),
  ]);
  const first = serializeRealmPages(pages);
  const second = serializeRealmPages(pages);
  assert.deepEqual(second, first);

  const reparsed = parseRealmPages(first);
  assert.deepEqual(
    reparsed.map((parsed) => parsed.page),
    pages.map((parsed) => parsed.page),
  );
  assert.deepEqual(serializeRealmPages(reparsed), first);
});

test("emits an empty body and preserves body bytes verbatim", () => {
  const empty = serializeOne(".atlas/insights/empty.md", pageSource("insight:empty"));
  assert.equal(empty.endsWith("realm: {}\n---\n"), true);

  const verbatim = serializeOne(
    ".atlas/insights/verbatim.md",
    pageSource("insight:verbatim", { body: "one \r\ntwo\t\n\n" }),
  );
  assert.equal(verbatim.slice(verbatim.indexOf("---\n", 4) + 4), "one \r\ntwo\t\n\n");
});

test("rejects Realm pages that share one canonical path", () => {
  const [parsed] = parseRealmPages([
    text(".atlas/insights/same.md", pageSource("insight:one")),
  ]);
  assert.ok(parsed);

  assert.throws(
    () => serializeRealmPages([parsed, parsed]),
    (error: unknown) => {
      assert.ok(error instanceof RealmPageSerializeError);
      assert.equal(error.code, "DUPLICATE_PAGE_PATH");
      assert.equal(error.path, ".atlas/insights/same.md");
      assert.equal(error.name, "RealmPageSerializeError");
      assert.equal(error.message, "Realm pages share one canonical path.");
      return true;
    },
  );
});

test("rejects frontmatter values canonical YAML cannot represent", () => {
  const unsupported: readonly (readonly [string, unknown])[] = [
    ["undefined", { value: undefined }],
    ["not a number", { value: Number.NaN }],
    ["infinity", { value: Number.POSITIVE_INFINITY }],
    ["negative zero", { value: -0 }],
    ["date", { value: new Date(0) }],
    ["map", { value: new Map() }],
    ["function", { value: () => "value" }],
    ["symbol in array", { value: [Symbol.iterator] }],
    ["null prototype", { value: Object.create(null) as Record<string, unknown> }],
    ["nested big integer", { nested: [{ deep: 9n }] }],
    [
      "symbol key",
      Object.defineProperty({}, Symbol.for("hidden"), { enumerable: true, value: 1 }),
    ],
  ];

  for (const [label, realm] of unsupported) {
    const error = serializeError(fabricatedPage(".atlas/insights/bad.md", realm));
    assert.equal(error.code, "UNREPRESENTABLE_VALUE", label);
    assert.equal(error.path, ".atlas/insights/bad.md", label);
    assert.equal(
      error.message,
      "Realm page frontmatter holds an unrepresentable value.",
      label,
    );
  }
});

test("preserves inputs and returns deeply frozen text files", () => {
  const pages = parseRealmPages([fixture(".atlas/insights/parsing.md")]);
  const before: unknown = structuredClone(pages);

  const files = serializeRealmPages(pages);

  assert.deepEqual(structuredClone(pages), before);
  assert.equal(Object.isFrozen(files), true);
  assert.equal(files.length, 1);
  const [file] = files;
  assert.ok(file);
  assert.equal(Object.isFrozen(file), true);
  assert.throws(() => {
    (file as { content: string }).content = "changed";
  }, TypeError);
  assert.throws(() => {
    (files as RealmTextFile[]).push(file);
  }, TypeError);
});
