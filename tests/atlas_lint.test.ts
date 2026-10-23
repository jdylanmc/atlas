import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkFinding, type Finding } from "../src/domain/finding.ts";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import { maxFrontmatterDepth } from "../src/atlas/parse_atlas_pages.ts";
import type { ProseLinter } from "../src/lint/prose_lint.ts";
import {
  deniesAtlasValidity,
  lintAtlas,
  type AtlasLintResult,
} from "../src/lint/lint_atlas.ts";
import { assertGrowthRatio, assertWallClockUnder } from "./growth.ts";
import {
  passingProseLinter,
  proseStyleCapturedFiles,
  recordingProseLinter,
  withProseStyle,
} from "./prose_lint_fixtures.ts";

import { googleValeStyleFiles } from "../src/lint/google_vale_style.ts";

const encoder = new TextEncoder();
const fixturesRoot = resolve(import.meta.dirname, "fixtures", "complete-atlas");
const decoder = new TextDecoder();
const opaquePaths = [
  ".atlas/.vale.ini",
  ".atlas/CHANGELOG.md",
  ".atlas/manifest.json",
  ".atlas/vale/styles/AtlasSDK/PageLength.yml",
  ...googleValeStyleFiles.map(([name]) => `.atlas/vale/styles/Google/${name}`).sort(),
];

// Captured in an order no canonical result may depend on: opaque records first,
// pages neither in code point order nor in directory order.
const atlasPaths = [
  ".atlas/manifest.json",
  ".atlas/CHANGELOG.md",
  ".atlas/sources/atlas-sdk-lint.md",
  ".atlas/index.md",
  ".atlas/edges/lint-covers-canonical-serialization.md",
  ".atlas/principles/determinism.md",
  ".atlas/concepts/canonical-serialization.md",
  ".atlas/anchors/lint.md",
] as const;

const canonicalPagePaths = [
  ".atlas/anchors/lint.md",
  ".atlas/concepts/canonical-serialization.md",
  ".atlas/edges/lint-covers-canonical-serialization.md",
  ".atlas/index.md",
  ".atlas/principles/determinism.md",
  ".atlas/sources/atlas-sdk-lint.md",
] as const;

const structuralAttribution = Object.freeze({
  checkId: "sdk-core.structural-validation",
  kind: "sdk-core",
  trusted: true,
});

// Each defect is one named substitution into the valid Atlas, so the two
// variants cannot drift apart: the invalid Atlas is the valid one plus exactly
// these three structural defects, and nothing else can differ.
const defects: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  ".atlas/concepts/canonical-serialization.md": [
    "# Canonical Serialization",
    "# Canonical Bytes",
  ],
  ".atlas/edges/lint-covers-canonical-serialization.md": [
    "[[.atlas/sources/atlas-sdk-lint]]",
    "[[.atlas/concepts/canonical-serialization]]",
  ],
  ".atlas/principles/determinism.md": ["  type: principle", "  type: concept"],
});

function fixtureText(path: string): string {
  return readFileSync(resolve(fixturesRoot, path), "utf8");
}

function fixtureBytes(variant: "invalid" | "valid", path: string): Uint8Array {
  const text = fixtureText(path);
  const defect = variant === "invalid" ? defects[path] : undefined;
  if (defect === undefined) return encoder.encode(text);
  const [before, after] = defect;
  assert.equal(text.includes(before), true, `${path} no longer holds ${before}`);
  return encoder.encode(text.replace(before, after));
}

function completeAtlas(variant: "invalid" | "valid"): CapturedAtlasFile[] {
  return [
    ...withProseStyle(
      atlasPaths.map((path) => ({ bytes: fixtureBytes(variant, path), path })),
    ),
  ];
}

// The nested key sits two columns in and its own line counts as one level, so
// the deepest nesting the bound still reads is three levels below the bound.
const insideBoundDepth = maxFrontmatterDepth - 3;

// One Atlas-owned key nests as deeply as asked, in flow style so the nesting
// costs bytes rather than columns: byte counts alone cannot bound it.
function deepAtlas(depth: number): CapturedAtlasFile[] {
  const nested = `${"[".repeat(depth)}${"]".repeat(depth)}`;
  const page = fixtureText(".atlas/concepts/canonical-serialization.md").replace(
    "  confidence: reviewed",
    `  confidence: reviewed\n  deep: ${nested}`,
  );
  return completeAtlas("valid").map((file) =>
    file.path === ".atlas/concepts/canonical-serialization.md"
      ? { bytes: encoder.encode(page), path: file.path }
      : file,
  );
}

function lintedPages(result: AtlasLintResult): readonly CapturedAtlasFile[] {
  assert.ok(result.outcome === "valid", JSON.stringify(result));
  return result.pages.map((page) => ({
    bytes: encoder.encode(page.content),
    path: page.path,
  }));
}

test("lints the complete valid Atlas to canonical byte-identical pages", () => {
  const result = lintAtlas(completeAtlas("valid"), passingProseLinter);

  assert.ok(result.outcome === "valid", JSON.stringify(result));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    result.pages.map((page) => page.path),
    canonicalPagePaths,
  );
  for (const page of result.pages) {
    assert.deepEqual(
      encoder.encode(page.content),
      fixtureBytes("valid", page.path),
      page.path,
    );
  }

  // Records Lint reads as text rather than as pages are carried, not dropped:
  // they have no page envelope to normalize, and a caller writing back only
  // `pages` would otherwise delete the Changelog and the Atlas Manifest.
  assert.deepEqual(
    result.opaque.map((record) => record.path),
    opaquePaths,
  );
  const captured = new Map(
    completeAtlas("valid").map((file) => [file.path, decoder.decode(file.bytes)]),
  );
  for (const record of result.opaque) {
    assert.equal(record.content, captured.get(record.path), record.path);
  }
  assert.deepEqual(
    result.pages.filter((page) => opaquePaths.some((path) => path === page.path)),
    [],
  );
});

test("returns stable Findings without partial or success-shaped output", () => {
  const result = lintAtlas(completeAtlas("invalid"), passingProseLinter);

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.equal("pages" in result, false);
  assert.deepEqual(result.findings, [
    {
      attribution: structuralAttribution,
      code: "ATLAS_PAGE_TITLE_H1_MISMATCH",
      "finding-schema": "1.0.0",
      location: { end: { column: 18, line: 25 }, start: { column: 1, line: 25 } },
      message: "The first Markdown H1 must exactly match the page title.",
      path: ".atlas/concepts/canonical-serialization.md",
      severity: "error",
    },
    {
      attribution: structuralAttribution,
      code: "ATLAS_CITATION_TARGET_NOT_SOURCE",
      "finding-schema": "1.0.0",
      location: { end: { column: 57, line: 29 }, start: { column: 14, line: 29 } },
      message: "Citation target must address an Atlas Source page.",
      path: ".atlas/edges/lint-covers-canonical-serialization.md",
      severity: "error",
    },
    {
      attribution: structuralAttribution,
      code: "ATLAS_PAGE_TYPE_PATH_MISMATCH",
      "finding-schema": "1.0.0",
      location: { end: { column: 7, line: 12 }, start: { column: 3, line: 12 } },
      message: "Atlas page type does not match its registered path.",
      path: ".atlas/principles/determinism.md",
      severity: "error",
    },
  ]);
  for (const finding of result.findings) assert.equal(checkFinding(finding), true);
});

test("reports a whole-Atlas loading failure without serializing any page", () => {
  const atlas = completeAtlas("valid");
  const linter = recordingProseLinter();
  const result = lintAtlas([...atlas, atlas[0] as CapturedAtlasFile], linter);

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.equal("pages" in result, false);
  assert.deepEqual(
    result.findings.map(({ attribution, code, path }) => ({
      attribution,
      code,
      path,
    })),
    [
      {
        attribution: {
          checkId: "sdk-core.atlas-input",
          kind: "sdk-core",
          trusted: true,
        },
        code: "ATLAS_LOAD_DUPLICATE_PATH",
        path: ".atlas",
      },
    ],
  );
  // An Atlas that did not load has no text for its prose rules to read.
  assert.equal(linter.requests.length, 0);
});

test("produces identical ordered Findings and canonical pages across runs", () => {
  for (const variant of ["invalid", "valid"] as const) {
    const first = lintAtlas(completeAtlas(variant), passingProseLinter);
    assert.deepEqual(lintAtlas(completeAtlas(variant), passingProseLinter), first);
    // Capture order carries no meaning, so reversing it changes nothing.
    assert.deepEqual(
      lintAtlas(completeAtlas(variant).toReversed(), passingProseLinter),
      first,
    );
  }
});

test("lints its own canonical pages to the same canonical bytes", () => {
  const pages = lintedPages(lintAtlas(completeAtlas("valid"), passingProseLinter));
  const relinted = lintAtlas(withProseStyle(pages).toReversed(), passingProseLinter);

  assert.deepEqual(lintedPages(relinted), pages);
});

test("decides one whole-Atlas Lint from one reading of every input", () => {
  const honest = lintAtlas(completeAtlas("valid"), passingProseLinter);

  // Each captured file answers honestly once and sabotages every later read,
  // so a second reading of any caller-owned value changes the result.
  const hostileFiles = completeAtlas("valid").map((file) => {
    let bytesRead = false;
    let pathRead = false;
    return {
      get bytes(): Uint8Array {
        const answer = bytesRead ? encoder.encode("---\n") : file.bytes;
        bytesRead = true;
        return answer;
      },
      get path(): string {
        const answer = pathRead ? ".atlas/concepts/sabotage.md" : file.path;
        pathRead = true;
        return answer;
      },
    };
  });
  assert.deepEqual(lintAtlas(hostileFiles, passingProseLinter), honest);
});

test("decides the Lint from one loading of the captured bytes", () => {
  const honest = lintAtlas(completeAtlas("valid"), passingProseLinter);

  // The captured bytes are overwritten while the prose rules run, after
  // loading, so any later stage that read them again would decide a
  // different Atlas from the same captured input.
  const atlas = completeAtlas("valid");
  const sabotage: ProseLinter = {
    lint() {
      for (const file of atlas) file.bytes.fill(0x20);
      return { findings: [], state: "completed" };
    },
  };

  assert.deepEqual(lintAtlas(atlas, sabotage), honest);
  assert.equal(
    atlas.every((file) => file.bytes.every((byte) => byte === 0x20)),
    true,
  );
});

test("returns a deeply frozen result", () => {
  const valid = lintAtlas(completeAtlas("valid"), passingProseLinter);
  assert.ok(valid.outcome === "valid", JSON.stringify(valid));
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(Object.isFrozen(valid.pages), true);
  assert.equal(Object.isFrozen(valid.pages[0]), true);

  const invalid = lintAtlas(completeAtlas("invalid"), passingProseLinter);
  assert.ok(invalid.outcome === "invalid", JSON.stringify(invalid));
  assert.equal(Object.isFrozen(invalid), true);
  assert.equal(Object.isFrozen(invalid.findings), true);
  assert.equal(Object.isFrozen(invalid.findings[0]), true);
});

test("refuses frontmatter nesting deeper than it reads, on every run", () => {
  const first = lintAtlas(deepAtlas(maxFrontmatterDepth + 1), passingProseLinter);

  assert.ok(first.outcome === "invalid", JSON.stringify(first));
  assert.equal("pages" in first, false);
  assert.deepEqual(first.findings, [
    {
      attribution: structuralAttribution,
      code: "ATLAS_PAGE_FRONTMATTER_TOO_DEEP",
      "finding-schema": "1.0.0",
      location: { end: { column: 5, line: 2 }, start: { column: 1, line: 2 } },
      message: "Atlas page frontmatter nests deeper than Atlas SDK reads.",
      path: ".atlas/concepts/canonical-serialization.md",
      severity: "error",
    },
  ]);
  for (const finding of first.findings) assert.equal(checkFinding(finding), true);

  // Nesting just inside the bound is read, and both answers hold across runs.
  const inside = lintAtlas(deepAtlas(insideBoundDepth), passingProseLinter);
  assert.ok(inside.outcome === "valid", JSON.stringify(inside));
  for (let run = 0; run < 10; run += 1) {
    assert.deepEqual(
      lintAtlas(deepAtlas(maxFrontmatterDepth + 1), passingProseLinter),
      first,
    );
    assert.deepEqual(
      lintAtlas(deepAtlas(insideBoundDepth), passingProseLinter),
      inside,
    );
  }
});

test("answers every nesting depth with a verdict rather than an exception", () => {
  // Nesting deep enough to exhaust the stack of the process must still earn a
  // Finding: an escaping exception is a crashed caller rather than a verdict.
  const depths = [1, 2, 8, insideBoundDepth, maxFrontmatterDepth, 500, 5000];
  for (let run = 0; run < 10; run += 1) {
    for (const depth of depths) {
      const result = lintAtlas(deepAtlas(depth), passingProseLinter);
      assert.equal(
        result.outcome,
        depth <= insideBoundDepth ? "valid" : "invalid",
        `depth ${String(depth)}`,
      );
    }
  }
});

test("refuses a body nesting deeper than it reads, without reading it", () => {
  const body = `${"> ".repeat(200)}quoted`;
  const atlas = completeAtlas("valid").map((file) =>
    file.path === ".atlas/anchors/lint.md"
      ? {
          bytes: encoder.encode(`${fixtureText(file.path)}\n${body}\n`),
          path: file.path,
        }
      : file,
  );

  const result = lintAtlas(atlas, passingProseLinter);

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.deepEqual(
    result.findings.map(({ code, path }) => ({ code, path })),
    [{ code: "ATLAS_PAGE_BODY_TOO_DEEP", path: ".atlas/anchors/lint.md" }],
  );
  for (const finding of result.findings) assert.equal(checkFinding(finding), true);
});

test("reads every large pathological body in bounded time", () => {
  // Nesting multiplies what each Markdown block costs, and blocks and emphasis
  // marks each cost more the more of them a body carries, so any of these
  // bodies could otherwise take hours rather than the bytes they hold.
  const megabyte = 1024 * 1024;
  const fill = (line: string): string => line.repeat(Math.ceil(megabyte / line.length));
  const bodies: Readonly<Record<string, string>> = {
    ATLAS_PAGE_BODY_TOO_DEEP: fill(`${"> ".repeat(2000)}quoted\n`),
    ATLAS_PAGE_BODY_TOO_MARKED: fill("- item\n"),
  };

  for (const [code, body] of Object.entries(bodies)) {
    const atlas = completeAtlas("valid").map((file) =>
      file.path === ".atlas/anchors/lint.md"
        ? {
            bytes: encoder.encode(`${fixtureText(file.path)}\n${body}`),
            path: file.path,
          }
        : file,
    );

    let result: AtlasLintResult | undefined;
    assertWallClockUnder(`linting ${code}`, 2000, () => {
      result = lintAtlas(atlas, passingProseLinter);
    });

    assert.ok(result !== undefined);
    assert.ok(result.outcome === "invalid", JSON.stringify(result));
    assert.deepEqual(
      result.findings.map((finding) => finding.code),
      [code],
    );
  }
});

test("refuses every shape of Markdown that costs more than its bytes", () => {
  // Each of these was measured taking seconds to minutes, and hours at
  // larger sizes.
  const megabyte = 1024 * 1024;
  const shapes: Readonly<Record<string, string>> = {
    "nested brackets": `${"[".repeat(megabyte)}x`,
    "flat brackets": "[x]".repeat(megabyte / 3),
    "emphasis marks": "*a".repeat(megabyte / 2),
    "underscore marks": "_a".repeat(megabyte / 2),
    "one nested list line": `${"- ".repeat(megabyte / 2)}x`,
    "many nested list lines": `${"- ".repeat(200)}x\n`.repeat(megabyte / 400),
    "one quoted line": ">".repeat(megabyte),
    "many quoted lines": `${">".repeat(60)} x\n`.repeat(megabyte / 62),
    "many list items": "- x\n".repeat(megabyte / 4),
    "deep indentation": `${"  ".repeat(megabyte / 2)}x`,
    "many footnotes": "[^a]: x\n".repeat(megabyte / 8),
    "setext headings": "x\n===\n".repeat(megabyte / 6),
    "table pipes": "|x|\n".repeat(megabyte / 4),
    "carriage returns": "x\r\n".repeat(megabyte / 3),
    "many headings": "# x\n".repeat(megabyte / 4),
    "raw markup lines": "<a>\n".repeat(megabyte / 4),
    "blank lines": "\n".repeat(megabyte),
    "character references": "&amp;".repeat(megabyte / 5),
    autolinks: "<http://a.b>".repeat(megabyte / 12),
    "raw markup": '<a b="c">'.repeat(megabyte / 9),
    escapes: "\\[".repeat(megabyte / 2),
  };
  const refused = new Set([
    "ATLAS_PAGE_BODY_TOO_DEEP",
    "ATLAS_PAGE_BODY_TOO_LONG",
    "ATLAS_PAGE_BODY_TOO_MARKED",
  ]);

  for (const [shape, body] of Object.entries(shapes)) {
    const atlas = completeAtlas("valid").map((file) =>
      file.path === ".atlas/anchors/lint.md"
        ? {
            bytes: encoder.encode(`${fixtureText(file.path)}\n${body}\n`),
            path: file.path,
          }
        : file,
    );

    let result: AtlasLintResult | undefined;
    assertWallClockUnder(`linting ${shape}`, 2000, () => {
      result = lintAtlas(atlas, passingProseLinter);
    });

    assert.ok(result !== undefined);
    assert.ok(result.outcome === "invalid", `${shape}: ${JSON.stringify(result)}`);
    const [reported] = result.findings.map((finding) => finding.code);
    assert.ok(
      reported !== undefined && refused.has(reported),
      `${shape}: ${String(reported)}`,
    );
  }
});

test("applies the markup gate when a caller admits the high-delimiter page", () => {
  const path = ".atlas/anchors/lint.md";
  const original = fixtureText(path);
  const frontmatterEnd = original.lastIndexOf("\n---\n") + "\n---\n".length;
  const highDelimiterPage = `${original.slice(0, frontmatterEnd)}\n# Lint\n\n${"x*\n".repeat(8191)}`;
  const atlas = completeAtlas("valid").map((file) =>
    file.path === path
      ? { bytes: encoder.encode(highDelimiterPage), path: file.path }
      : file,
  );

  const result = lintAtlas(atlas, passingProseLinter);

  assert.equal(result.outcome, "invalid");
  assert.deepEqual(
    result.findings.map(({ code, path: findingPath }) => ({
      code,
      path: findingPath,
    })),
    [{ code: "ATLAS_PAGE_BODY_TOO_MARKED", path }],
  );
});

test("refuses frontmatter larger than it reads, and reads plain prose whole", () => {
  const megabyte = 1024 * 1024;
  const heavy = `{${Array.from({ length: megabyte / 8 }, (_, index) => `k${String(index)}: 1`).join(",")}}`;
  const oversized = completeAtlas("valid").map((file) =>
    file.path === ".atlas/anchors/lint.md"
      ? {
          bytes: encoder.encode(
            fixtureText(file.path).replace("atlas: {}", `atlas: {}\nheavy: ${heavy}`),
          ),
          path: file.path,
        }
      : file,
  );

  let result: AtlasLintResult | undefined;
  assertWallClockUnder("linting oversized frontmatter", 2000, () => {
    result = lintAtlas(oversized, passingProseLinter);
  });

  assert.ok(result !== undefined);
  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    ["ATLAS_PAGE_FRONTMATTER_TOO_LARGE"],
  );

  // Prose carries no markup, so a page holding a megabyte of it is still read,
  // however its lines end.
  const prose = `${"word ".repeat(16)}\r\n`.repeat(megabyte / 81);
  const large = completeAtlas("valid").map((file) =>
    file.path === ".atlas/anchors/lint.md"
      ? {
          bytes: encoder.encode(`${fixtureText(file.path)}\n${prose}`),
          path: file.path,
        }
      : file,
  );

  assert.equal(lintAtlas(large, passingProseLinter).outcome, "valid");
});

// A body twice the size should stay below the empirical 2.5x doubling bound.
// This ratio guard survives a slower machine, where a fixed millisecond budget
// would only report the machine.
function lintBody(body: string): void {
  const atlas = completeAtlas("valid").map((file) =>
    file.path === ".atlas/anchors/lint.md"
      ? {
          bytes: encoder.encode(`${fixtureText(file.path)}\n${body}\n`),
          path: file.path,
        }
      : file,
  );
  lintAtlas(atlas, passingProseLinter);
}

test("keeps doubling cost below 2.5x as Atlas body bytes double", () => {
  // Each shape was measured exceeding this bound before it was capped, so each
  // is read at one size and at twice that size and the two costs compared.
  const shapes: Readonly<Record<string, (count: number) => string>> = {
    "character references": (count) => "&amp;".repeat(count),
    "emphasis marks": (count) => "*a".repeat(count),
    "list items": (count) => "- x\n".repeat(count),
    "setext headings after a carriage return": (count) => "x\r=\r".repeat(count),
    "table pipes": (count) => "|x|\n".repeat(count),
  };

  for (const [shape, make] of Object.entries(shapes)) {
    const count = 64 * 1024;
    assertGrowthRatio({
      large: () => lintBody(make(count * 2)),
      name: `refusing ${shape}`,
      small: () => lintBody(make(count)),
    });
  }

  // Prose is read rather than refused, so the accepted path is measured too,
  // below every declared bound at both sizes.
  const prose = (count: number): string => `${"word ".repeat(16)}\n`.repeat(count);
  assertGrowthRatio({
    large: () => lintBody(prose(16384)),
    name: "reading prose",
    small: () => lintBody(prose(8192)),
  });
});

const lineTerminatorMessage =
  "Atlas file contains a non-canonical line terminator: a carriage return without a following line feed, or a Unicode line or paragraph separator. Use LF or CRLF line endings.";

function replaceIn(
  atlas: readonly CapturedAtlasFile[],
  path: string,
  before: string,
  after: string,
): CapturedAtlasFile[] {
  return atlas.map((file) => {
    if (file.path !== path) return file;
    const text = fixtureText(path);
    assert.equal(text.includes(before), true, `${path} no longer holds ${before}`);
    return { bytes: encoder.encode(text.replace(before, after)), path };
  });
}

function lineTerminatorFinding(path: string, line: number, column: number): Finding {
  return {
    attribution: {
      checkId: "sdk-core.atlas-input",
      kind: "sdk-core",
      trusted: true,
    },
    code: "ATLAS_LOAD_NON_CANONICAL_LINE_TERMINATOR",
    "finding-schema": "1.0.0",
    location: { end: { column: column + 1, line }, start: { column, line } },
    message: lineTerminatorMessage,
    path,
    severity: "error",
  };
}

test("rejects non-canonical line terminators before readers can disagree", () => {
  const atlas = replaceIn(
    completeAtlas("valid"),
    ".atlas/concepts/canonical-serialization.md",
    "sdk:\n",
    "sdk:\n  # note\r---\r\n",
  );
  const linter = recordingProseLinter();

  const result = lintAtlas(atlas, linter);

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.deepEqual(result.findings, [
    lineTerminatorFinding(".atlas/concepts/canonical-serialization.md", 3, 9),
  ]);
  for (const finding of result.findings) assert.equal(checkFinding(finding), true);
  assert.equal(linter.requests.length, 0);
});

test("locates a non-canonical line terminator in every file that carries one", () => {
  const atlas = replaceIn(
    replaceIn(
      completeAtlas("valid"),
      ".atlas/concepts/canonical-serialization.md",
      "sdk:\n",
      "sdk:\n  # note\r---\r\n",
    ),
    ".atlas/anchors/lint.md",
    "  id: anchor:lint\n",
    "  id: anchor:lint\u2029\u2028\n",
  );

  const result = lintAtlas(atlas, passingProseLinter);

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.deepEqual(result.findings, [
    lineTerminatorFinding(".atlas/anchors/lint.md", 8, 18),
    lineTerminatorFinding(".atlas/concepts/canonical-serialization.md", 3, 9),
  ]);
});

const proseAttribution = Object.freeze({
  checkId: "vale.AtlasSDK.PageLength",
  kind: "atlas-owned",
  trusted: false,
});

function valeFinding(severity: Finding["severity"], path: string): Finding {
  return Object.freeze({
    attribution: proseAttribution,
    code: "VALE_ATLASSDK_PAGELENGTH",
    "finding-schema": "1.0.0",
    location: Object.freeze({
      end: Object.freeze({ column: 2, line: 1 }),
      start: Object.freeze({ column: 1, line: 1 }),
    }),
    message:
      "Page prose runs to 1001 words. Split it into an overview page and child pages.",
    path,
    severity,
  });
}

test("fails Lint without running prose rules when the Vale configuration is missing", () => {
  const linter = recordingProseLinter();
  const atlas = completeAtlas("valid").filter(
    (file) => file.path !== ".atlas/.vale.ini",
  );

  const result = lintAtlas(atlas, linter);

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.deepEqual(result.findings, [
    {
      attribution: {
        checkId: "sdk-core.prose-lint",
        kind: "sdk-core",
        trusted: true,
      },
      code: "ATLAS_VALE_CONFIG_MISSING",
      "finding-schema": "1.0.0",
      message:
        "Every Atlas must carry its Vale configuration at .atlas/.vale.ini; restore the Atlas SDK default prose style or the Atlas's own.",
      path: ".atlas/.vale.ini",
      severity: "error",
    },
  ]);
  for (const finding of result.findings) assert.equal(checkFinding(finding), true);
  assert.equal(linter.requests.length, 0);
});

test("hands the prose linter every loaded file and only the sorted page paths", () => {
  const linter = recordingProseLinter();

  const result = lintAtlas(completeAtlas("valid"), linter);

  assert.equal(result.outcome, "valid");
  assert.equal(linter.requests.length, 1);
  const [request] = linter.requests;
  assert.ok(request !== undefined);
  assert.deepEqual(request.pagePaths, canonicalPagePaths);
  assert.deepEqual(
    request.files.map((file) => file.path).toSorted(),
    [...atlasPaths, ...proseStyleCapturedFiles().map((file) => file.path)].toSorted(),
  );
  for (const file of request.files) {
    const captured = completeAtlas("valid").find(
      (candidate) => candidate.path === file.path,
    );
    assert.ok(captured !== undefined, file.path);
    assert.equal(file.content, decoder.decode(captured.bytes), file.path);
  }
});

test("denies validity for an error-level Vale alert, not a warning", () => {
  const path = ".atlas/index.md";
  const error = lintAtlas(
    completeAtlas("valid"),
    recordingProseLinter({
      findings: [valeFinding("error", path)],
      state: "completed",
    }),
  );
  assert.ok(error.outcome === "invalid", JSON.stringify(error));
  assert.equal("pages" in error, false);
  assert.deepEqual(error.findings, [valeFinding("error", path)]);

  const warning = lintAtlas(
    completeAtlas("valid"),
    recordingProseLinter({
      findings: [valeFinding("warning", path)],
      state: "completed",
    }),
  );
  assert.ok(warning.outcome === "valid", JSON.stringify(warning));
  assert.deepEqual(warning.findings, [valeFinding("warning", path)]);
  assert.deepEqual(
    warning.pages.map((page) => page.path),
    canonicalPagePaths,
  );
});

test("merges prose Findings with structural Findings in one sorted order", () => {
  const structural = lintAtlas(completeAtlas("invalid"), passingProseLinter);
  const prose = [
    valeFinding("error", ".atlas/principles/determinism.md"),
    valeFinding("warning", ".atlas/anchors/lint.md"),
  ];

  const result = lintAtlas(
    completeAtlas("invalid"),
    recordingProseLinter({ findings: prose, state: "completed" }),
  );

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.deepEqual(
    result.findings.map(({ code, path }) => ({ code, path })),
    [
      { code: "VALE_ATLASSDK_PAGELENGTH", path: ".atlas/anchors/lint.md" },
      {
        code: "ATLAS_PAGE_TITLE_H1_MISMATCH",
        path: ".atlas/concepts/canonical-serialization.md",
      },
      {
        code: "ATLAS_CITATION_TARGET_NOT_SOURCE",
        path: ".atlas/edges/lint-covers-canonical-serialization.md",
      },
      ...result.findings
        .filter((finding) => finding.path === ".atlas/principles/determinism.md")
        .map(({ code, path }) => ({ code, path })),
    ],
  );
  assert.equal(result.findings.length, structural.findings.length + prose.length);
  assert.deepEqual(
    result.findings
      .filter((finding) => finding.path === ".atlas/principles/determinism.md")
      .map((finding) => finding.code)
      .toSorted(),
    ["ATLAS_PAGE_TYPE_PATH_MISMATCH", "VALE_ATLASSDK_PAGELENGTH"],
  );
});

test("reports unavailable prose rules as a Lint that could not complete", () => {
  const result = lintAtlas(
    completeAtlas("valid"),
    recordingProseLinter({ reason: "Vale is missing", state: "unavailable" }),
  );

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.deepEqual(
    result.findings.map(({ code, message, path }) => ({ code, message, path })),
    [
      {
        code: "ATLAS_VALE_UNAVAILABLE",
        message: "Atlas prose Lint could not run: Vale is missing",
        path: ".atlas/.vale.ini",
      },
    ],
  );
});

test("reports a Lint it could not complete as one whole-Atlas Finding", () => {
  // The only failure no stage describes is running out of room to work in, so
  // the boundary is exercised by calling it from a stack already nearly spent.
  function atStackDepth(depth: number, run: () => AtlasLintResult): AtlasLintResult {
    return depth <= 0 ? run() : atStackDepth(depth - 1, run);
  }

  const atlas = completeAtlas("valid");
  let ceiling = 1000;
  for (; ceiling < 1e7; ceiling *= 2) {
    try {
      atStackDepth(ceiling, () => lintAtlas(atlas, passingProseLinter));
    } catch {
      break;
    }
  }

  let reported: AtlasLintResult | undefined;
  for (
    let depth = ceiling / 2;
    depth <= ceiling && reported === undefined;
    depth += 2
  ) {
    try {
      const result = atStackDepth(depth, () => lintAtlas(atlas, passingProseLinter));
      if (
        result.outcome === "invalid" &&
        result.findings[0]?.code === "ATLAS_LINT_FAILED"
      ) {
        reported = result;
      }
    } catch {
      continue;
    }
  }

  assert.ok(reported !== undefined, "no Lint ran out of room to complete");
  assert.deepEqual(reported.findings, [
    {
      attribution: {
        checkId: "sdk-core.atlas-lint",
        kind: "sdk-core",
        trusted: true,
      },
      code: "ATLAS_LINT_FAILED",
      "finding-schema": "1.0.0",
      message: "Atlas could not be linted.",
      path: ".atlas",
      severity: "error",
    },
  ]);
  assert.equal("pages" in reported, false);
  for (const finding of reported.findings) assert.equal(checkFinding(finding), true);
});

test("denies validity for errors alone, not for every Finding", () => {
  const report = (severity: Finding["severity"]): Finding =>
    Object.freeze({
      attribution: structuralAttribution,
      code: "ATLAS_PAGE_TITLE_H1_MISMATCH",
      "finding-schema": "1.0.0",
      message: "The first Markdown H1 must exactly match the page title.",
      path: ".atlas/index.md",
      severity,
    });

  assert.equal(deniesAtlasValidity([]), false);
  assert.equal(deniesAtlasValidity([report("error")]), true);
  for (const severity of [
    "warning",
    "suggestion",
    "inconclusive",
    "skipped",
  ] as const) {
    assert.equal(deniesAtlasValidity([report(severity)]), false, severity);
    assert.equal(
      deniesAtlasValidity([report(severity), report("error")]),
      true,
      severity,
    );
  }
});
