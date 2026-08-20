import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkFinding } from "../src/domain/finding.ts";
import type {
  CapturedAtlasFile,
  AtlasTextBudgets,
} from "../src/atlas/load_atlas_text.ts";
import {
  loadAndValidateAtlasInput,
  validateAtlasInput,
} from "../src/lint/validate_atlas_input.ts";

const encoder = new TextEncoder();
const fixturesRoot = resolve(import.meta.dirname, "fixtures", "atlas-pages");

const generousBudgets: AtlasTextBudgets = Object.freeze({
  maxFileBytes: 4096,
  maxTotalBytes: 65536,
});

const atlasPaths = [
  ".atlas/framework/README.md",
  ".atlas/CHANGELOG.md",
  ".atlas/index.md",
  ".atlas/concepts/parsing.md",
  ".atlas/sources/parser-source.md",
] as const;

function captured(path: string, content: string): CapturedAtlasFile {
  return { bytes: encoder.encode(content), path };
}

function completeAtlas(): CapturedAtlasFile[] {
  return atlasPaths.map((path) =>
    captured(path, readFileSync(resolve(fixturesRoot, path), "utf8")),
  );
}

const inputAttribution = Object.freeze({
  checkId: "sdk-core.atlas-input",
  kind: "sdk-core",
  trusted: true,
});

test("accepts a valid complete captured Atlas with no Findings", () => {
  assert.deepEqual(validateAtlasInput(completeAtlas(), generousBudgets), []);
});

test("reports a loading failure as one stable attributed Finding", () => {
  const budgets: AtlasTextBudgets = { maxFileBytes: 4096, maxTotalBytes: 200 };
  const findings = validateAtlasInput(completeAtlas(), budgets);

  assert.deepEqual(findings, [
    {
      attribution: inputAttribution,
      code: "ATLAS_LOAD_TOTAL_TOO_LARGE",
      "finding-schema": "1.0.0",
      message: "Captured Atlas files exceed the total byte budget.",
      path: ".atlas",
      severity: "error",
    },
  ]);
  assert.equal(findings[0]?.location, undefined);
  for (const finding of findings) assert.equal(checkFinding(finding), true);

  // Identical bytes, and reversed input order, produce identical ordered Findings.
  assert.deepEqual(validateAtlasInput(completeAtlas(), budgets), findings);
  assert.deepEqual(validateAtlasInput(completeAtlas().toReversed(), budgets), findings);
});

test("maps distinct loading failures to distinct diagnostic codes", () => {
  const invalidUtf8 = [
    captured(".atlas/index.md", "ok"),
    { bytes: new Uint8Array([0xc3, 0x28]), path: ".atlas/concepts/bad.md" },
  ];
  assert.equal(
    validateAtlasInput(invalidUtf8, generousBudgets)[0]?.code,
    "ATLAS_LOAD_INVALID_UTF8",
  );

  const oversizedFile = validateAtlasInput(
    [captured(".atlas/index.md", "0123456789")],
    {
      maxFileBytes: 4,
      maxTotalBytes: 64,
    },
  );
  assert.equal(oversizedFile[0]?.code, "ATLAS_LOAD_FILE_TOO_LARGE");
});

test("sanitizes loading failures and never leaks the offending raw path", () => {
  const findings = validateAtlasInput(
    [
      captured(".atlas/index.md", "ok"),
      { bytes: encoder.encode("x"), path: "/.atlas/secret-evil.md" },
    ],
    generousBudgets,
  );

  assert.deepEqual(
    findings.map(({ code, location, path }) => ({ code, location, path })),
    [{ code: "ATLAS_LOAD_INVALID_PATH", location: undefined, path: ".atlas" }],
  );
  assert.equal(JSON.stringify(findings).includes("secret-evil"), false);
});

test("reports a parsing failure with a diagnostic code and source location", () => {
  const atlas = completeAtlas().map((file) =>
    file.path === ".atlas/concepts/parsing.md"
      ? captured(file.path, "# Missing frontmatter\n")
      : file,
  );
  const findings = validateAtlasInput(atlas, generousBudgets);

  assert.deepEqual(
    findings.map(({ attribution, code, location, path }) => ({
      attribution,
      code,
      location,
      path,
    })),
    [
      {
        attribution: {
          checkId: "sdk-core.structural-validation",
          kind: "sdk-core",
          trusted: true,
        },
        code: "ATLAS_PAGE_MISSING_FRONTMATTER",
        location: { end: { column: 22, line: 1 }, start: { column: 1, line: 1 } },
        path: ".atlas/concepts/parsing.md",
      },
    ],
  );
  for (const finding of findings) assert.equal(checkFinding(finding), true);

  // Identical invalid bytes produce identical ordered Findings across runs.
  assert.deepEqual(validateAtlasInput(atlas, generousBudgets), findings);
});

test("returns a deeply frozen Finding collection", () => {
  const findings = validateAtlasInput(completeAtlas(), {
    maxFileBytes: 4096,
    maxTotalBytes: 200,
  });
  assert.equal(Object.isFrozen(findings), true);
  assert.equal(Object.isFrozen(findings[0]), true);
  assert.equal(Object.isFrozen(findings[0]?.attribution), true);
});

test("carries the loaded text its Findings were decided from", () => {
  const atlas = completeAtlas();
  const validated = loadAndValidateAtlasInput(atlas, generousBudgets);

  assert.deepEqual(validated.findings, []);
  assert.deepEqual(
    validated.files.map((file) => file.path),
    [
      ".atlas/CHANGELOG.md",
      ".atlas/concepts/parsing.md",
      ".atlas/framework/README.md",
      ".atlas/index.md",
      ".atlas/sources/parser-source.md",
    ],
  );
  assert.equal(Object.isFrozen(validated), true);
});

test("carries no text when loading itself failed", () => {
  const validated = loadAndValidateAtlasInput(completeAtlas(), {
    maxFileBytes: 4096,
    maxTotalBytes: 200,
  });

  assert.deepEqual(validated.files, []);
  assert.equal(validated.findings[0]?.code, "ATLAS_LOAD_TOTAL_TOO_LARGE");
});

test("reports a captured file that cannot be read at all", () => {
  const atlas = completeAtlas().map((file, index) =>
    index === 0
      ? {
          get bytes(): Uint8Array {
            throw new TypeError("bytes are unavailable");
          },
          path: file.path,
        }
      : file,
  );

  const findings = validateAtlasInput(atlas, generousBudgets);

  assert.deepEqual(findings, [
    {
      attribution: inputAttribution,
      code: "ATLAS_LOAD_FAILED",
      "finding-schema": "1.0.0",
      message: "Captured Atlas files could not be loaded.",
      path: ".atlas",
      severity: "error",
    },
  ]);
  for (const finding of findings) assert.equal(checkFinding(finding), true);
});
