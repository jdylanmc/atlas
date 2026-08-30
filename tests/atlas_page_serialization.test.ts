import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { AtlasTextFile } from "../src/atlas/load_atlas_text.ts";
import { checkAtlasPageEnvelope } from "../src/domain/atlas_page.ts";
import {
  parseAtlasPages,
  AtlasPageParseError,
  type ParsedAtlasPage,
} from "../src/atlas/parse_atlas_pages.ts";
import {
  AtlasPageSerializeError,
  serializeAtlasPages,
} from "../src/atlas/serialize_atlas_pages.ts";

const fixtureRoot = resolve(import.meta.dirname, "fixtures", "atlas-pages");

function text(path: string, content: string): AtlasTextFile {
  return Object.freeze({ content, path });
}

function fixture(path: string): AtlasTextFile {
  return text(path, readFileSync(resolve(fixtureRoot, path), "utf8"));
}

function pageSource(
  id: string,
  options: { readonly body?: string; readonly atlas?: readonly string[] } = {},
): string {
  return [
    "---",
    "sdk:",
    "  atlas-sdk-schema: '1'",
    "  local-atlas-schema: '2'",
    `  id: ${id}`,
    "  type: custom",
    "  title: Page",
    '  created-at: "2026-08-17T00:00:00Z"',
    '  updated-at: "2026-08-17T00:00:00Z"',
    "  created-by: { kind: agent, name: Test Agent }",
    "  updated-by: { kind: human, name: Test Reviewer }",
    "  tags: []",
    ...(options.atlas === undefined ? ["atlas: {}"] : ["atlas:", ...options.atlas]),
    "---",
    options.body ?? "",
  ].join("\n");
}

function serializeOne(path: string, source: string): string {
  const [file] = serializeAtlasPages(parseAtlasPages([text(path, source)]));
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
  atlas: unknown,
  sdkOverrides: Readonly<Record<string, unknown>> = {},
  decorateEnvelope: (envelope: object) => void = () => undefined,
): ParsedAtlasPage {
  const page = {
    page: {
      sdk: {
        "atlas-sdk-schema": "1",
        "created-at": "2026-08-17T00:00:00Z",
        "created-by": { kind: "agent", name: "Test Agent" },
        id: "custom:fabricated",
        "local-atlas-schema": "2",
        tags: [],
        title: "Page",
        type: "custom",
        "updated-at": "2026-08-17T00:00:00Z",
        "updated-by": { kind: "human", name: "Test Reviewer" },
        ...sdkOverrides,
      },
      body: "",
      atlas,
    },
    source: {
      body: { endLine: 15, startLine: 15 },
      frontmatter: { endLine: 13, startLine: 2 },
      path,
    },
  };
  decorateEnvelope(page.page);
  deepFreeze(page);
  return page as unknown as ParsedAtlasPage;
}

function serializeError(page: ParsedAtlasPage): AtlasPageSerializeError {
  try {
    serializeAtlasPages([page]);
  } catch (error: unknown) {
    assert.ok(error instanceof AtlasPageSerializeError);
    return error;
  }
  assert.fail("Expected AtlasPageSerializeError.");
}

test("serializes fixture pages to canonical bytes in code point path order", () => {
  const files = serializeAtlasPages(
    parseAtlasPages([
      fixture(".atlas/sources/parser-source.md"),
      fixture(".atlas/concepts/parsing.md"),
      fixture(".atlas/CHANGELOG.md"),
      fixture(".atlas/index.md"),
    ]),
  );

  assert.deepEqual(
    files.map((file) => file.path),
    [
      ".atlas/concepts/parsing.md",
      ".atlas/index.md",
      ".atlas/sources/parser-source.md",
    ],
  );
  assert.equal(
    files[1]?.content,
    [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by:",
      "    kind: human",
      "    name: Fixture Author",
      "  id: anchor:root",
      "  local-atlas-schema: 1.0.0",
      "  tags: []",
      "  title: Fixture Atlas",
      "  type: anchor",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Fixture Author",
      "atlas: {}",
      "---",
      "",
      "# Fixture Atlas",
      "",
      "Enter here.",
      "",
    ].join("\n"),
  );
  assert.equal(
    files[0]?.content,
    [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by:",
      "    kind: agent",
      "    name: Fixture Agent",
      "  id: concept:parsing",
      "  local-atlas-schema: 1.0.0",
      "  tags:",
      "    - parsing",
      "  title: Parsing",
      "  type: concept",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Fixture Reviewer",
      "atlas:",
      "  confidence: reviewed",
      "---",
      "",
      "# Parsing",
      "",
      "Atlas SDK parses each page body once with maintained GFM footnote support.[^parser]",
      "",
      "[^parser]: [[.atlas/sources/parser-source]] Maintained parser documentation.",
      "",
    ].join("\n"),
  );
  assert.equal(
    files[2]?.content,
    [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by:",
      "    kind: human",
      "    name: Fixture Author",
      "  id: source:parser-source",
      "  local-atlas-schema: 1.0.0",
      "  tags:",
      "    - parsing",
      "  title: Parser Source",
      "  type: source",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Fixture Author",
      "atlas: {}",
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
    ".atlas/concepts/order.md",
    pageSource("concept:order", {
      body: "Body\n",
      atlas: [
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
    ".atlas/concepts/order.md",
    [
      "---",
      "sdk:",
      "  tags: []",
      "  updated-by: { kind: human, name: Test Reviewer }",
      "  created-by:",
      "    name: Test Agent",
      "    kind: agent",
      '  updated-at: "2026-08-17T00:00:00Z"',
      '  created-at: "2026-08-17T00:00:00Z"',
      "  title: 'Page'",
      "  type: custom",
      "  id: concept:order",
      "  local-atlas-schema: '2'",
      "  atlas-sdk-schema: '1'",
      "atlas: { delta: [first, second], alpha: { gamma: 2, beta: 1 } }",
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
      "sdk:",
      '  atlas-sdk-schema: "1"',
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by:",
      "    kind: agent",
      "    name: Test Agent",
      "  id: concept:order",
      '  local-atlas-schema: "2"',
      "  tags: []",
      "  title: Page",
      "  type: custom",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Test Reviewer",
      "atlas:",
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
  const source = pageSource("concept:scalars", {
    body: "Body\n",
    atlas: [
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
  const content = serializeOne(".atlas/concepts/scalars.md", source);

  assert.equal(
    content.slice(content.indexOf("atlas:")),
    [
      "atlas:",
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

  const [reparsed] = parseAtlasPages([text(".atlas/concepts/scalars.md", content)]);
  const [original] = parseAtlasPages([text(".atlas/concepts/scalars.md", source)]);
  assert.ok(reparsed);
  assert.ok(original);
  assert.deepEqual(reparsed.page, original.page);
});

test("keeps own __proto__ entries, siblings, and numeric keys literal", () => {
  const source = pageSource("concept:proto", {
    body: "Body\n",
    atlas: [
      "  __proto__: [1, 2]",
      "  alpha: first",
      "  nested:",
      '    "10": ten',
      '    "2": two',
      "    __proto__: { alpha: 3 }",
      "    alpha: nested-first",
    ],
  });
  const content = serializeOne(".atlas/concepts/proto.md", source);

  assert.equal(
    content.slice(content.indexOf("atlas:")),
    [
      "atlas:",
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

  const [reparsed] = parseAtlasPages([text(".atlas/concepts/proto.md", content)]);
  const [original] = parseAtlasPages([text(".atlas/concepts/proto.md", source)]);
  assert.ok(reparsed);
  assert.ok(original);
  assert.deepEqual(reparsed.page, original.page);

  const atlas = reparsed.page.atlas as unknown as Readonly<Record<string, unknown>>;
  assert.equal(Object.getPrototypeOf(atlas), Object.prototype);
  assert.deepEqual(Object.keys(atlas), ["__proto__", "alpha", "nested"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(atlas, "__proto__")?.value, [1, 2]);

  const nested = atlas["nested"] as Readonly<Record<string, unknown>>;
  assert.equal(Object.getPrototypeOf(nested), Object.prototype);
  assert.deepEqual(Object.keys(nested).toSorted(), ["10", "2", "__proto__", "alpha"]);
  assert.equal(nested["alpha"], "nested-first");
  assert.deepEqual(Object.getOwnPropertyDescriptor(nested, "__proto__")?.value, {
    alpha: 3,
  });

  // Runtime objects list integer-like keys first, so canonical order must come from
  // the serializer rather than from the parsed object's own key order.
  assert.deepEqual(serializeAtlasPages([reparsed]).at(0)?.content, content);
});

test("emits and reparses negative zero exactly", () => {
  const content = serializeOne(
    ".atlas/concepts/zero.md",
    pageSource("concept:zero", {
      body: "Body\n",
      atlas: ["  negative: -0.0", "  positive: 0"],
    }),
  );

  assert.equal(
    content.slice(content.indexOf("atlas:")),
    ["atlas:", "  negative: -0", "  positive: 0", "---", "Body", ""].join("\n"),
  );

  const [reparsed] = parseAtlasPages([text(".atlas/concepts/zero.md", content)]);
  assert.ok(reparsed);
  const atlas = reparsed.page.atlas as unknown as Readonly<Record<string, unknown>>;
  assert.equal(Object.is(atlas["negative"], -0), true);
  assert.equal(Object.is(atlas["positive"], 0), true);
});

test("sorts fabricated page inputs by code point rather than UTF-16 code unit", () => {
  const files = serializeAtlasPages([
    fabricatedPage(".atlas/concepts/\u{10000}.md", {}),
    fabricatedPage(".atlas/concepts/zulu.md", {}),
    fabricatedPage(".atlas/concepts/\uff00.md", {}),
    fabricatedPage(".atlas/concepts/alpha.md", {}),
  ]);

  assert.deepEqual(
    files.map((file) => file.path),
    [
      ".atlas/concepts/alpha.md",
      ".atlas/concepts/zulu.md",
      ".atlas/concepts/\uff00.md",
      ".atlas/concepts/\u{10000}.md",
    ],
  );
});

test("repeated serialization and reserialization stay byte identical", () => {
  const pages = parseAtlasPages([
    fixture(".atlas/index.md"),
    fixture(".atlas/concepts/parsing.md"),
  ]);
  const first = serializeAtlasPages(pages);
  const second = serializeAtlasPages(pages);
  assert.deepEqual(second, first);

  const reparsed = parseAtlasPages(first);
  assert.deepEqual(
    reparsed.map((parsed) => parsed.page),
    pages.map((parsed) => parsed.page),
  );
  assert.deepEqual(serializeAtlasPages(reparsed), first);
});

test("preserves an unrecognized SDK-owned key through a parse-then-serialize round trip", () => {
  // A newer Atlas SDK may add an SDK-owned field this SDK predates. ADR-0002
  // requires mapping what is recognized and continuing rather than dropping
  // it on rewrite, which would quietly delete knowledge a newer SDK recorded.
  const source = pageSource("custom:extended").replace(
    "  title: Page",
    '  title: Page\n  extension: { nested: [1, 2, "three"] }',
  );
  const pages = parseAtlasPages([text(".atlas/concepts/extended.md", source)]);
  const sdk = pages[0]?.page.sdk as unknown as Readonly<Record<string, unknown>>;
  assert.deepEqual(sdk["extension"], { nested: [1, 2, "three"] });

  const first = serializeAtlasPages(pages);
  const reparsed = parseAtlasPages(first);
  assert.deepEqual(
    reparsed.map((parsed) => parsed.page),
    pages.map((parsed) => parsed.page),
  );
  assert.deepEqual(serializeAtlasPages(reparsed), first);
});

test("emits an empty body and preserves body bytes verbatim", () => {
  const empty = serializeOne(".atlas/concepts/empty.md", pageSource("concept:empty"));
  assert.equal(empty.startsWith("---\nsdk:\n"), true);
  assert.equal(empty.endsWith("\natlas: {}\n---\n"), true);

  const verbatim = serializeOne(
    ".atlas/concepts/verbatim.md",
    pageSource("concept:verbatim", { body: "one \r\ntwo\t\n\n" }),
  );
  assert.equal(verbatim.slice(verbatim.indexOf("---\n", 4) + 4), "one \r\ntwo\t\n\n");
});

test("sorts before detecting non-adjacent duplicate canonical paths", () => {
  const duplicated = [
    fabricatedPage(".atlas/concepts/alpha.md", {}),
    fabricatedPage(".atlas/concepts/zulu.md", {}),
    fabricatedPage(".atlas/concepts/alpha.md", {}),
  ];

  assert.throws(
    () => serializeAtlasPages(duplicated),
    (error: unknown) => {
      assert.ok(error instanceof AtlasPageSerializeError);
      assert.equal(error.code, "DUPLICATE_PAGE_PATH");
      assert.equal(error.path, ".atlas/concepts/alpha.md");
      assert.equal(error.name, "AtlasPageSerializeError");
      assert.equal(error.message, "Atlas pages share one canonical path.");
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

  for (const [label, atlas] of invalid) {
    const error = serializeError(fabricatedPage(".atlas/concepts/bad.md", atlas));
    assert.equal(error.code, "INVALID_PAGE_ENVELOPE", label);
    assert.equal(error.path, ".atlas/concepts/bad.md", label);
    assert.equal(error.name, "AtlasPageSerializeError", label);
    assert.equal(
      error.message,
      "Atlas page does not satisfy the page envelope.",
      label,
    );
  }
});

test("rejects a shape compatible page holding an invalid metadata date", () => {
  const error = serializeError(
    fabricatedPage(".atlas/concepts/bad.md", {}, { "created-at": "not-a-date" }),
  );

  assert.equal(error.code, "INVALID_PAGE_ENVELOPE");
  assert.equal(error.message, "Atlas page does not satisfy the page envelope.");

  // The same metadata written as Markdown never survives parsing, so serializing it
  // would have produced bytes the parser rejects.
  const source = pageSource("concept:bad").replace(
    '"2026-08-17T00:00:00Z"',
    '"not-a-date"',
  );
  assert.throws(
    () => parseAtlasPages([text(".atlas/concepts/bad.md", source)]),
    (parseError: unknown) => {
      assert.ok(parseError instanceof AtlasPageParseError);
      assert.equal(parseError.code, "INVALID_PAGE_ENVELOPE");
      return true;
    },
  );
});

test("emits nothing when any page in the batch is invalid", () => {
  const badDate = { "created-at": "not-a-date" };
  const batches: readonly (readonly [string, readonly ParsedAtlasPage[]])[] = [
    [
      "invalid sorts first",
      [
        fabricatedPage(".atlas/concepts/zulu.md", {}),
        fabricatedPage(".atlas/concepts/alpha.md", {}, badDate),
      ],
    ],
    [
      "invalid sorts last",
      [
        fabricatedPage(".atlas/concepts/zulu.md", {}, badDate),
        fabricatedPage(".atlas/concepts/alpha.md", {}),
      ],
    ],
  ];

  for (const [label, pages] of batches) {
    assert.throws(
      () => serializeAtlasPages(pages),
      (error: unknown) => {
        assert.ok(error instanceof AtlasPageSerializeError);
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

  for (const [label, atlas] of unsupported) {
    const error = serializeError(fabricatedPage(".atlas/concepts/bad.md", atlas));
    assert.equal(error.code, "UNREPRESENTABLE_VALUE", label);
    assert.equal(error.path, ".atlas/concepts/bad.md", label);
    assert.equal(error.name, "AtlasPageSerializeError", label);
    assert.equal(
      error.message,
      "Atlas page frontmatter holds an unrepresentable value.",
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
      ".atlas/concepts/bad.md",
      { kept: "yes" },
      {},
      decorate,
    );

    // The envelope contract cannot see either property, so only the serializer refuses.
    assert.equal(checkAtlasPageEnvelope(rooted.page), true, label);

    const error = serializeError(rooted);
    assert.equal(error.code, "UNREPRESENTABLE_VALUE", label);
    assert.equal(error.path, ".atlas/concepts/bad.md", label);
    assert.equal(
      error.message,
      "Atlas page frontmatter holds an unrepresentable value.",
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
    const batches: readonly (readonly [string, readonly ParsedAtlasPage[]])[] = [
      [
        "sorts first",
        [
          fabricatedPage(".atlas/concepts/zulu.md", { kept: "yes" }),
          fabricatedPage(".atlas/concepts/alpha.md", dropped()),
        ],
      ],
      [
        "sorts last",
        [
          fabricatedPage(".atlas/concepts/zulu.md", dropped()),
          fabricatedPage(".atlas/concepts/alpha.md", { kept: "yes" }),
        ],
      ],
    ];

    for (const [position, pages] of batches) {
      assert.throws(
        () => serializeAtlasPages(pages),
        (error: unknown) => {
          assert.ok(error instanceof AtlasPageSerializeError);
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
    ".atlas/concepts/arrays.md",
    pageSource("concept:arrays", {
      atlas: ["  list: [3, 1, 2]", "  nested:", "    - [b, a]", "    - {}"],
    }),
  );

  assert.equal(
    content.slice(content.indexOf("atlas:")),
    [
      "atlas:",
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
  const path = ".atlas/concepts/indices.md";

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

  const [file] = serializeAtlasPages([fabricatedPage(path, { dense, list: extended })]);
  assert.ok(file);
  const [reparsed] = parseAtlasPages([text(path, file.content)]);
  assert.ok(reparsed);
  assert.deepEqual(reparsed.page.atlas, { dense, list: [1, 2, "kept"] });

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
  assert.equal(error.message, "Atlas page frontmatter holds an unrepresentable value.");
});

test("serializes mapping keys longer than the YAML simple key limit", () => {
  const longKey = "k".repeat(1100);
  const atlas = { [longKey]: "direct", nested: { [longKey]: ["one", "two"] } };
  const path = ".atlas/concepts/long-keys.md";

  const [file] = serializeAtlasPages([fabricatedPage(path, atlas)]);
  assert.ok(file);
  assert.equal(file.content.includes(`  ? ${longKey}\n  : direct\n`), true);
  assert.equal(
    file.content.includes(`    ? ${longKey}\n    : - one\n      - two\n`),
    true,
  );

  const [reparsed] = parseAtlasPages([text(path, file.content)]);
  assert.ok(reparsed);
  assert.deepEqual(reparsed.page.atlas, atlas);
  const [again] = serializeAtlasPages([reparsed]);
  assert.ok(again);
  assert.equal(again.content, file.content);
});

test("emits fold prone multiline strings as single line scalars", () => {
  const head = "x".repeat(30);
  const tail = "y".repeat(30);
  const note = `${head}\n \n${tail}`;
  const path = ".atlas/concepts/multiline.md";
  const source = pageSource("concept:multiline", {
    atlas: [
      `  note: "${head}\\n \\n${tail}"`,
      "  nested:",
      `    - "${head}\\n \\n${tail}"`,
    ],
  });

  const [parsed] = parseAtlasPages([text(path, source)]);
  assert.ok(parsed);
  assert.deepEqual(parsed.page.atlas, { nested: [note], note });

  const [file] = serializeAtlasPages([parsed]);
  assert.ok(file);
  assert.equal(
    file.content.slice(file.content.indexOf("atlas:")),
    [
      "atlas:",
      `  nested:`,
      `    - "${head}\\n \\n${tail}"`,
      `  note: "${head}\\n \\n${tail}"`,
      "---",
      "",
    ].join("\n"),
  );

  const [roundTripped] = parseAtlasPages([text(path, file.content)]);
  assert.ok(roundTripped);
  assert.deepEqual(roundTripped.page.atlas, { nested: [note], note });
  const [again] = serializeAtlasPages([roundTripped]);
  assert.ok(again);
  assert.equal(again.content, file.content);
});

test("serialized line and paragraph separators are rejected at the parse boundary", () => {
  for (const separator of ["\u2028", "\u2029"]) {
    const longKey = `${"k".repeat(1100)}${separator}---`;
    const atlas = {
      [longKey]: `a${separator}---${separator}b`,
      note: `a${separator}---${separator}b`,
      zebra: "last",
    };
    const path = ".atlas/concepts/separators.md";

    const [file] = serializeAtlasPages([fabricatedPage(path, atlas)]);
    assert.ok(file);
    assert.throws(
      () => parseAtlasPages([text(path, file.content)]),
      (error: unknown) =>
        error instanceof AtlasPageParseError &&
        error.code === "NON_CANONICAL_LINE_TERMINATOR",
    );
  }
});

test("preserves inputs and returns deeply frozen text files", () => {
  const pages = parseAtlasPages([fixture(".atlas/concepts/parsing.md")]);
  const before: unknown = structuredClone(pages);

  const files = serializeAtlasPages(pages);

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
    (files as AtlasTextFile[]).push(file);
  }, TypeError);
});
