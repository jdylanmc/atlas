import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { RealmTextFile } from "../src/realm/load_realm_text.ts";
import {
  parseRealmPages,
  RealmPageParseError,
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

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  Object.freeze(value);
  for (const entry of Object.values(value)) {
    deepFreeze(entry);
  }
}

function fabricatedPage(
  path: string,
  realm: unknown,
  atlasOverrides: Readonly<Record<string, unknown>> = {},
): ParsedRealmPage {
  const page = {
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
        ...atlasOverrides,
      },
      body: "",
      realm,
    },
    source: {
      body: { endLine: 15, startLine: 15 },
      frontmatter: { endLine: 13, startLine: 2 },
      path,
    },
  };
  deepFreeze(page);
  return page as unknown as ParsedRealmPage;
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

test("keeps own __proto__ entries, siblings, and numeric keys literal", () => {
  const source = pageSource("insight:proto", {
    body: "Body\n",
    realm: [
      "  __proto__: [1, 2]",
      "  alpha: first",
      "  nested:",
      '    "10": ten',
      '    "2": two',
      "    __proto__: { alpha: 3 }",
      "    alpha: nested-first",
    ],
  });
  const content = serializeOne(".atlas/insights/proto.md", source);

  assert.equal(
    content.slice(content.indexOf("realm:")),
    [
      "realm:",
      "  __proto__:",
      "    - 1",
      "    - 2",
      "  alpha: first",
      "  nested:",
      '    "10": ten',
      '    "2": two',
      "    __proto__:",
      "      alpha: 3",
      "    alpha: nested-first",
      "---",
      "Body",
      "",
    ].join("\n"),
  );

  const [reparsed] = parseRealmPages([text(".atlas/insights/proto.md", content)]);
  const [original] = parseRealmPages([text(".atlas/insights/proto.md", source)]);
  assert.ok(reparsed);
  assert.ok(original);
  assert.deepEqual(reparsed.page, original.page);

  const realm = reparsed.page.realm as unknown as Readonly<Record<string, unknown>>;
  assert.equal(Object.getPrototypeOf(realm), Object.prototype);
  assert.deepEqual(Object.keys(realm), ["__proto__", "alpha", "nested"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(realm, "__proto__")?.value, [1, 2]);

  const nested = realm["nested"] as Readonly<Record<string, unknown>>;
  assert.equal(Object.getPrototypeOf(nested), Object.prototype);
  assert.deepEqual(Object.keys(nested).toSorted(), ["10", "2", "__proto__", "alpha"]);
  assert.equal(nested["alpha"], "nested-first");
  assert.deepEqual(Object.getOwnPropertyDescriptor(nested, "__proto__")?.value, {
    alpha: 3,
  });

  // Runtime objects list integer-like keys first, so canonical order must come from
  // the serializer rather than from the parsed object's own key order.
  assert.deepEqual(serializeRealmPages([reparsed]).at(0)?.content, content);
});

test("emits and reparses negative zero exactly", () => {
  const content = serializeOne(
    ".atlas/insights/zero.md",
    pageSource("insight:zero", {
      body: "Body\n",
      realm: ["  negative: -0.0", "  positive: 0"],
    }),
  );

  assert.equal(
    content.slice(content.indexOf("realm:")),
    ["realm:", "  negative: -0", "  positive: 0", "---", "Body", ""].join("\n"),
  );

  const [reparsed] = parseRealmPages([text(".atlas/insights/zero.md", content)]);
  assert.ok(reparsed);
  const realm = reparsed.page.realm as unknown as Readonly<Record<string, unknown>>;
  assert.equal(Object.is(realm["negative"], -0), true);
  assert.equal(Object.is(realm["positive"], 0), true);
});

test("sorts fabricated page inputs by code point rather than UTF-16 code unit", () => {
  const files = serializeRealmPages([
    fabricatedPage(".atlas/insights/\u{10000}.md", {}),
    fabricatedPage(".atlas/insights/zulu.md", {}),
    fabricatedPage(".atlas/insights/\uff00.md", {}),
    fabricatedPage(".atlas/insights/alpha.md", {}),
  ]);

  assert.deepEqual(
    files.map((file) => file.path),
    [
      ".atlas/insights/alpha.md",
      ".atlas/insights/zulu.md",
      ".atlas/insights/\uff00.md",
      ".atlas/insights/\u{10000}.md",
    ],
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

test("sorts before detecting non-adjacent duplicate canonical paths", () => {
  const duplicated = [
    fabricatedPage(".atlas/insights/alpha.md", {}),
    fabricatedPage(".atlas/insights/zulu.md", {}),
    fabricatedPage(".atlas/insights/alpha.md", {}),
  ];

  assert.throws(
    () => serializeRealmPages(duplicated),
    (error: unknown) => {
      assert.ok(error instanceof RealmPageSerializeError);
      assert.equal(error.code, "DUPLICATE_PAGE_PATH");
      assert.equal(error.path, ".atlas/insights/alpha.md");
      assert.equal(error.name, "RealmPageSerializeError");
      assert.equal(error.message, "Realm pages share one canonical path.");
      return true;
    },
  );
});

test("rejects pages the parser's envelope contract would reject", () => {
  const invalid: readonly (readonly [string, unknown])[] = [
    ["undefined", { value: undefined }],
    ["not a number", { value: Number.NaN }],
    ["infinity", { value: Number.POSITIVE_INFINITY }],
    ["date", { value: new Date(0) }],
    ["map", { value: new Map() }],
    ["function", { value: () => "value" }],
    ["symbol in array", { value: [Symbol.iterator] }],
    ["null prototype", { value: Object.create(null) as Record<string, unknown> }],
    ["nested big integer", { nested: [{ deep: 9n }] }],
  ];

  for (const [label, realm] of invalid) {
    const error = serializeError(fabricatedPage(".atlas/insights/bad.md", realm));
    assert.equal(error.code, "INVALID_PAGE_ENVELOPE", label);
    assert.equal(error.path, ".atlas/insights/bad.md", label);
    assert.equal(error.name, "RealmPageSerializeError", label);
    assert.equal(
      error.message,
      "Realm page does not satisfy the page envelope.",
      label,
    );
  }
});

test("rejects a shape compatible page holding an invalid metadata date", () => {
  const error = serializeError(
    fabricatedPage(".atlas/insights/bad.md", {}, { "created-at": "not-a-date" }),
  );

  assert.equal(error.code, "INVALID_PAGE_ENVELOPE");
  assert.equal(error.message, "Realm page does not satisfy the page envelope.");

  // The same metadata written as Markdown never survives parsing, so serializing it
  // would have produced bytes the parser rejects.
  const source = pageSource("insight:bad").replace(
    '"2026-08-17T00:00:00Z"',
    '"not-a-date"',
  );
  assert.throws(
    () => parseRealmPages([text(".atlas/insights/bad.md", source)]),
    (parseError: unknown) => {
      assert.ok(parseError instanceof RealmPageParseError);
      assert.equal(parseError.code, "INVALID_PAGE_ENVELOPE");
      return true;
    },
  );
});

test("emits nothing when any page in the batch is invalid", () => {
  const badDate = { "created-at": "not-a-date" };
  const batches: readonly (readonly [string, readonly ParsedRealmPage[]])[] = [
    [
      "invalid sorts first",
      [
        fabricatedPage(".atlas/insights/zulu.md", {}),
        fabricatedPage(".atlas/insights/alpha.md", {}, badDate),
      ],
    ],
    [
      "invalid sorts last",
      [
        fabricatedPage(".atlas/insights/zulu.md", {}, badDate),
        fabricatedPage(".atlas/insights/alpha.md", {}),
      ],
    ],
  ];

  for (const [label, pages] of batches) {
    assert.throws(
      () => serializeRealmPages(pages),
      (error: unknown) => {
        assert.ok(error instanceof RealmPageSerializeError);
        assert.equal(error.code, "INVALID_PAGE_ENVELOPE", label);
        return true;
      },
      label,
    );
  }
});

test("rejects frontmatter values canonical YAML cannot represent", () => {
  const hidden = Symbol.for("hidden");
  const unsupported: readonly (readonly [string, unknown])[] = [
    [
      "symbol key",
      Object.defineProperty({}, hidden, { enumerable: true, value: "dropped" }),
    ],
    [
      "nested symbol key",
      {
        nested: Object.defineProperty({ kept: "yes" }, hidden, {
          enumerable: true,
          value: "dropped",
        }),
      },
    ],
  ];

  for (const [label, realm] of unsupported) {
    const error = serializeError(fabricatedPage(".atlas/insights/bad.md", realm));
    assert.equal(error.code, "UNREPRESENTABLE_VALUE", label);
    assert.equal(error.path, ".atlas/insights/bad.md", label);
    assert.equal(error.name, "RealmPageSerializeError", label);
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
