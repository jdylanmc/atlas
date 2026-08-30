import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  atlasPathCollisionKey,
  atlasPathCollisionSegments,
  loadAtlasText,
  AtlasLoadError,
  trimWin32PathSegment,
  type CapturedAtlasFile,
} from "../src/atlas/load_atlas_text.ts";

const encoder = new TextEncoder();
const BUDGETS = Object.freeze({
  maxFileBytes: 32,
  maxTotalBytes: 64,
});

function captured(path: string, content: string): CapturedAtlasFile {
  return { bytes: encoder.encode(content), path };
}

function errorCode(action: () => unknown): AtlasLoadError["code"] {
  try {
    action();
  } catch (error: unknown) {
    assert.ok(error instanceof AtlasLoadError);
    assert.equal(error.message.includes("/Users/"), false);
    return error.code;
  }
  assert.fail("Expected AtlasLoadError.");
}

test("loads exact text in fixed code-point path order", () => {
  const input = [
    captured(".atlas/\u{10000}.md", "astral"),
    captured(".atlas/z.md", "z\r\n"),
    captured(".atlas/\u{e000}.md", "bmp"),
    captured(".atlas/a/long.md", "long"),
    captured(".atlas/a.md", "short"),
  ];

  assert.deepEqual(loadAtlasText(input, BUDGETS), [
    { content: "short", path: ".atlas/a.md" },
    { content: "long", path: ".atlas/a/long.md" },
    { content: "z\r\n", path: ".atlas/z.md" },
    { content: "bmp", path: ".atlas/\u{e000}.md" },
    { content: "astral", path: ".atlas/\u{10000}.md" },
  ]);
});

test("reversed input produces identical success and error results", () => {
  const valid = [captured(".atlas/z.md", "z"), captured(".atlas/a.md", "a")];
  assert.deepEqual(
    loadAtlasText(valid, BUDGETS),
    loadAtlasText([...valid].reverse(), BUDGETS),
  );

  const invalid = [
    {
      bytes: new Uint8Array([0xc3, 0x28]),
      path: ".atlas/z.md",
    },
    captured(".atlas/a.md", "oversized"),
  ];
  const budgets = { maxFileBytes: 4, maxTotalBytes: 100 };
  const forwardError = errorCode(() => loadAtlasText(invalid, budgets));
  assert.equal(
    forwardError,
    errorCode(() => loadAtlasText([...invalid].reverse(), budgets)),
  );
  assert.equal(forwardError, "FILE_TOO_LARGE");
});

test("normalizes paths and rejects duplicate normalized paths", () => {
  assert.deepEqual(loadAtlasText([captured(".atlas//a/./page.md", "text")], BUDGETS), [
    { content: "text", path: ".atlas/a/page.md" },
  ]);
  assert.equal(
    errorCode(() =>
      loadAtlasText(
        [captured(".atlas/a/page.md", "one"), captured(".atlas//a/./page.md", "two")],
        BUDGETS,
      ),
    ),
    "DUPLICATE_PATH",
  );
});

test("exports the shared Win32 path-segment trimming rule", () => {
  assert.equal(trimWin32PathSegment("CHANGELOG.md"), "CHANGELOG.md");
  assert.equal(trimWin32PathSegment("CHANGELOG.md. "), "CHANGELOG.md");
});

test("folds Atlas path collisions to one shared filesystem identity", () => {
  const canonical = ".atlas/CHANGELOG.md";
  const expectedKey = atlasPathCollisionKey(canonical);
  const expectedSegments = [".atlas", "changelog.md"];

  assert.deepEqual(atlasPathCollisionSegments(canonical), expectedSegments);

  for (const variant of [
    ".atlas/CHANGELOG.md",
    ".atlas/changelog.md",
    ".atlas/CHANGELOG.MD",
    ".atlas/Changelog.md",
    ".atlas/CHANGELOG.md.",
    ".atlas/CHANGELOG.md ",
  ]) {
    assert.equal(atlasPathCollisionKey(variant), expectedKey, variant);
  }

  assert.notEqual(atlasPathCollisionKey(".atlas/principles/x.md"), expectedKey);
  assert.equal(
    atlasPathCollisionKey(".atlas/cafe\u0301.md"),
    atlasPathCollisionKey(".atlas/caf\u00e9.md"),
  );
  // governance_operation.ts validates authored `change.path` with
  // `pathIsCanonicalAtlasPath`, and ingest_operation.ts validates crawled
  // `source.locator` / `concept.locator` with `isCanonicalLocator`, before those
  // values reach this fold. But ingest_operation.ts also feeds scope-confinement
  // prefixes through `isPrefixPath`, and those `scope.entryPoint`,
  // `scope.includedPaths`, and `scope.excludedPaths` values are parsed with
  // `asString` / `asStringArray` and are not canonical-path-validated anywhere,
  // so `.atlas//CHANGELOG.md`-style spellings genuinely reach this fold there
  // today. This test pins the shared folding rule directly so the two
  // consumers cannot drift.
  assert.equal(atlasPathCollisionKey(".atlas//CHANGELOG.md"), expectedKey);
  assert.deepEqual(
    atlasPathCollisionSegments(".atlas//CHANGELOG.md"),
    expectedSegments,
  );
});

test("rejects absolute, traversal, backslash, and non-Atlas paths", () => {
  for (const path of [
    "/.atlas/page.md",
    ".atlas/../outside.md",
    ".atlas\\page.md",
    "notes/page.md",
    ".atlas",
    ".atlas/",
    ".atlas/\0page.md",
    ".atlas/concepts/\u001b[2Kpage.md",
    ".atlas/concepts/\u0007page.md",
    ".atlas/concepts/\u009bpage.md",
    ".atlas/concepts/\u202egnp.dm.md",
    ".atlas/concepts/\u2066page.md",
  ]) {
    assert.equal(
      errorCode(() => loadAtlasText([captured(path, "text")], BUDGETS)),
      "INVALID_PATH",
    );
  }
});

test("returned text has no caller mutation aliases", () => {
  const bytes = encoder.encode("original");
  const input: CapturedAtlasFile[] = [{ bytes, path: ".atlas/index.md" }];
  const loaded = loadAtlasText(input, BUDGETS);

  bytes.fill(0);
  input[0] = captured(".atlas/changed.md", "changed");
  assert.deepEqual(loaded, [{ content: "original", path: ".atlas/index.md" }]);
});

test("rejects bytes backed by shared memory", () => {
  const bytes = new Uint8Array(new SharedArrayBuffer(4));
  assert.equal(
    errorCode(() => loadAtlasText([{ bytes, path: ".atlas/shared.md" }], BUDGETS)),
    "SHARED_BYTES_NOT_ALLOWED",
  );
});

test("rejects species-poisoned shared memory", () => {
  const buffer = new SharedArrayBuffer(4);
  Object.defineProperty(buffer, "constructor", {
    value: {
      get [Symbol.species](): never {
        throw new Error("poisoned species");
      },
    },
  });
  const bytes = new Uint8Array(buffer);
  assert.equal(
    errorCode(() => loadAtlasText([{ bytes, path: ".atlas/shared.md" }], BUDGETS)),
    "SHARED_BYTES_NOT_ALLOWED",
  );
});

test("rejects shared memory hidden by an overridden buffer getter", () => {
  class MisleadingBytes extends Uint8Array {
    override get buffer(): ArrayBuffer {
      return new ArrayBuffer(4);
    }
  }

  const bytes = new Uint8Array(new SharedArrayBuffer(4));
  Object.setPrototypeOf(bytes, MisleadingBytes.prototype);
  assert.ok(bytes.buffer instanceof ArrayBuffer);
  assert.equal(
    errorCode(() => loadAtlasText([{ bytes, path: ".atlas/shared.md" }], BUDGETS)),
    "SHARED_BYTES_NOT_ALLOWED",
  );
});

test("rejects cross-context shared memory", () => {
  const bytes = runInNewContext(
    "new Uint8Array(new SharedArrayBuffer(4))",
  ) as Uint8Array;
  assert.equal(
    errorCode(() => loadAtlasText([{ bytes, path: ".atlas/shared.md" }], BUDGETS)),
    "SHARED_BYTES_NOT_ALLOWED",
  );
});

test("rejects non-canonical line terminators before text reaches consumers", () => {
  for (const character of ["\r", "\u2028", "\u2029"]) {
    assert.equal(
      errorCode(() =>
        loadAtlasText([captured(".atlas/page.md", `a${character}b`)], BUDGETS),
      ),
      "NON_CANONICAL_LINE_TERMINATOR",
      JSON.stringify(character),
    );
  }
});

test("strictly rejects invalid UTF-8", () => {
  assert.equal(
    errorCode(() =>
      loadAtlasText(
        [{ bytes: new Uint8Array([0xc3, 0x28]), path: ".atlas/bad.txt" }],
        BUDGETS,
      ),
    ),
    "INVALID_UTF8",
  );
});

test("enforces per-file and total byte budgets in path order", () => {
  const input = [captured(".atlas/b.txt", "5678"), captured(".atlas/a.txt", "1234")];
  assert.equal(
    errorCode(() => loadAtlasText(input, { maxFileBytes: 3, maxTotalBytes: 100 })),
    "FILE_TOO_LARGE",
  );
  assert.equal(
    errorCode(() => loadAtlasText(input, { maxFileBytes: 4, maxTotalBytes: 7 })),
    "TOTAL_TOO_LARGE",
  );
});

test("rejects every invalid budget shape", () => {
  for (const budgets of [
    { maxFileBytes: -1, maxTotalBytes: 0 },
    { maxFileBytes: 0.5, maxTotalBytes: 0 },
    { maxFileBytes: 0, maxTotalBytes: -1 },
    { maxFileBytes: 0, maxTotalBytes: 0.5 },
  ]) {
    assert.equal(
      errorCode(() => loadAtlasText([], budgets)),
      "INVALID_BUDGET",
    );
  }
});

test("returns deeply immutable records and collection", () => {
  const loaded = loadAtlasText([captured(".atlas/index.md", "text")], BUDGETS);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded[0]), true);
  assert.throws(() => {
    (loaded as { content: string; path: string }[]).push({
      content: "changed",
      path: ".atlas/changed.md",
    });
  }, TypeError);
  assert.throws(() => {
    (loaded[0] as { path: string }).path = ".atlas/changed.md";
  }, TypeError);
});
