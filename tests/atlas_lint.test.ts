import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkFinding, type Finding } from "../src/domain/finding.ts";
import type {
  AtlasTextBudgets,
  CapturedAtlasFile,
} from "../src/atlas/load_atlas_text.ts";
import { maxFrontmatterDepth } from "../src/atlas/parse_atlas_pages.ts";
import {
  deniesAtlasValidity,
  lintAtlas,
  type AtlasLintResult,
} from "../src/lint/lint_atlas.ts";
import { assertGrowthRatio, assertWallClockUnder } from "./growth.ts";

const encoder = new TextEncoder();
const fixturesRoot = resolve(import.meta.dirname, "fixtures", "complete-atlas");
const opaquePaths = [".atlas/CHANGELOG.md", ".atlas/framework/README.md"] as const;

const generousBudgets: AtlasTextBudgets = Object.freeze({
  maxFileBytes: 4096,
  maxTotalBytes: 65536,
});

// Captured in an order no canonical result may depend on: opaque records first,
// pages neither in code point order nor in directory order.
const atlasPaths = [
  ".atlas/framework/README.md",
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
  return atlasPaths.map((path) => ({ bytes: fixtureBytes(variant, path), path }));
}

// The nested key sits two columns in and its own line counts as one level, so
// the deepest nesting the bound still reads is three levels below the bound.
const insideBoundDepth = maxFrontmatterDepth - 3;

// One Atlas-owned key nests as deeply as asked, in flow style so the nesting
// costs bytes rather than columns: byte budgets alone cannot bound it.
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
  const result = lintAtlas(completeAtlas("valid"), generousBudgets);

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
  // `pages` would otherwise delete the Changelog and the Framework Bundle.
  assert.deepEqual(
    result.opaque.map((record) => record.path),
    opaquePaths,
  );
  for (const record of result.opaque) {
    assert.equal(record.content, fixtureText(record.path), record.path);
  }
  assert.deepEqual(
    result.pages.filter((page) => opaquePaths.some((path) => path === page.path)),
    [],
  );
});

test("returns stable Findings without partial or success-shaped output", () => {
  const result = lintAtlas(completeAtlas("invalid"), generousBudgets);

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
  const result = lintAtlas(completeAtlas("valid"), {
    maxFileBytes: 4096,
    maxTotalBytes: 200,
  });

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
        code: "ATLAS_LOAD_TOTAL_TOO_LARGE",
        path: ".atlas",
      },
    ],
  );
});

test("produces identical ordered Findings and canonical pages across runs", () => {
  for (const variant of ["invalid", "valid"] as const) {
    const first = lintAtlas(completeAtlas(variant), generousBudgets);
    assert.deepEqual(lintAtlas(completeAtlas(variant), generousBudgets), first);
    // Capture order carries no meaning, so reversing it changes nothing.
    assert.deepEqual(
      lintAtlas(completeAtlas(variant).toReversed(), generousBudgets),
      first,
    );
  }
});

test("lints its own canonical pages to the same canonical bytes", () => {
  const pages = lintedPages(lintAtlas(completeAtlas("valid"), generousBudgets));
  const relinted = lintAtlas(pages.toReversed(), generousBudgets);

  assert.deepEqual(lintedPages(relinted), pages);
});

test("decides one whole-Atlas Lint from one reading of every input", () => {
  const honest = lintAtlas(completeAtlas("valid"), generousBudgets);

  // Each captured file and each budget answers honestly once and sabotages every
  // later read, so a second reading of any caller-owned value changes the result.
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
  let budgetReads = 0;
  const hostileBudgets: AtlasTextBudgets = {
    get maxFileBytes(): number {
      budgetReads += 1;
      return budgetReads > 2 ? 0 : generousBudgets.maxFileBytes;
    },
    get maxTotalBytes(): number {
      budgetReads += 1;
      return budgetReads > 2 ? 0 : generousBudgets.maxTotalBytes;
    },
  };

  assert.deepEqual(lintAtlas(hostileFiles, hostileBudgets), honest);
  assert.equal(budgetReads, 2);
});

test("decides the Lint from one loading of the captured bytes", () => {
  const honest = lintAtlas(completeAtlas("valid"), generousBudgets);

  // Loading measures each file's byte length twice, so bytes that rewrite
  // themselves on a third measurement change only what a second loading of the
  // same captured Atlas would read.
  let measurements = 0;
  const atlas = completeAtlas("valid").map((file) => {
    if (file.path !== ".atlas/index.md") return file;
    const bytes = file.bytes;
    Object.defineProperty(bytes, "byteLength", {
      get(): number {
        measurements += 1;
        if (measurements > 2) bytes.fill(0x20);
        return bytes.length;
      },
    });
    return { bytes, path: file.path };
  });

  assert.deepEqual(lintAtlas(atlas, generousBudgets), honest);
  assert.equal(measurements, 2);
});

test("returns a deeply frozen result", () => {
  const valid = lintAtlas(completeAtlas("valid"), generousBudgets);
  assert.ok(valid.outcome === "valid", JSON.stringify(valid));
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(Object.isFrozen(valid.pages), true);
  assert.equal(Object.isFrozen(valid.pages[0]), true);

  const invalid = lintAtlas(completeAtlas("invalid"), generousBudgets);
  assert.ok(invalid.outcome === "invalid", JSON.stringify(invalid));
  assert.equal(Object.isFrozen(invalid), true);
  assert.equal(Object.isFrozen(invalid.findings), true);
  assert.equal(Object.isFrozen(invalid.findings[0]), true);
});

test("refuses frontmatter nesting deeper than it reads, on every run", () => {
  const first = lintAtlas(deepAtlas(maxFrontmatterDepth + 1), generousBudgets);

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
  const inside = lintAtlas(deepAtlas(insideBoundDepth), generousBudgets);
  assert.ok(inside.outcome === "valid", JSON.stringify(inside));
  for (let run = 0; run < 10; run += 1) {
    assert.deepEqual(
      lintAtlas(deepAtlas(maxFrontmatterDepth + 1), generousBudgets),
      first,
    );
    assert.deepEqual(lintAtlas(deepAtlas(insideBoundDepth), generousBudgets), inside);
  }
});

test("answers every nesting depth with a verdict rather than an exception", () => {
  // Nesting deep enough to exhaust the stack of the process must still earn a
  // Finding: an escaping exception is a crashed caller rather than a verdict.
  const depths = [1, 2, 8, insideBoundDepth, maxFrontmatterDepth, 500, 5000];
  for (let run = 0; run < 10; run += 1) {
    for (const depth of depths) {
      const result = lintAtlas(deepAtlas(depth), generousBudgets);
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

  const result = lintAtlas(atlas, generousBudgets);

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
      result = lintAtlas(atlas, {
        maxFileBytes: 4 * megabyte,
        maxTotalBytes: 8 * megabyte,
      });
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
  // Each of these was measured taking seconds to minutes, and hours at the
  // sizes a caller's own byte budget still admits.
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
      result = lintAtlas(atlas, {
        maxFileBytes: 4 * megabyte,
        maxTotalBytes: 8 * megabyte,
      });
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
  const budgets = { maxFileBytes: 4 * megabyte, maxTotalBytes: 8 * megabyte };

  let result: AtlasLintResult | undefined;
  assertWallClockUnder("linting oversized frontmatter", 2000, () => {
    result = lintAtlas(oversized, budgets);
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

  assert.equal(lintAtlas(large, budgets).outcome, "valid");
});

// A body twice the size costs about twice as much to refuse when the cost is
// the bytes; anything superlinear shows up as a ratio near four or above. A
// growth ratio survives a slower machine, where a fixed millisecond budget
// would only report the machine.
function lintBody(body: string, budgets: AtlasTextBudgets): void {
  const atlas = completeAtlas("valid").map((file) =>
    file.path === ".atlas/anchors/lint.md"
      ? {
          bytes: encoder.encode(`${fixtureText(file.path)}\n${body}\n`),
          path: file.path,
        }
      : file,
  );
  lintAtlas(atlas, budgets);
}

test("costs no more than the bytes it is given as those bytes double", () => {
  const megabyte = 1024 * 1024;
  const budgets = { maxFileBytes: 16 * megabyte, maxTotalBytes: 32 * megabyte };
  // Each shape was measured superlinear before it was bounded, so each is read
  // at one size and at twice that size and the two costs compared.
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
      large: () => lintBody(make(count * 2), budgets),
      name: `refusing ${shape}`,
      small: () => lintBody(make(count), budgets),
    });
  }

  // Prose is read rather than refused, so the accepted path is measured too,
  // below every declared bound at both sizes.
  const prose = (count: number): string => `${"word ".repeat(16)}\n`.repeat(count);
  assertGrowthRatio({
    large: () => lintBody(prose(16384), budgets),
    name: "reading prose",
    small: () => lintBody(prose(8192), budgets),
  });
});

test("locates a value in frontmatter no reader would end early", () => {
  // A lone carriage return starts a line for a JavaScript regular expression
  // under the multiline flag but not for the YAML reader, so a comment holding
  // one used to end the frontmatter early for the stage locating a value, and
  // the Lint answered that it could not complete instead of reporting the page.
  const backdated = fixtureText(".atlas/concepts/canonical-serialization.md")
    .replace("sdk:\n", "sdk:\n  # note\r---\r\n")
    .replace(/updated-at: "[^"]+"/u, 'updated-at: "2020-01-01T00:00:00Z"');
  const atlas = completeAtlas("valid").map((file) =>
    file.path === ".atlas/concepts/canonical-serialization.md"
      ? { bytes: encoder.encode(backdated), path: file.path }
      : file,
  );

  const result = lintAtlas(atlas, { maxFileBytes: 8192, maxTotalBytes: 65536 });

  assert.ok(result.outcome === "invalid", JSON.stringify(result));
  assert.deepEqual(
    result.findings.map(({ code, path }) => ({ code, path })),
    [
      {
        code: "ATLAS_PAGE_UPDATED_BEFORE_CREATED",
        path: ".atlas/concepts/canonical-serialization.md",
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
      atStackDepth(ceiling, () => lintAtlas(atlas, generousBudgets));
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
      const result = atStackDepth(depth, () => lintAtlas(atlas, generousBudgets));
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
