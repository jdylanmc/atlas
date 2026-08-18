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
  ".atlas/lore/parser-source.md",
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
  for (const [body, title] of [
    ["# **Pa**ge", "Page"],
    ["# _Page_", "Page"],
    ["# \\*Page\\*", '"*Page*"'],
    ["# ![Page](image.png)", "Page"],
    ["# Page\n\n*text* a_b (_)", "Page"],
  ] as const) {
    assert.deepEqual(
      validateRealmStructure([
        validFiles[2] as RealmTextFile,
        page(".atlas/insights/page.md", body, { title }),
      ]),
      [],
    );
  }
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

test("validates visible Citation markers and ignores non-visible syntax", () => {
  const body = [
    "# Page",
    "",
    "Visible claim.[^missing]",
    "Visible **formatted claim[^formatted]**.",
    "",
    "`inline[^code]`",
    "\\[^escaped]",
    "\\\\[^also-missing]",
    "Broken [^ and [^]. Nested [^a[b].",
    "![hidden[^image]](image.png)",
    "[linked text](https://example.test/[^link-url])",
    "<https://example.test/autolink>",
    "",
    "```markdown",
    "fenced[^fence]",
    "```",
    "",
    "<!-- hidden[^comment] -->",
    "",
    "[^code]: [[.atlas/lore/missing]]",
    "[^fence]: [[.atlas/lore/missing]]",
    "[^comment]: [[.atlas/lore/missing]]",
    "",
    "Plain 😀 &#x; &#91^not-a-citation] &amp &; &unknown; &NotEqualTilde;",
  ].join("\n");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 25, line: 17 },
          start: { column: 15, line: 17 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 38, line: 18 },
          start: { column: 26, line: 18 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 18, line: 22 },
          start: { column: 3, line: 22 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 22, line: 32 },
          start: { column: 12, line: 32 },
        },
      },
    ],
  );
});

test("reports malformed, non-Lore, missing, unsafe, and ambiguous Citations", () => {
  const body = [
    "# Page",
    "",
    "Claims.[^malformed][^multiple][^non-lore][^missing][^unsafe][^duplicate]",
    "",
    "[^malformed]: prose only",
    "[^multiple]: [[.atlas/lore/parser-source]] and [[.atlas/lore/parser-source]]",
    "[^non-lore]: [[.atlas/insights/other]]",
    "[^missing]: [[.atlas/lore/absent]]",
    "[^unsafe]: [[../.atlas/lore/source]]",
    "[^duplicate]: [[.atlas/lore/parser-source]]",
    "[^duplicate]: [[.atlas/lore/parser-source]] again",
  ].join("\n");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    validFiles[4] as RealmTextFile,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MALFORMED",
        location: {
          end: { column: 25, line: 19 },
          start: { column: 1, line: 19 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MALFORMED",
        location: {
          end: { column: 77, line: 20 },
          start: { column: 1, line: 20 },
        },
      },
      {
        code: "ATLAS_CITATION_TARGET_NOT_LORE",
        location: {
          end: { column: 39, line: 21 },
          start: { column: 14, line: 21 },
        },
      },
      {
        code: "ATLAS_CITATION_TARGET_MISSING",
        location: {
          end: { column: 35, line: 22 },
          start: { column: 13, line: 22 },
        },
      },
      {
        code: "ATLAS_CITATION_TARGET_INVALID",
        location: {
          end: { column: 37, line: 23 },
          start: { column: 12, line: 23 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_DUPLICATE",
        location: {
          end: { column: 44, line: 24 },
          start: { column: 1, line: 24 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_DUPLICATE",
        location: {
          end: { column: 50, line: 25 },
          start: { column: 1, line: 25 },
        },
      },
    ],
  );
  assert.deepEqual(
    validateRealmStructure(
      [
        validFiles[2] as RealmTextFile,
        validFiles[4] as RealmTextFile,
        page(".atlas/insights/page.md", body),
      ].toReversed(),
    ),
    findings,
  );
  assert.equal(Object.isFrozen(findings), true);
  assert.equal(Object.isFrozen(findings[0]), true);
  assert.equal(Object.isFrozen(findings[0]?.location), true);
  assert.equal(Object.isFrozen(findings[0]?.location?.start), true);
  assert.throws(() => {
    (findings[0] as { message: string }).message = "changed";
  }, TypeError);
});

test("accepts optional Citation fragments and notes with canonical targets", () => {
  const body = [
    "# Page",
    "",
    "One.[^one] Two.[^two]",
    "",
    "[^one]: [[.atlas/lore/parser-source]]",
    "[^two]: [[.atlas/lore/parser-source#section]] Human note.",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/page.md", body),
    ]),
    [],
  );
});

test("rejects absolute, backslash, cross-Realm, traversal, and opaque targets", () => {
  const targets = [
    "/.atlas/lore/source",
    ".atlas\\lore\\source",
    "other:.atlas/lore/source",
    ".atlas/lore/../source",
    ".atlas/lore//source",
    ".atlas/lore/source.md",
    ".atlas/lore/source.pdf",
    ".atlas/unknown/source",
  ];
  const body = [
    "# Page",
    "",
    targets.map((_, index) => `Claim.[^bad-${String(index)}]`).join(" "),
    "",
    ...targets.map((target, index) => `[^bad-${String(index)}]: [[${target}]]`),
  ].join("\n");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code }) => code),
    [
      "ATLAS_CITATION_TARGET_INVALID",
      "ATLAS_CITATION_TARGET_INVALID",
      "ATLAS_CITATION_TARGET_INVALID",
      "ATLAS_CITATION_TARGET_INVALID",
      "ATLAS_CITATION_TARGET_INVALID",
      "ATLAS_CITATION_TARGET_INVALID",
      "ATLAS_CITATION_TARGET_NOT_LORE",
      "ATLAS_CITATION_TARGET_NOT_LORE",
    ],
  );
  assert.equal(JSON.stringify(findings).includes("source.pdf"), false);
});

test("does not borrow or double-count nested Citation definition targets", () => {
  const borrowed = [
    "# Page",
    "",
    "Claim.[^outer]",
    "",
    "[^outer]: Outer note.",
    "",
    "    [^nested]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  const [finding] = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    validFiles[4] as RealmTextFile,
    page(".atlas/insights/page.md", borrowed),
  ]);
  assert.equal(finding?.code, "ATLAS_CITATION_DEFINITION_MALFORMED");

  const directAndNested = [
    "# Page",
    "",
    "Claim.[^outer]",
    "",
    "[^outer]: [[.atlas/lore/parser-source]]",
    "",
    "    [^nested]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/page.md", directAndNested),
    ]),
    [],
  );
});

test("rejects custom type Citation targets until Realm Schema ancestry exists", () => {
  const custom = page(".atlas/types/evidence/source.md", "# Custom Evidence", {
    id: "evidence:source",
    title: "Custom Evidence",
    type: "evidence",
  });
  const body = [
    "# Page",
    "",
    "Present.[^present] Missing.[^missing]",
    "",
    "[^present]: [[.atlas/types/evidence/source]]",
    "[^missing]: [[.atlas/types/evidence/absent]]",
  ].join("\n");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    custom,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code }) => code),
    ["ATLAS_CITATION_TARGET_NOT_LORE", "ATLAS_CITATION_TARGET_NOT_LORE"],
  );
});

test("locates Citations across CR, LF, and CRLF line endings", () => {
  const body = "# Page\n\r\nClaim.[^missing]\r\rSecond.[^also]";
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 17, line: 17 },
          start: { column: 7, line: 17 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 15, line: 19 },
          start: { column: 8, line: 19 },
        },
      },
    ],
  );

  const [blank] = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/blank.md", "\r\r"),
  ]);
  assert.equal(blank?.code, "ATLAS_PAGE_TITLE_H1_REQUIRED");
  assert.deepEqual(blank.location, {
    end: { column: 1, line: 15 },
    start: { column: 1, line: 15 },
  });

  const carriage = page(".atlas/lore/shifted.md", "# Page\n\nClaim.[^missing]");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      {
        content: carriage.content.replace("  id: insight:page", "  id: a\rb"),
        path: carriage.path,
      },
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_PAGE_TYPE_PATH_MISMATCH",
        location: {
          end: { column: 7, line: 7 },
          start: { column: 3, line: 7 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 17, line: 18 },
          start: { column: 7, line: 18 },
        },
      },
    ],
  );
});

test("validates Citation markers in link labels and rejects raw HTML markers", () => {
  const body = [
    "# Page",
    "",
    "[label [^link-label]](https://example.test/x)",
    "",
    "[ref label [^reference-label]][ref]",
    "",
    "[ref]: https://example.test/y",
    "",
    "<https://example.test/[^autolink]>",
    "",
    "<div>",
    "Hidden claim [^html-block]",
    "</div>",
    "",
    'Inline <span title="[^html-attribute]">text</span>.',
  ].join("\n");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 21, line: 17 },
          start: { column: 8, line: 17 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 30, line: 19 },
          start: { column: 12, line: 19 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 27, line: 26 },
          start: { column: 14, line: 26 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 38, line: 29 },
          start: { column: 21, line: 29 },
        },
      },
    ],
  );
});

test("validates deeply nested CommonMark without exhausting the stack", () => {
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/deep.md", `${"> ".repeat(8000)}Claim.[^missing]`),
  ]);
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_PAGE_TITLE_H1_REQUIRED",
        location: {
          end: { column: 16017, line: 15 },
          start: { column: 1, line: 15 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 16017, line: 15 },
          start: { column: 16007, line: 15 },
        },
      },
    ],
  );
});

test("rejects excessive inline delimiter nesting before Markdown parsing", () => {
  const depth = 8000;
  const title = `${"a ".repeat(depth)}Page${" a".repeat(depth)}`;
  const body = `# ${"*a ".repeat(depth)}![Page](image.png)${" a*".repeat(depth)}`;
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(".atlas/insights/deep-heading.md", body, { title }),
    ]).map(({ attribution, code, location, path }) => ({
      attribution,
      code,
      location,
      path,
    })),
    [
      {
        attribution: {
          checkId: "atlas-core.structural-validation",
          kind: "atlas-core",
          trusted: true,
        },
        code: "ATLAS_PAGE_MARKDOWN_COMPLEXITY_EXCEEDED",
        location: {
          end: { column: 7438, line: 15 },
          start: { column: 7437, line: 15 },
        },
        path: ".atlas/insights/deep-heading.md",
      },
    ],
  );
});

test("handles repeated unterminated Citation prefixes deterministically", () => {
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(
        ".atlas/insights/unterminated-citations.md",
        `# Page\n\n${"[^".repeat(50_000)}`,
      ),
    ]),
    [],
  );
});

test("rejects repeated unterminated wiki-link candidates before Markdown parsing", () => {
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(
        ".atlas/insights/unterminated-wikilinks.md",
        `# Page\n\n${"[[target|".repeat(4000)}`,
      ),
    ]).map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_PAGE_MARKDOWN_COMPLEXITY_EXCEEDED",
        location: {
          end: { column: 579, line: 17 },
          start: { column: 577, line: 17 },
        },
        path: ".atlas/insights/unterminated-wikilinks.md",
      },
    ],
  );
});

test("rejects deeply matched nested wiki-link candidates before Markdown parsing", () => {
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(
        ".atlas/insights/nested-wikilinks.md",
        `# Page\n\n${"[".repeat(12_000)}x${"]".repeat(12_000)}`,
      ),
    ]).map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_PAGE_MARKDOWN_COMPLEXITY_EXCEEDED",
        location: {
          end: { column: 67, line: 17 },
          start: { column: 65, line: 17 },
        },
        path: ".atlas/insights/nested-wikilinks.md",
      },
    ],
  );
});

test("rejects excessive nested image labels before Markdown parsing", () => {
  const depth = 2000;
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(
        ".atlas/insights/nested-images.md",
        `# ${"![".repeat(depth)}Page${"](image.png)".repeat(depth)}`,
      ),
    ]).map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_PAGE_MARKDOWN_COMPLEXITY_EXCEEDED",
        location: {
          end: { column: 133, line: 15 },
          start: { column: 132, line: 15 },
        },
        path: ".atlas/insights/nested-images.md",
      },
    ],
  );
});

test("accepts normal links and images with bracket-heavy prose and code", () => {
  const bracketHeavyText = "[plain] ".repeat(2000);
  const nestedImage = `${"![".repeat(16)}nested${"](image.png)".repeat(16)}`;
  const normalWikiLinks = Array.from(
    { length: 256 },
    (_, index) => `[[target-${String(index)}|alias-${String(index)}]]`,
  ).join(" ");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(
        ".atlas/insights/brackets.md",
        [
          "# Page",
          "",
          `[[target]] ${normalWikiLinks}`,
          "",
          `![ordinary](image.png) [${nestedImage}](https://example.test)`,
          "",
          bracketHeavyText,
          "",
          "```text",
          bracketHeavyText,
          "```",
        ].join("\n"),
      ),
    ]),
    [],
  );
});

test("locates thousands of visible split Citation markers deterministically", () => {
  const markerCount = 3000;
  const markers = Array.from(
    { length: markerCount },
    (_, index) => `[*^marker-${String(index)}*]`,
  ).join(" ");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/many-markers.md", `# Page\n\n${markers}`),
  ]);
  assert.equal(findings.length, markerCount);
  const first = findings[0];
  const last = findings.at(-1);
  assert.ok(first);
  assert.ok(last);
  assert.deepEqual(
    { code: first.code, location: first.location, path: first.path },
    {
      code: "ATLAS_CITATION_DEFINITION_MISSING",
      location: {
        end: { column: 14, line: 17 },
        start: { column: 1, line: 17 },
      },
      path: ".atlas/insights/many-markers.md",
    },
  );
  const lastMarker = `[*^marker-${String(markerCount - 1)}*]`;
  const lastStart = markers.lastIndexOf(lastMarker) + 1;
  assert.deepEqual(
    { code: last.code, location: last.location, path: last.path },
    {
      code: "ATLAS_CITATION_DEFINITION_MISSING",
      location: {
        end: { column: lastStart + lastMarker.length, line: 17 },
        start: { column: lastStart, line: 17 },
      },
      path: ".atlas/insights/many-markers.md",
    },
  );
});

test("decodes padded and semicolonless numeric Citation markers in raw HTML", () => {
  const body = [
    "# Page",
    "",
    "<div>&#000000091;^decimal-padded]</div>",
    "",
    "<div>&#91^decimal-unterminated]</div>",
    "",
    "<div>&#x0000005B;^hex-padded]</div>",
    "",
    "<div>&#x5b^hex-unterminated]</div>",
    "",
    "<div>Tom &amp; Jerry &  Co.</div>",
    "",
    "<div>Trailing [^open</div>",
    "",
    'Inline <span title="\\[^escaped-html]">text</span>.',
    "",
    "<!-- \\[^comment] -->",
  ].join("\n");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 34, line: 17 },
          start: { column: 6, line: 17 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 32, line: 19 },
          start: { column: 6, line: 19 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 30, line: 21 },
          start: { column: 6, line: 21 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 29, line: 23 },
          start: { column: 6, line: 23 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 37, line: 29 },
          start: { column: 22, line: 29 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 17, line: 31 },
          start: { column: 7, line: 31 },
        },
      },
    ],
  );
});

test("validates rendered wiki-link alias text for titles and Citations", () => {
  const spoofed = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/spoof.md", "# [[Trusted Title|Spoofed Heading]]", {
      title: "Trusted Title",
    }),
  ]);
  assert.deepEqual(
    spoofed.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_PAGE_TITLE_H1_MISMATCH",
        location: {
          end: { column: 36, line: 15 },
          start: { column: 1, line: 15 },
        },
      },
    ],
  );

  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(".atlas/insights/honest.md", "# [[Trusted Title]]", {
        title: "Trusted Title",
      }),
    ]),
    [],
  );

  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(
        ".atlas/insights/entity-title.md",
        "# [[.atlas/lore/parser-source|A &amp; B]]",
        { title: "A & B" },
      ),
    ]),
    [],
  );

  const aliased = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(
      ".atlas/insights/aliased.md",
      "# Page\n\nClaim [[.atlas/lore/parser-source|see [^missing] note]].",
    ),
  ]);
  assert.deepEqual(
    aliased.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 49, line: 17 },
          start: { column: 39, line: 17 },
        },
      },
    ],
  );
});

test("renders numeric and named character references in wiki-link aliases", () => {
  const title = "€ � � � 😀 Æ ½ ≂̸ 😀";
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(
        ".atlas/insights/entity-values.md",
        "# [[.atlas/lore/parser-source|&#x80; &#0; &#xD800; &#1114112; &#X1F600; &AElig; &frac12; &NotEqualTilde; 😀]]",
        { title },
      ),
    ]),
    [],
  );
});

test("decodes numeric Citation markers in wiki-link aliases", () => {
  const body = [
    "# Page",
    "",
    "Claim [[.atlas/lore/parser-source|&#000000091;^decimal-padded]]].",
    "",
    "Claim [[.atlas/lore/parser-source|&#x5b^hex-unterminated]]].",
  ].join("\n");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 65, line: 17 },
          start: { column: 35, line: 17 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 60, line: 19 },
          start: { column: 35, line: 19 },
        },
      },
    ],
  );
});

test("detects Citation markers split across rendered visible nodes", () => {
  const body = [
    "# Page",
    "",
    "Visible claim.[*^emphasis-split*]",
    "",
    "Visible claim.[**^strong-split**]",
    "",
    "Claim [^[[.atlas/lore/parser-source|alias-boundary]]] tail",
    "",
    "Inline [^<span>html-split</span>] text.",
  ].join("\n");
  const findings = validateRealmStructure([
    validFiles[2] as RealmTextFile,
    page(".atlas/insights/page.md", body),
  ]);
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 34, line: 17 },
          start: { column: 15, line: 17 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 34, line: 19 },
          start: { column: 15, line: 19 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 54, line: 21 },
          start: { column: 7, line: 21 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 34, line: 23 },
          start: { column: 8, line: 23 },
        },
      },
    ],
  );
});

test("resolves split Citation markers to existing definitions", () => {
  const body = [
    "# Page",
    "",
    "Claim.[*^split*] Claim.[^[[.atlas/lore/parser-source|aliased]]]",
    "",
    "[^split]: [[.atlas/lore/parser-source]]",
    "[^aliased]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/page.md", body),
    ]),
    [],
  );
});

test("keys Citations by canonical footnote identity across Unicode folds", () => {
  const folded = [
    "# Page",
    "",
    "Claims.[^ss][^fi][^σ]",
    "",
    "[^ẞ]: [[../.atlas/lore/parser-source]]",
    "[^ﬁ]: prose only",
    "[^σ]: [[.atlas/lore/parser-source]]",
    "[^ς]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/folded.md", folded),
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_TARGET_INVALID",
        location: {
          end: { column: 39, line: 19 },
          start: { column: 7, line: 19 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MALFORMED",
        location: {
          end: { column: 17, line: 20 },
          start: { column: 1, line: 20 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_DUPLICATE",
        location: {
          end: { column: 36, line: 21 },
          start: { column: 1, line: 21 },
        },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_DUPLICATE",
        location: {
          end: { column: 36, line: 22 },
          start: { column: 1, line: 22 },
        },
      },
    ],
  );

  const split = [
    "# Page",
    "",
    "Claim.[*^ẞ*]",
    "",
    "[^ss]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/split.md", split),
    ]),
    [],
  );
});

test("keeps hidden, destination, and block content out of rendered runs", () => {
  const body = [
    "# Page",
    "",
    "Claim [^open ![alt](image.png) more]",
    "",
    "Claim [^open `code` more]",
    "",
    "Claim [^open [link](https://example.test/a]b) tail",
    "",
    "<div>Trailing [^open</div>",
    "",
    "<div>closes]</div>",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(".atlas/insights/page.md", body),
    ]),
    [],
  );
});

test("bridges contiguous link labels but never hidden destinations", () => {
  const body = [
    "# Page",
    "",
    "Claim [^open [link](https://example.test/a) tail]",
    "",
    "Claim [^open [link](https://example.test/a]b) tail",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(".atlas/insights/page.md", body),
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 50, line: 17 },
          start: { column: 7, line: 17 },
        },
      },
    ],
  );
});

test("keeps hidden raw HTML syntax out of rendered marker boundaries", () => {
  const body = [
    "# Page",
    "",
    'Claim [^foo<span data-x="[">bar</span>] tail.',
    "",
    'Tail <span data-y="]">Claim [^outside] tail.',
    "",
    "Claim <!-- x -->[^defined] tail.",
    "",
    "Claim [^unclosed<!-- ] -->",
    "",
    "[^defined]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/page.md", body),
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML",
        location: {
          end: { column: 40, line: 17 },
          start: { column: 7, line: 17 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML_CONTEXT",
        location: {
          end: { column: 39, line: 19 },
          start: { column: 29, line: 19 },
        },
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML_CONTEXT",
        location: {
          end: { column: 27, line: 21 },
          start: { column: 17, line: 21 },
        },
      },
    ],
  );
});

test("fails closed for Citation markers in raw HTML element contexts", () => {
  const body = [
    "# Page",
    "",
    "<span hidden>Hidden.[^hidden]</span>",
    "",
    "<template>Template.[^template]</template>",
    "",
    '<span style="display: none">Styled.[^styled]</span>',
    "",
    "<span><em>Nested.[^nested]</span>",
    "",
    "<span>Unbalanced.[^unbalanced]",
    "",
    "<span>Claim [^[[.atlas/lore/parser-source|alias-context]]] tail.</span>",
    "",
    "[^hidden]: [[.atlas/lore/parser-source]]",
    "[^template]: [[.atlas/lore/parser-source]]",
    "[^styled]: [[.atlas/lore/parser-source]]",
    "[^nested]: [[.atlas/lore/parser-source]]",
    "[^unbalanced]: [[.atlas/lore/parser-source]]",
    "[^alias-context]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/raw-html-context.md", body),
    ]).map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML_CONTEXT",
        location: {
          end: { column: 30, line: 17 },
          start: { column: 21, line: 17 },
        },
        path: ".atlas/insights/raw-html-context.md",
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML_CONTEXT",
        location: {
          end: { column: 31, line: 19 },
          start: { column: 20, line: 19 },
        },
        path: ".atlas/insights/raw-html-context.md",
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML_CONTEXT",
        location: {
          end: { column: 45, line: 21 },
          start: { column: 36, line: 21 },
        },
        path: ".atlas/insights/raw-html-context.md",
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML_CONTEXT",
        location: {
          end: { column: 27, line: 23 },
          start: { column: 18, line: 23 },
        },
        path: ".atlas/insights/raw-html-context.md",
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML_CONTEXT",
        location: {
          end: { column: 31, line: 25 },
          start: { column: 18, line: 25 },
        },
        path: ".atlas/insights/raw-html-context.md",
      },
      {
        code: "ATLAS_CITATION_MARKER_IN_RAW_HTML_CONTEXT",
        location: {
          end: { column: 59, line: 27 },
          start: { column: 13, line: 27 },
        },
        path: ".atlas/insights/raw-html-context.md",
      },
    ],
  );
});

test("keeps raw HTML adjacent to Citations out of element context", () => {
  const body = [
    "# Page",
    "",
    "<span hidden></span>Claim.[^after]",
    "",
    "Claim.[^before]<template></template>",
    "",
    "Claim [[.atlas/lore/parser-source|<span hidden>alias</span>]] [^alias-adjacent]",
    "",
    "Claim <!-- x -->[^comment-adjacent]",
    "",
    "[^after]: [[.atlas/lore/parser-source]]",
    "[^before]: [[.atlas/lore/parser-source]]",
    "[^alias-adjacent]: [[.atlas/lore/parser-source]]",
    "[^comment-adjacent]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/raw-html-adjacent.md", body),
    ]),
    [],
  );
});

test("keeps raw HTML non-element syntax out of Citation identity", () => {
  const body = [
    "# Page",
    "",
    "<!-->",
    "<!--->",
    "<!-- ordinary comment -->",
    "<![CDATA[ordinary text]]>",
    "<?ordinary?>",
    "<!DOCTYPE ordinary>",
    "<br>",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      page(".atlas/insights/raw-html-syntax.md", body),
    ]),
    [],
  );
});

test("bridges hidden destination newlines but not rendered line breaks", () => {
  const body = [
    "# Page",
    "",
    "Claim [^op[en](https://example.test/",
    ' "title")id] tail.',
    "",
    "Claim [^br",
    "oken] tail.",
    "",
    'Claim [^cl[os](https://example.test/ "t")ed] tail.',
    "",
    "[^closed]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/page.md", body),
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 13, line: 18 },
          start: { column: 7, line: 17 },
        },
      },
    ],
  );
});

test("shares one Citation identity across character-reference labels", () => {
  const resolved = [
    "# Page",
    "",
    "Claim [*^caf&#233;*] and [*^&AElig;*] and [^caf&#233;] tail.",
    "",
    "[^caf&#233;]: [[.atlas/lore/parser-source]]",
    "[^&AElig;]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/resolved.md", resolved),
    ]),
    [],
  );

  const distinct = [
    "# Page",
    "",
    "Claim [*^cafe*] tail.",
    "",
    "[^caf&#233;]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/distinct.md", distinct),
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: {
          end: { column: 16, line: 17 },
          start: { column: 7, line: 17 },
        },
      },
    ],
  );

  const collided = [
    "# Page",
    "",
    "Claim [*^caf&#233;*] tail.",
    "",
    "[^caf&#233;]: [[.atlas/lore/parser-source]]",
    "[^café]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/collided.md", collided),
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_LABEL_AMBIGUOUS",
        location: {
          end: { column: 21, line: 17 },
          start: { column: 7, line: 17 },
        },
      },
    ],
  );
});

test("resolves parsed Citations by parser identity, not rendered label", () => {
  const distinguished = [
    "# Page",
    "",
    "Claim [^&Colon;] tail.",
    "",
    "[^&colon;]: prose only",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/distinguished.md", distinguished),
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MALFORMED",
        location: {
          end: { column: 23, line: 19 },
          start: { column: 1, line: 19 },
        },
      },
    ],
  );

  const ambiguous = [
    "# Page",
    "",
    "Claim [^café] tail.",
    "",
    "[^café]: [[.atlas/lore/parser-source]]",
    "[^caf&#233;]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/ambiguous.md", ambiguous),
    ]).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_LABEL_AMBIGUOUS",
        location: {
          end: { column: 14, line: 17 },
          start: { column: 7, line: 17 },
        },
      },
    ],
  );
});

test("maps split rendered Citation markers onto one parser identity", () => {
  const folds = [
    "# Page",
    "",
    "Claim [*^&#7838;*] and [*^ﬁ*] and [*^ς*] tail.",
    "",
    "[^ss]: [[.atlas/lore/parser-source]]",
    "[^fi]: [[.atlas/lore/parser-source]]",
    "[^σ]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/folds.md", folds),
    ]),
    [],
  );

  const single = [
    "# Page",
    "",
    "Claim [*^café*] tail.",
    "",
    "[^caf&#233;]: [[.atlas/lore/parser-source]]",
  ].join("\n");
  assert.deepEqual(
    validateRealmStructure([
      validFiles[2] as RealmTextFile,
      validFiles[4] as RealmTextFile,
      page(".atlas/insights/single.md", single),
    ]),
    [],
  );
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
