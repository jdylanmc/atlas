import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { RealmTextFile } from "../src/realm/load_realm_text.ts";
import { checkRealmPageEnvelope } from "../src/domain/realm_page.ts";
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
  decorateEnvelope: (envelope: object) => void = () => undefined,
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
  decorateEnvelope(page.page);
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
  const withHiddenKey = <Value extends object>(value: Value): Value =>
    Object.defineProperty(value, hidden, { enumerable: true, value: "dropped" });
  const withHiddenValue = <Value extends object>(value: Value): Value =>
    Object.defineProperty(value, "ghost", { enumerable: false, value: "dropped" });
  const withNamedEntry = <Value extends unknown[]>(value: Value): Value =>
    Object.defineProperty(value, "note", { enumerable: true, value: "dropped" });
  const withArrayKey = <Value extends unknown[]>(value: Value, key: string): Value =>
    Object.defineProperty(value, key, { enumerable: true, value: "dropped" });
  const unsupported: readonly (readonly [string, unknown])[] = [
    ["symbol key", withHiddenKey({})],
    ["nested symbol key", { nested: withHiddenKey({ kept: "yes" }) }],
    ["symbol keyed array", { list: withHiddenKey([1, 2]) }],
    ["symbol keyed array in object", { nested: { list: withHiddenKey(["a"]) } }],
    ["symbol keyed array in array", { list: [withHiddenKey([1])] }],
    ["symbol keyed object in array", { list: [withHiddenKey({ kept: "yes" })] }],
    ["non enumerable key", withHiddenValue({ kept: "yes" })],
    ["nested non enumerable key", { nested: withHiddenValue({ kept: "yes" }) }],
    ["non enumerable key in array", { list: [withHiddenValue({ kept: "yes" })] }],
    ["named array property", { list: withNamedEntry([1, 2]) }],
    ["nested named array property", { nested: { list: withNamedEntry(["a"]) } }],
    ["named array property in array", { list: [withNamedEntry([1])] }],
    ["fractional array key", { list: withArrayKey([1, 2], "1.5") }],
    ["negative array key", { list: withArrayKey([1, 2], "-1") }],
    ["padded array key", { list: withArrayKey([1, 2], "01") }],
    ["array key at the index bound", { list: withArrayKey([1, 2], "4294967295") }],
    ["array key past the index bound", { list: withArrayKey([1, 2], "4294967296") }],
    [
      "maximum safe integer array key",
      { list: withArrayKey([1, 2], "9007199254740991") },
    ],
    [
      "nested array key past the index bound",
      { nested: { list: withArrayKey(["a"], "4294967295") } },
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

test("rejects own properties canonical serialization would omit at the page root", () => {
  const rootCases: readonly (readonly [string, (envelope: object) => void])[] = [
    [
      "symbol key",
      (envelope) => {
        Object.defineProperty(envelope, Symbol.for("hidden"), {
          enumerable: true,
          value: "dropped",
        });
      },
    ],
    [
      "non enumerable key",
      (envelope) => {
        Object.defineProperty(envelope, "ghost", {
          enumerable: false,
          value: "dropped",
        });
      },
    ],
  ];

  for (const [label, decorate] of rootCases) {
    const rooted = fabricatedPage(
      ".atlas/insights/bad.md",
      { kept: "yes" },
      {},
      decorate,
    );

    // The envelope contract cannot see either property, so only the serializer refuses.
    assert.equal(checkRealmPageEnvelope(rooted.page), true, label);

    const error = serializeError(rooted);
    assert.equal(error.code, "UNREPRESENTABLE_VALUE", label);
    assert.equal(error.path, ".atlas/insights/bad.md", label);
    assert.equal(
      error.message,
      "Realm page frontmatter holds an unrepresentable value.",
      label,
    );
  }
});

test("emits nothing when one page holds an unrepresentable value", () => {
  const losses: readonly (readonly [string, () => unknown])[] = [
    [
      "symbol keyed array",
      () => ({
        list: Object.defineProperty([1, 2], Symbol.for("hidden"), {
          enumerable: true,
          value: "dropped",
        }),
      }),
    ],
    [
      "non enumerable key",
      () => Object.defineProperty({ kept: "yes" }, "ghost", { value: "dropped" }),
    ],
    [
      "named array property",
      () => ({
        list: Object.defineProperty([1, 2], "note", {
          enumerable: true,
          value: "dropped",
        }),
      }),
    ],
    [
      "array key past the index bound",
      () => ({
        list: Object.defineProperty([1, 2], "4294967295", {
          enumerable: true,
          value: "dropped",
        }),
      }),
    ],
  ];

  for (const [label, dropped] of losses) {
    const batches: readonly (readonly [string, readonly ParsedRealmPage[]])[] = [
      [
        "sorts first",
        [
          fabricatedPage(".atlas/insights/zulu.md", { kept: "yes" }),
          fabricatedPage(".atlas/insights/alpha.md", dropped()),
        ],
      ],
      [
        "sorts last",
        [
          fabricatedPage(".atlas/insights/zulu.md", dropped()),
          fabricatedPage(".atlas/insights/alpha.md", { kept: "yes" }),
        ],
      ],
    ];

    for (const [position, pages] of batches) {
      assert.throws(
        () => serializeRealmPages(pages),
        (error: unknown) => {
          assert.ok(error instanceof RealmPageSerializeError);
          assert.equal(error.code, "UNREPRESENTABLE_VALUE", `${label} ${position}`);
          return true;
        },
        `${label} ${position}`,
      );
    }
  }
});

test("serializes ordinary arrays that carry no own symbol keys", () => {
  const content = serializeOne(
    ".atlas/insights/arrays.md",
    pageSource("insight:arrays", {
      realm: ["  list: [3, 1, 2]", "  nested:", "    - [b, a]", "    - {}"],
    }),
  );

  assert.equal(
    content.slice(content.indexOf("realm:")),
    [
      "realm:",
      "  list:",
      "    - 3",
      "    - 1",
      "    - 2",
      "  nested:",
      "    - - b",
      "      - a",
      "    - {}",
      "---",
      "",
    ].join("\n"),
  );
});

test("keeps owned array indices and refuses keys past the index bound", () => {
  const path = ".atlas/insights/indices.md";

  // An index equal to the previous length is a real entry: it extends the array and
  // canonicalization visits it.
  const extended: unknown[] = Object.defineProperty([1, 2], "2", {
    enumerable: true,
    value: "kept",
  });
  assert.equal(extended.length, 3);

  // Large canonical indices stay entries as well.
  const dense = Array.from({ length: 1001 }, (_entry, index) => index);
  assert.equal(Object.hasOwn(dense, "1000"), true);

  const [file] = serializeRealmPages([fabricatedPage(path, { dense, list: extended })]);
  assert.ok(file);
  const [reparsed] = parseRealmPages([text(path, file.content)]);
  assert.ok(reparsed);
  assert.deepEqual(reparsed.page.realm, { dense, list: [1, 2, "kept"] });

  // A key at or above 2 ** 32 - 1 is a named property instead: the length is
  // untouched and array canonicalization drops it. The bound can only be pinned from
  // this side, because an array that really owns index 2 ** 32 - 2 has length
  // 2 ** 32 - 1 and is necessarily sparse, which the envelope contract only settles
  // after walking every index.
  const named: unknown[] = Object.defineProperty([1, 2], "4294967295", {
    enumerable: true,
    value: "dropped",
  });
  assert.equal(named.length, 2);

  const error = serializeError(fabricatedPage(path, { list: named }));
  assert.equal(error.code, "UNREPRESENTABLE_VALUE");
  assert.equal(error.path, path);
  assert.equal(error.message, "Realm page frontmatter holds an unrepresentable value.");
});

test("serializes mapping keys longer than the YAML simple key limit", () => {
  const longKey = "k".repeat(1100);
  const realm = { [longKey]: "direct", nested: { [longKey]: ["one", "two"] } };
  const path = ".atlas/insights/long-keys.md";

  const [file] = serializeRealmPages([fabricatedPage(path, realm)]);
  assert.ok(file);
  assert.equal(file.content.includes(`  ? ${longKey}\n  : direct\n`), true);
  assert.equal(
    file.content.includes(`    ? ${longKey}\n    : - one\n      - two\n`),
    true,
  );

  const [reparsed] = parseRealmPages([text(path, file.content)]);
  assert.ok(reparsed);
  assert.deepEqual(reparsed.page.realm, realm);
  const [again] = serializeRealmPages([reparsed]);
  assert.ok(again);
  assert.equal(again.content, file.content);
});

test("emits fold prone multiline strings as single line scalars", () => {
  const head = "x".repeat(30);
  const tail = "y".repeat(30);
  const note = `${head}\n \n${tail}`;
  const path = ".atlas/insights/multiline.md";
  const source = pageSource("insight:multiline", {
    realm: [
      `  note: "${head}\\n \\n${tail}"`,
      "  nested:",
      `    - "${head}\\n \\n${tail}"`,
    ],
  });

  const [parsed] = parseRealmPages([text(path, source)]);
  assert.ok(parsed);
  assert.deepEqual(parsed.page.realm, { nested: [note], note });

  const [file] = serializeRealmPages([parsed]);
  assert.ok(file);
  assert.equal(
    file.content.slice(file.content.indexOf("realm:")),
    [
      "realm:",
      `  nested:`,
      `    - "${head}\\n \\n${tail}"`,
      `  note: "${head}\\n \\n${tail}"`,
      "---",
      "",
    ].join("\n"),
  );

  const [roundTripped] = parseRealmPages([text(path, file.content)]);
  assert.ok(roundTripped);
  assert.deepEqual(roundTripped.page.realm, { nested: [note], note });
  const [again] = serializeRealmPages([roundTripped]);
  assert.ok(again);
  assert.equal(again.content, file.content);
});

test("round trips line and paragraph separators inside values and keys", () => {
  for (const separator of ["\u2028", "\u2029"]) {
    const longKey = `${"k".repeat(1100)}${separator}---`;
    const realm = {
      [longKey]: `a${separator}---${separator}b`,
      note: `a${separator}---${separator}b`,
      zebra: "last",
    };
    const path = ".atlas/insights/separators.md";

    const [file] = serializeRealmPages([fabricatedPage(path, realm)]);
    assert.ok(file);

    const [reparsed] = parseRealmPages([text(path, file.content)]);
    assert.ok(reparsed);
    assert.deepEqual(reparsed.page.realm, realm);
    assert.equal(reparsed.page.body, "");

    const [again] = serializeRealmPages([reparsed]);
    assert.ok(again);
    assert.equal(again.content, file.content);
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
