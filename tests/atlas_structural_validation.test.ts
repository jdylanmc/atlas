import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkFinding, FindingSchema, type Finding } from "../src/domain/finding.ts";
import type { AtlasTextFile } from "../src/atlas/load_atlas_text.ts";
import { validateAtlasStructure } from "../src/lint/validate_atlas_structure.ts";

const fixturesRoot = resolve(import.meta.dirname, "fixtures");

function fixture(root: string, path: string): AtlasTextFile {
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
): AtlasTextFile {
  const title = options.title ?? "Page";
  return Object.freeze({
    content: [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      "  local-atlas-schema: 1.0.0",
      `  id: ${options.id ?? "concept:page"}`,
      `  type: ${options.type ?? "concept"}`,
      `  title: ${title}`,
      '  created-at: "2026-08-17T00:00:00Z"',
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  created-by: { kind: agent, name: Fixture Agent }",
      "  updated-by: { kind: human, name: Fixture Reviewer }",
      "  tags: []",
      "atlas: {}",
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
  ".atlas/concepts/parsing.md",
  ".atlas/sources/parser-source.md",
].map((path) => fixture("atlas-pages", path));

const invalidFiles = [
  ".atlas/framework/README.md",
  ".atlas/index.md",
  ".atlas/concepts/second.md",
  ".atlas/sources/malformed.md",
  ".atlas/types/guide/page.md",
].map((path) => fixture("structural-validation", path));

test("parses and accepts the valid minimal Atlas itself", () => {
  assert.deepEqual(validateAtlasStructure(validFiles), []);
});

test("aggregates exact sanitized structural Findings", () => {
  const findings = validateAtlasStructure(invalidFiles);
  assert.deepEqual(
    findings.map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_PAGE_ID_DUPLICATE",
        location: {
          end: { column: 5, line: 5 },
          start: { column: 3, line: 5 },
        },
        path: ".atlas/concepts/second.md",
      },
      {
        code: "ATLAS_PAGE_ID_DUPLICATE",
        location: {
          end: { column: 5, line: 5 },
          start: { column: 3, line: 5 },
        },
        path: ".atlas/index.md",
      },
      {
        code: "ATLAS_ROOT_ANCHOR_ID_INVALID",
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
        code: "ATLAS_PAGE_MALFORMED_FRONTMATTER",
        location: {
          end: { column: 42, line: 2 },
          start: { column: 1, line: 2 },
        },
        path: ".atlas/sources/malformed.md",
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
    const findings = validateAtlasStructure([
      validFiles[2] as AtlasTextFile,
      page(".atlas/concepts/page.md", body),
    ]);
    assert.equal(
      findings.some(({ code }) => code === "ATLAS_PAGE_TITLE_H1_REQUIRED"),
      true,
      body,
    );
  }
  assert.deepEqual(
    validateAtlasStructure([
      validFiles[2] as AtlasTextFile,
      page(".atlas/concepts/page.md", "# **Pa**ge"),
    ]),
    [],
  );
});

test("reports an empty body at EOF without fabricating a location", () => {
  const emptyAtEof = page(".atlas/concepts/empty.md", "");
  const [finding] = validateAtlasStructure([
    validFiles[2] as AtlasTextFile,
    { ...emptyAtEof, content: emptyAtEof.content.slice(0, -1) },
  ]);
  assert.ok(finding);
  assert.equal(finding.code, "ATLAS_PAGE_TITLE_H1_REQUIRED");
  assert.equal(finding.location, undefined);
});

test("rejects Atlas SDK core archetype names in Atlas-owned custom paths", () => {
  const findings = validateAtlasStructure([
    validFiles[2] as AtlasTextFile,
    page(".atlas/types/concept/page.md", "# Page"),
  ]);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.ok(finding);
  assert.equal(finding.code, "ATLAS_CUSTOM_TYPE_NAME_RESERVED");
  assert.equal(finding.location, undefined);
});

test("uses YAML AST locations and never confuses atlas.id with atlas.id", () => {
  const root = Object.freeze({
    content: [
      "---",
      "atlas:",
      "  id: atlas-local",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      "  local-atlas-schema: 1.0.0",
      "  id: wrong:root",
      "  type: anchor",
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
  const idFinding = validateAtlasStructure([root]).find(
    ({ code }) => code === "ATLAS_ROOT_ANCHOR_ID_INVALID",
  );
  assert.deepEqual(idFinding?.location, {
    end: { column: 5, line: 7 },
    start: { column: 3, line: 7 },
  });

  const absent = page(".atlas/concepts/absent.md", "# Page").content.replace(
    "  type: concept\n",
    "",
  );
  const [schemaFinding] = validateAtlasStructure([
    validFiles[2] as AtlasTextFile,
    { content: absent, path: ".atlas/concepts/absent.md" },
  ]);
  assert.equal(schemaFinding?.code, "ATLAS_PAGE_INVALID_ENVELOPE");
  assert.equal(
    validateAtlasStructure([
      validFiles[2] as AtlasTextFile,
      { content: absent, path: ".atlas/concepts/absent.md" },
    ]).some(({ code }) => code === "ATLAS_PAGE_TYPE_PATH_MISMATCH"),
    false,
  );

  const flow = {
    content: [
      "---",
      'sdk: { atlas-sdk-schema: 1.0.0, local-atlas-schema: 1.0.0, id: wrong:root, type: concept, title: Root, created-at: "2026-08-17T00:00:00Z", updated-at: "2026-08-17T00:00:00Z", created-by: { kind: human, name: Author }, updated-by: { kind: human, name: Author }, tags: [] }',
      "atlas: {}",
      "---",
      "# Root",
    ].join("\n"),
    path: ".atlas/index.md",
  };
  const flowLocations = validateAtlasStructure([flow])
    .filter(({ code }) =>
      ["ATLAS_PAGE_TYPE_PATH_MISMATCH", "ATLAS_ROOT_ANCHOR_ID_INVALID"].includes(code),
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
    path: ".atlas/concepts/hostile.md",
  });
  const hostilePath = Object.freeze({
    content: "# ignored",
    get path(): string {
      throw new Error("secret hostile path");
    },
  });
  const hostileTypes = [
    { content: "# ignored", path: 42 },
    { content: 42, path: ".atlas/concepts/non-text.md" },
  ] as unknown as readonly AtlasTextFile[];
  const findings = validateAtlasStructure([
    validFiles[2] as AtlasTextFile,
    hostileContent,
    hostilePath,
    ...hostileTypes,
  ]);
  assert.deepEqual(
    findings.map(({ code, path }) => ({ code, path })),
    [
      { code: "ATLAS_PAGE_PARSE_FAILED", path: ".atlas/concepts/hostile.md" },
      { code: "ATLAS_PAGE_PARSE_FAILED", path: ".atlas/concepts/non-text.md" },
      { code: "ATLAS_PAGE_PARSE_FAILED", path: ".atlas/unknown" },
      { code: "ATLAS_PAGE_PARSE_FAILED", path: ".atlas/unknown" },
    ],
  );
  assert.equal(JSON.stringify(findings).includes("secret hostile"), false);
});

test("supports extensible attribution with severity as the only state", () => {
  const base = {
    code: "ATLAS_CHECK_EXAMPLE",
    "finding-schema": "1.0.0",
    message: "Atlas check result.",
    path: ".atlas/index.md",
  } as const;
  assert.equal(
    checkFinding({
      ...base,
      attribution: {
        checkId: "atlas.example",
        kind: "atlas-owned",
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
        checkId: "atlas.dependent",
        kind: "atlas-owned",
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
        checkId: "atlas.untrusted",
        kind: "atlas-owned",
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
        checkId: "atlas.dependent",
        kind: "atlas-owned",
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
  const forward = validateAtlasStructure(invalidFiles);
  assert.deepEqual(validateAtlasStructure(invalidFiles.toReversed()), forward);
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

test("preserves opaque Markdown and reports a missing Root Anchor", () => {
  const [finding] = validateAtlasStructure([invalidFiles[0] as AtlasTextFile]);
  assert.ok(finding);
  assert.equal(finding.code, "ATLAS_ROOT_ANCHOR_REQUIRED");
  assert.deepEqual(finding.attribution, {
    checkId: "sdk-core.structural-validation",
    kind: "sdk-core",
    trusted: true,
  });
});

const sourcePage = page(".atlas/sources/source.md", "# Source", {
  id: "source:source",
  title: "Source",
  type: "source",
});

function citing(body: string): readonly AtlasTextFile[] {
  return [
    validFiles[2] as AtlasTextFile,
    sourcePage,
    page(".atlas/concepts/cited.md", body),
  ];
}

test("resolves Citations through canonical parser footnote identity", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim.[^SS]\n\n[^ß]: [[.atlas/sources/source]] Note.\n"),
    ),
    [],
  );
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^Parser  Source]\n\n[^parser source]: [[.atlas/sources/source]]\n",
      ),
    ),
    [],
  );
});

test("handles high-cardinality valid Citation references deterministically", () => {
  const body = `# Page\n\n${"x[^a]".repeat(2000)}\n\n[^a]: [[.atlas/sources/source]]\n`;
  const files = citing(body);
  const first = validateAtlasStructure(files);
  assert.deepEqual(first, []);
  assert.deepEqual(validateAtlasStructure(files), first);
});

test("refuses a page carrying more Markdown markup than it reads", () => {
  // Reading one Citation marker costs more the more markers stand beside it, so
  // cardinality this far past what a page says is refused from a scan instead.
  const body = `# Page\n\n${"x[^a]".repeat(70_000)}\n\n[^a]: [[.atlas/sources/source]]\n`;
  const files = citing(body);
  const first = validateAtlasStructure(files);

  assert.deepEqual(
    first.map((found) => ({ code: found.code, path: found.path })),
    [{ code: "ATLAS_PAGE_BODY_TOO_MARKED", path: ".atlas/concepts/cited.md" }],
  );
  assert.deepEqual(validateAtlasStructure(files), first);
});

test("reports a visible literal Citation marker the parser left unresolved", () => {
  const findings = validateAtlasStructure(
    citing("# Page\n\nClaim.[^absent] and `[^absent]`.\n"),
  );
  assert.deepEqual(
    findings.map(({ code, location, message, path }) => ({
      code,
      location,
      message,
      path,
    })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 16, line: 17 }, start: { column: 7, line: 17 } },
        message:
          "Citation marker must resolve to a Citation definition in the same page.",
        path: ".atlas/concepts/cited.md",
      },
    ],
  );
  const [first] = findings;
  assert.ok(first);
  assert.deepEqual(first.attribution, {
    checkId: "sdk-core.structural-validation",
    kind: "sdk-core",
    trusted: true,
  });
  assert.equal(Object.isFrozen(first.location), true);
});

for (const [formatting, marker] of [
  ["emphasis", "[^a*b*c]"],
  ["strong", "[^a**b**c]"],
] as const) {
  test(`reports an exact missing Citation split by ${formatting}`, () => {
    assert.deepEqual(
      validateAtlasStructure(citing(`# Page\n\nClaim ${marker}.\n`)).map(
        ({ code, location }) => ({ code, location }),
      ),
      [
        {
          code: "ATLAS_CITATION_DEFINITION_MISSING",
          location: {
            end: { column: 7 + marker.length, line: 17 },
            start: { column: 7, line: 17 },
          },
        },
      ],
    );
  });
}

test("applies the parser label limit across formatting delimiters", () => {
  const within = `[^${"a".repeat(498)}*b*${"c".repeat(498)}]`;
  const over = `[^${"a".repeat(498)}*b*${"c".repeat(499)}]`;
  assert.deepEqual(
    validateAtlasStructure(citing(`# Page\n\n${within}\n${over}\n`)).map(
      ({ code, location }) => ({ code, location }),
    ),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 1_003, line: 17 }, start: { column: 1, line: 17 } },
      },
    ],
  );
});

test("lets the parser resolve formatting-split Citations and validates targets once", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nOne [^a*b*c], two [^d**e**f], three [^g***h***i].\n\n[^a*b*c]: [[.atlas/sources/source]]\n[^d**e**f]: [[.atlas/sources/source]]\n[^g***h***i]: [[.atlas/sources/source]]\n",
      ),
    ),
    [],
  );
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim [^a*b*c].\n\n[^a*b*c]: [[not-canonical]]\n"),
    ).map(({ code }) => code),
    ["ATLAS_CITATION_TARGET_INVALID"],
  );
});

test("reports multiple and nested formatting-split Citations exactly", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim [^a*b**c**d*e] and *[^f**g**h]*.\n"),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 21, line: 17 }, start: { column: 7, line: 17 } },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 37, line: 17 }, start: { column: 27, line: 17 } },
      },
    ],
  );
});

test("keeps visible formatting before an excluded link in normal prose", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\n**Claim [^a*b*c] then [link](https://example.test)**\n"),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 17, line: 17 }, start: { column: 9, line: 17 } },
      },
    ],
  );
});

test("keeps visible formatting before an excluded link in definition prose", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^outer]\n\n[^outer]: [[.atlas/sources/source]] *Claim [^a**b**c] then [link](https://example.test)*\n",
      ),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 54, line: 19 }, start: { column: 44, line: 19 } },
      },
    ],
  );
});

test("keeps visible formatting after an excluded link reference", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\n*[link][label] then [^a**b**c] claim*\n\n[label]: https://example.test\n",
      ),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 31, line: 17 }, start: { column: 21, line: 17 } },
      },
    ],
  );
});

test("validates parser-resolved Citations in partitioned formatting once", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\n**Claim [^a*b*c] then [link](https://example.test)**\n\n[^a*b*c]: [[.atlas/sources/source]]\n",
      ),
    ),
    [],
  );
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\n**Claim [^a*b*c] then [link](https://example.test)**\n\n[^a*b*c]: [[not-canonical]]\n",
      ),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_TARGET_INVALID",
        location: { end: { column: 28, line: 19 }, start: { column: 11, line: 19 } },
      },
    ],
  );
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^outer]\n\n[^outer]: [[.atlas/sources/source]] *Claim [^a**b**c] then [link](https://example.test)*\n\n[^a**b**c]: [[not-canonical]]\n",
      ),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_TARGET_INVALID",
        location: { end: { column: 30, line: 21 }, start: { column: 13, line: 21 } },
      },
    ],
  );
});

test("reports formatting-split Citations inside isolated link labels", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim [pre [^a*b*c] post](https://example.test) and [pre [^d**e**f] post][label].\n\n[label]: https://example.test\n",
      ),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 20, line: 17 }, start: { column: 12, line: 17 } },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 68, line: 17 }, start: { column: 58, line: 17 } },
      },
    ],
  );
});

test("reports formatting-split link-label Citations in definition prose", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^outer]\n\n[^outer]: [[.atlas/sources/source]] [pre [^a*b*c] post](https://example.test) and [pre [^d**e**f] post][label]\n\n[label]: https://example.test\n",
      ),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 50, line: 19 }, start: { column: 42, line: 19 } },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 98, line: 19 }, start: { column: 88, line: 19 } },
      },
    ],
  );
});

test("validates defined link-label Citations once through parser identity", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\n[see [^a*b*c]](https://example.test) and [read [^d**e**f]][label].\n\n[label]: https://example.test\n\n[^a*b*c]: [[.atlas/sources/source]]\n[^d**e**f]: [[not-canonical]]\n",
      ),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_TARGET_INVALID",
        location: { end: { column: 30, line: 22 }, start: { column: 13, line: 22 } },
      },
    ],
  );
});

test("does not bridge formatting-split Citations across excluded nodes or gaps", () => {
  for (const source of [
    "[^a`b`c]",
    "[^a<em>b</em>c]",
    "[^a<https://example.test>c]",
    "[^a*b`c`d*e]",
    "[^a*\n\t*b*c]",
  ]) {
    assert.deepEqual(
      validateAtlasStructure(citing(`# Page\n\n${source}\n`)),
      [],
      source,
    );
  }
});

test("keeps formatting-split Citation runs inside one prose container", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\n## Note [^h*i]\n\n- Item [^l*i]\n- Start [^x*\n- *y*z]\n"),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 15, line: 17 }, start: { column: 9, line: 17 } },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 14, line: 19 }, start: { column: 8, line: 19 } },
      },
    ],
  );
});

test("reports a formatting-split Citation in definition prose", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^outer]\n\n[^outer]: [[.atlas/sources/source]] see [^a*b*c]\n",
      ),
    ).map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 49, line: 19 }, start: { column: 41, line: 19 } },
      },
    ],
  );
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^outer]\n\n[^outer]: [[.atlas/sources/source]] see [^a*b*c]\n\n[^a*b*c]: [[.atlas/sources/source]]\n",
      ),
    ),
    [],
  );
});

test("uses parser Unicode identity for formatting-split Citations", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim.[^ß*x]\n\n[^SS*x]: [[.atlas/sources/source]]\n"),
    ),
    [],
  );
});

test("does not double-report Citations the parser resolved to a reference", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim.[^a] again.[^a]\n\n[^a]: [[.atlas/sources/source]]\n"),
    ),
    [],
  );
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim.[^a]\n\n[^a]: [[.atlas/sources/absent]]\n"),
    ).map(({ code }) => code),
    ["ATLAS_CITATION_TARGET_MISSING"],
  );
});

test("resolves literal Citation markers through canonical parser identity", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim.[^SS] and [^ß]\n\n[^ß]: [[.atlas/sources/source]]\n"),
    ),
    [],
  );
});

test("reports an unresolved Citation marker in Citation definition prose", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim.[^b]\n\n[^b]: [[.atlas/sources/source]] see [^a]\n"),
    ).map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 41, line: 19 }, start: { column: 37, line: 19 } },
        path: ".atlas/concepts/cited.md",
      },
    ],
  );
});

test("validates a resolved Citation call in Citation definition prose once", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^b]\n\n[^b]: [[.atlas/sources/source]] see [^a]\n\n[^a]: [[.atlas/sources/source]]\n",
      ),
    ),
    [],
  );
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^b]\n\n[^b]: [[.atlas/sources/source]] see [^a]\n\n[^a]: [[.atlas/sources/absent]]\n",
      ),
    ).map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_CITATION_TARGET_MISSING",
        location: { end: { column: 32, line: 21 }, start: { column: 7, line: 21 } },
        path: ".atlas/concepts/cited.md",
      },
    ],
  );
});

test("reports an unresolved Citation marker beside whitespace-shaped Markdown", () => {
  assert.deepEqual(
    validateAtlasStructure(citing("# Page\n\nClaim.[^note] end.\n")).map(
      ({ code, location, path }) => ({ code, location, path }),
    ),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 14, line: 17 }, start: { column: 7, line: 17 } },
        path: ".atlas/concepts/cited.md",
      },
    ],
  );
  /* A label carrying whitespace can never be a footnote Citation, so `[^a b]`
     with a Markdown definition is an ordinary link reference and definition
     outside the footnote-only Citation contract of this check. */
  assert.deepEqual(
    validateAtlasStructure(
      citing("# Page\n\nClaim.[^a b] end.\n\n[^a b]: https://example.test\n"),
    ),
    [],
  );
});

for (const [context, body] of [
  ["inline code", "Claim `[^a]` done."],
  ["a fenced code block", "```text\n[^a]\n```"],
  ["a link destination", "[external](https://example.test/[^a])"],
  ["an image destination", "![image](https://example.test/[^a])"],
  ["an autolink", "<https://example.test/[^a]>"],
  ["raw HTML", '<span data-source="[^a]">external</span>'],
  ["a Markdown definition", "[label]: https://example.test/[^a]"],
] as const) {
  test(`does not report a literal Citation marker in ${context}`, () => {
    assert.deepEqual(validateAtlasStructure(citing(`# Page\n\n${body}\n`)), []);
  });
}

for (const [shape, marker, width] of [
  ["an empty label", "[^]", 0],
  ["a space in the label", "[^a b]", 0],
  ["a nested bracket", "[^a[b]", 0],
  ["an unterminated label", "[^absent", 0],
  [`a 1000 character label`, `[^${"a".repeat(1000)}]`, 0],
  [`a 999 character label`, `[^${"a".repeat(999)}]`, 1002],
  ["an escaped marker", "\\[^a]", 0],
  ["an escaped closing bracket", "[^a\\]b]", 7],
  ["an escape of an unescapable character", "[^a\\!b]", 7],
] as const) {
  test(`treats ${shape} exactly as the parser does`, () => {
    const findings = validateAtlasStructure(citing(`# Page\n\nClaim.${marker} end.\n`));
    assert.deepEqual(
      findings.map(({ code, location }) => ({ code, location })),
      width === 0
        ? []
        : [
            {
              code: "ATLAS_CITATION_DEFINITION_MISSING",
              location: {
                end: { column: 7 + width, line: 17 },
                start: { column: 7, line: 17 },
              },
            },
          ],
      marker,
    );
  });
}

test("locates literal Citation markers exactly across one text node", () => {
  const findings = validateAtlasStructure(
    citing("# Page\n\nfirst [^one]\nsecond [^two] tail\n"),
  );
  assert.deepEqual(
    findings.map(({ code, location }) => ({ code, location })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 13, line: 17 }, start: { column: 7, line: 17 } },
      },
      {
        code: "ATLAS_CITATION_DEFINITION_MISSING",
        location: { end: { column: 14, line: 18 }, start: { column: 8, line: 18 } },
      },
    ],
  );
});

test("reports high-cardinality literal Citation markers deterministically", () => {
  const files = citing(`# Page\n\n${"x[^a]".repeat(2_000)}\n`);
  const first = validateAtlasStructure(files);
  assert.equal(first.length, 2_000);
  assert.deepEqual(first.at(-1)?.location, {
    end: { column: 10_001, line: 17 },
    start: { column: 9_997, line: 17 },
  });
  assert.deepEqual(validateAtlasStructure(files), first);
  assert.deepEqual(validateAtlasStructure(files.toReversed()), first);
});

test("reports high-cardinality formatting-split Citations deterministically", () => {
  const files = citing(`# Page\n\n${"x[^a*b*c]".repeat(1_000)}\n`);
  const first = validateAtlasStructure(files);
  assert.equal(first.length, 1_000);
  assert.deepEqual(first.at(-1)?.location, {
    end: { column: 9_001, line: 17 },
    start: { column: 8_993, line: 17 },
  });
  assert.deepEqual(validateAtlasStructure(files), first);
  assert.deepEqual(validateAtlasStructure(files.toReversed()), first);
});

test("reports duplicate Citation definitions at each definition", () => {
  const findings = validateAtlasStructure(
    citing(
      "# Page\n\nClaim.[^dup]\n\n[^dup]: [[.atlas/sources/source]]\n\n[^dup]: [[.atlas/sources/absent]]\n",
    ),
  );
  assert.deepEqual(
    findings.map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_CITATION_DEFINITION_DUPLICATE",
        location: { end: { column: 34, line: 19 }, start: { column: 1, line: 19 } },
        path: ".atlas/concepts/cited.md",
      },
      {
        code: "ATLAS_CITATION_DEFINITION_DUPLICATE",
        location: { end: { column: 34, line: 21 }, start: { column: 1, line: 21 } },
        path: ".atlas/concepts/cited.md",
      },
    ],
  );
});

test("requires exactly one direct Source target in a Citation definition", () => {
  for (const definition of [
    "[^a]:",
    "[^a]: Prose without any target.",
    "[^a]: [[.atlas/sources/source]] and [[.atlas/sources/source]]",
    "[^a]: [[.atlas/sources/source",
  ]) {
    const findings = validateAtlasStructure(
      citing(`# Page\n\nClaim.[^a]\n\n${definition}\n`),
    );
    assert.deepEqual(
      findings.map(({ code, path }) => ({ code, path })),
      [
        {
          code: "ATLAS_CITATION_DEFINITION_MALFORMED",
          path: ".atlas/concepts/cited.md",
        },
      ],
      definition,
    );
    assert.deepEqual(findings[0]?.location?.start, { column: 1, line: 19 });
  }
});

test("does not accept Citation targets owned by nested definitions", () => {
  for (const [definition, endColumn] of [
    ["[^outer]:\n    [^inner]: [[.atlas/sources/source]]", 40],
    ["[^outer]:\n    [inner]: [[.atlas/sources/source]]", 39],
  ] as const) {
    const findings = validateAtlasStructure(
      citing(`# Page\n\nClaim.[^outer]\n\n${definition}\n`),
    );
    assert.deepEqual(
      findings.map(({ code, location, path }) => ({ code, location, path })),
      [
        {
          code: "ATLAS_CITATION_DEFINITION_MALFORMED",
          location: {
            end: { column: endColumn, line: 20 },
            start: { column: 1, line: 19 },
          },
          path: ".atlas/concepts/cited.md",
        },
      ],
      definition,
    );
  }
});

for (const [context, definition] of [
  [
    "an external link destination",
    "[^a]: [external](https://example.test/[[.atlas/sources/source]])",
  ],
  ["inline code", "[^a]: `[[.atlas/sources/source]]`"],
  ["a fenced code block", "[^a]:\n    ```text\n    [[.atlas/sources/source]]\n    ```"],
  [
    "an image destination",
    "[^a]: ![image](https://example.test/[[.atlas/sources/source]])",
  ],
  ["an autolink", "[^a]: <https://example.test/[[.atlas/sources/source]]>"],
  ["raw HTML", '[^a]: <span data-source="[[.atlas/sources/source]]">external</span>'],
] as const) {
  test(`does not accept a Citation target from ${context}`, () => {
    const findings = validateAtlasStructure(
      citing(`# Page\n\nClaim.[^a]\n\n${definition}\n`),
    );
    assert.deepEqual(
      findings.map(({ code, path }) => ({ code, path })),
      [
        {
          code: "ATLAS_CITATION_DEFINITION_MALFORMED",
          path: ".atlas/concepts/cited.md",
        },
      ],
    );
  });
}

test("accepts a direct visible Citation target in ordinary definition prose", () => {
  assert.deepEqual(
    validateAtlasStructure(
      citing(
        "# Page\n\nClaim.[^a]\n\n[^a]: Evidence [[.atlas/sources/source]] [external](https://example.test/[[.atlas/sources/source]]) and `[[.atlas/sources/source]]`.\n",
      ),
    ),
    [],
  );
});

test("rejects malformed or unterminated wiki markers in Citation definitions", () => {
  for (const definition of [
    "[^a]: [[.atlas/sources/source]] [[unterminated",
    "[^a]: [[unterminated [[.atlas/sources/source]]",
  ]) {
    const findings = validateAtlasStructure(
      citing(`# Page\n\nClaim.[^a]\n\n${definition}\n`),
    );
    assert.deepEqual(
      findings.map(({ code, location, path }) => ({ code, location, path })),
      [
        {
          code: "ATLAS_CITATION_DEFINITION_MALFORMED",
          location: {
            end: { column: 47, line: 19 },
            start: { column: 1, line: 19 },
          },
          path: ".atlas/concepts/cited.md",
        },
      ],
      definition,
    );
  }
});

test("requires an exact canonical Atlas-local Source Citation target", () => {
  for (const [target, code] of [
    ["[[.atlas/sources/source#api]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas/sources/source|Source]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas/sources/source.md]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas/sources/../source/source]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas/./source/source]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas/sources/source/]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[/.atlas/sources/source]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas\\source\\source]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas/sources/so urce]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas]]", "ATLAS_CITATION_TARGET_INVALID"],
    ["[[.atlas/concepts/other]]", "ATLAS_CITATION_TARGET_NOT_SOURCE"],
    ["[[.atlas/sources/absent]]", "ATLAS_CITATION_TARGET_MISSING"],
  ] as const) {
    const findings = validateAtlasStructure(
      citing(`# Page\n\nClaim.[^a]\n\n[^a]: ${target}\n`),
    );
    assert.deepEqual(
      findings.map(({ code, location, path }) => ({ code, location, path })),
      [
        {
          code,
          location: {
            end: { column: 7 + target.length, line: 19 },
            start: { column: 7, line: 19 },
          },
          path: ".atlas/concepts/cited.md",
        },
      ],
      target,
    );
  }
});

test("orders Citation Findings deterministically with exact locations", () => {
  const files = citing(
    [
      "# Page",
      "",
      "First.[^one] Second.[^two] Third.[^three]",
      "",
      "[^one]: prose",
      "    [[.atlas/sources/absent]]",
      "",
      "[^two]: [[.atlas/concepts/other]]",
      "",
      "[^three]: [[.atlas/sources/source]]",
      "",
    ].join("\n"),
  );
  const forward = validateAtlasStructure(files);
  assert.deepEqual(
    forward.map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_CITATION_TARGET_MISSING",
        location: { end: { column: 30, line: 20 }, start: { column: 5, line: 20 } },
        path: ".atlas/concepts/cited.md",
      },
      {
        code: "ATLAS_CITATION_TARGET_NOT_SOURCE",
        location: { end: { column: 34, line: 22 }, start: { column: 9, line: 22 } },
        path: ".atlas/concepts/cited.md",
      },
    ],
  );
  assert.deepEqual(validateAtlasStructure(files.toReversed()), forward);
  assert.deepEqual(validateAtlasStructure(files), forward);
  assert.equal(Object.isFrozen(forward[0]?.location?.start), true);
});
