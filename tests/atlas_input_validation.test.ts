import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkFinding, type Finding } from "../src/domain/finding.ts";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import { loadAndValidateAtlasInput } from "../src/lint/validate_atlas_input.ts";

const encoder = new TextEncoder();
const fixturesRoot = resolve(import.meta.dirname, "fixtures", "atlas-pages");

function findingsOf(files: readonly CapturedAtlasFile[]): readonly Finding[] {
  return loadAndValidateAtlasInput(files).findings;
}

const atlasPaths = [
  ".atlas/manifest.json",
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

function duplicatedAtlas(): CapturedAtlasFile[] {
  return [...completeAtlas(), captured(".atlas//index.md", "duplicate")];
}

function withContent(path: string, content: string): CapturedAtlasFile[] {
  return completeAtlas().map((file) =>
    file.path === path ? captured(path, content) : file,
  );
}

const lineTerminatorMessage =
  "Atlas file contains a non-canonical line terminator: a carriage return without a following line feed, or a Unicode line or paragraph separator. Use LF or CRLF line endings.";

const inputAttribution = Object.freeze({
  checkId: "sdk-core.atlas-input",
  kind: "sdk-core",
  trusted: true,
});

test("accepts a valid complete captured Atlas with no Findings", () => {
  assert.deepEqual(findingsOf(completeAtlas()), []);
});

test("reports a loading failure as one stable attributed Finding", () => {
  const findings = findingsOf(duplicatedAtlas());

  assert.deepEqual(findings, [
    {
      attribution: inputAttribution,
      code: "ATLAS_LOAD_DUPLICATE_PATH",
      "finding-schema": "1.0.0",
      message: "Captured Atlas files contain a duplicate normalized path.",
      path: ".atlas",
      severity: "error",
    },
  ]);
  assert.equal(findings[0]?.location, undefined);
  for (const finding of findings) assert.equal(checkFinding(finding), true);

  // Identical bytes, and reversed input order, produce identical ordered Findings.
  assert.deepEqual(findingsOf(duplicatedAtlas()), findings);
  assert.deepEqual(findingsOf(duplicatedAtlas().toReversed()), findings);
});

test("maps distinct loading failures to distinct diagnostic codes", () => {
  const invalidUtf8 = [
    captured(".atlas/index.md", "ok"),
    { bytes: new Uint8Array([0xc3, 0x28]), path: ".atlas/concepts/bad.md" },
  ];
  assert.equal(findingsOf(invalidUtf8)[0]?.code, "ATLAS_LOAD_INVALID_UTF8");

  const duplicate = findingsOf(duplicatedAtlas());
  assert.equal(duplicate[0]?.code, "ATLAS_LOAD_DUPLICATE_PATH");
});

test("sanitizes loading failures and never leaks the offending raw path", () => {
  const findings = findingsOf([
    captured(".atlas/index.md", "ok"),
    { bytes: encoder.encode("x"), path: "/.atlas/secret-evil.md" },
  ]);

  assert.deepEqual(
    findings.map(({ code, location, path }) => ({ code, location, path })),
    [{ code: "ATLAS_LOAD_INVALID_PATH", location: undefined, path: ".atlas" }],
  );
  assert.equal(JSON.stringify(findings).includes("secret-evil"), false);
});

test("reports a non-canonical line terminator as a located Finding on its file", () => {
  for (const [character, column] of [
    ["\r", 6],
    ["\u2028", 6],
    ["\u2029", 6],
  ] as const) {
    const atlas = withContent(
      ".atlas/concepts/parsing.md",
      `---\nline\r\nwords${character}more\n`,
    );
    const validated = loadAndValidateAtlasInput(atlas);

    assert.deepEqual(
      validated.findings,
      [
        {
          attribution: inputAttribution,
          code: "ATLAS_LOAD_NON_CANONICAL_LINE_TERMINATOR",
          "finding-schema": "1.0.0",
          location: {
            end: { column: column + 1, line: 3 },
            start: { column, line: 3 },
          },
          message: lineTerminatorMessage,
          path: ".atlas/concepts/parsing.md",
          severity: "error",
        },
      ],
      JSON.stringify(character),
    );
    assert.equal(validated.loaded, false);
    assert.deepEqual(validated.files, []);
    assert.equal(validated.validationState, "invalid");
    for (const finding of validated.findings) assert.equal(checkFinding(finding), true);
  }
});

test("accepts CRLF line endings in Atlas files", () => {
  const atlas = completeAtlas().map((file) =>
    file.path.endsWith(".md")
      ? captured(
          file.path,
          new TextDecoder().decode(file.bytes).replaceAll("\n", "\r\n"),
        )
      : file,
  );
  assert.deepEqual(findingsOf(atlas), []);
});

test("reports every file carrying a non-canonical line terminator", () => {
  const atlas = [
    ...withContent(".atlas/index.md", "\u2029index"),
    captured(".atlas/concepts/extra.md", "one\ntwo\nthree\rfour"),
  ];
  const findings = findingsOf(atlas);

  assert.deepEqual(
    findings.map(({ code, location, path }) => ({ code, location, path })),
    [
      {
        code: "ATLAS_LOAD_NON_CANONICAL_LINE_TERMINATOR",
        location: { end: { column: 7, line: 3 }, start: { column: 6, line: 3 } },
        path: ".atlas/concepts/extra.md",
      },
      {
        code: "ATLAS_LOAD_NON_CANONICAL_LINE_TERMINATOR",
        location: { end: { column: 2, line: 1 }, start: { column: 1, line: 1 } },
        path: ".atlas/index.md",
      },
    ],
  );
  assert.deepEqual(findingsOf(atlas.toReversed()), findings);
  assert.equal(Object.isFrozen(findings), true);
  assert.equal(Object.isFrozen(findings[0]?.location), true);
});

test("reports a parsing failure with a diagnostic code and source location", () => {
  const atlas = completeAtlas().map((file) =>
    file.path === ".atlas/concepts/parsing.md"
      ? captured(file.path, "# Missing frontmatter\n")
      : file,
  );
  const findings = findingsOf(atlas);

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
  assert.deepEqual(findingsOf(atlas), findings);
});

test("returns a deeply frozen Finding collection", () => {
  const findings = findingsOf(duplicatedAtlas());
  assert.equal(Object.isFrozen(findings), true);
  assert.equal(Object.isFrozen(findings[0]), true);
  assert.equal(Object.isFrozen(findings[0]?.attribution), true);
});

test("carries the loaded text its Findings were decided from", () => {
  const atlas = completeAtlas();
  const validated = loadAndValidateAtlasInput(atlas);

  assert.deepEqual(validated.findings, []);
  assert.equal(validated.loaded, true);
  assert.deepEqual(
    validated.files.map((file) => file.path),
    [
      ".atlas/CHANGELOG.md",
      ".atlas/concepts/parsing.md",
      ".atlas/index.md",
      ".atlas/manifest.json",
      ".atlas/sources/parser-source.md",
    ],
  );
  assert.equal(Object.isFrozen(validated), true);
});

test("carries no text when loading itself failed", () => {
  const validated = loadAndValidateAtlasInput(duplicatedAtlas());

  assert.deepEqual(validated.files, []);
  assert.equal(validated.loaded, false);
  assert.equal(validated.findings[0]?.code, "ATLAS_LOAD_DUPLICATE_PATH");
});

test("reports captured bytes the running program cannot hand over", () => {
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

  const findings = findingsOf(atlas);

  assert.deepEqual(findings, [
    {
      attribution: inputAttribution,
      code: "ATLAS_CAPTURE_UNREADABLE",
      "finding-schema": "1.0.0",
      message:
        "Captured Atlas files could not be read from the program running the Lint.",
      path: ".atlas",
      severity: "error",
    },
  ]);
  for (const finding of findings) assert.equal(checkFinding(finding), true);
});

test("reports captured bytes loading refuses without describing why", () => {
  const atlas = completeAtlas().map((file, index) =>
    index === 0
      ? ({ bytes: "not bytes at all", path: file.path } as unknown as CapturedAtlasFile)
      : file,
  );

  const findings = findingsOf(atlas);

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
