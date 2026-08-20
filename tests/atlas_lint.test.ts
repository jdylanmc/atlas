import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkFinding } from "../src/domain/finding.ts";
import type {
  AtlasTextBudgets,
  CapturedAtlasFile,
} from "../src/atlas/load_atlas_text.ts";
import { lintAtlas, type AtlasLintResult } from "../src/lint/lint_atlas.ts";

const encoder = new TextEncoder();
const fixturesRoot = resolve(import.meta.dirname, "fixtures", "complete-atlas");

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

function fixtureBytes(variant: string, path: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(fixturesRoot, variant, path)));
}

function completeAtlas(variant: "invalid" | "valid"): CapturedAtlasFile[] {
  return atlasPaths.map((path) => ({ bytes: fixtureBytes(variant, path), path }));
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
  assert.equal("findings" in result, false);
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
