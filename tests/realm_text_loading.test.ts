import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  loadRealmText,
  RealmLoadError,
  type CapturedRealmFile,
} from "../src/realm/load_realm_text.ts";

const encoder = new TextEncoder();
const BUDGETS = Object.freeze({
  maxFileBytes: 32,
  maxTotalBytes: 64,
});

function captured(path: string, content: string): CapturedRealmFile {
  return { bytes: encoder.encode(content), path };
}

function errorCode(action: () => unknown): RealmLoadError["code"] {
  try {
    action();
  } catch (error: unknown) {
    assert.ok(error instanceof RealmLoadError);
    assert.equal(error.message.includes("/Users/"), false);
    return error.code;
  }
  assert.fail("Expected RealmLoadError.");
}

test("loads exact text in fixed code-point path order", () => {
  const input = [
    captured(".atlas/\u{10000}.md", "astral"),
    captured(".atlas/z.md", "z\r\n"),
    captured(".atlas/\u{e000}.md", "bmp"),
    captured(".atlas/a/long.md", "long"),
    captured(".atlas/a.md", "short"),
  ];

  assert.deepEqual(loadRealmText(input, BUDGETS), [
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
    loadRealmText(valid, BUDGETS),
    loadRealmText([...valid].reverse(), BUDGETS),
  );

  const invalid = [
    {
      bytes: new Uint8Array([0xc3, 0x28]),
      path: ".atlas/z.md",
    },
    captured(".atlas/a.md", "oversized"),
  ];
  const budgets = { maxFileBytes: 4, maxTotalBytes: 100 };
  const forwardError = errorCode(() => loadRealmText(invalid, budgets));
  assert.equal(
    forwardError,
    errorCode(() => loadRealmText([...invalid].reverse(), budgets)),
  );
  assert.equal(forwardError, "FILE_TOO_LARGE");
});

test("normalizes paths and rejects duplicate normalized paths", () => {
  assert.deepEqual(loadRealmText([captured(".atlas//a/./page.md", "text")], BUDGETS), [
    { content: "text", path: ".atlas/a/page.md" },
  ]);
  assert.equal(
    errorCode(() =>
      loadRealmText(
        [captured(".atlas/a/page.md", "one"), captured(".atlas//a/./page.md", "two")],
        BUDGETS,
      ),
    ),
    "DUPLICATE_PATH",
  );
});

test("rejects absolute, traversal, backslash, and non-Realm paths", () => {
  for (const path of [
    "/.atlas/page.md",
    ".atlas/../outside.md",
    ".atlas\\page.md",
    "notes/page.md",
    ".atlas",
    ".atlas/",
    ".atlas/\0page.md",
  ]) {
    assert.equal(
      errorCode(() => loadRealmText([captured(path, "text")], BUDGETS)),
      "INVALID_PATH",
    );
  }
});

test("returned text has no caller mutation aliases", () => {
  const bytes = encoder.encode("original");
  const input: CapturedRealmFile[] = [{ bytes, path: ".atlas/index.md" }];
  const loaded = loadRealmText(input, BUDGETS);

  bytes.fill(0);
  input[0] = captured(".atlas/changed.md", "changed");
  assert.deepEqual(loaded, [{ content: "original", path: ".atlas/index.md" }]);
});

test("rejects bytes backed by shared memory", () => {
  const bytes = new Uint8Array(new SharedArrayBuffer(4));
  assert.equal(
    errorCode(() => loadRealmText([{ bytes, path: ".atlas/shared.md" }], BUDGETS)),
    "SHARED_BYTES_NOT_ALLOWED",
  );
});

test("rejects cross-context shared memory", () => {
  const bytes = runInNewContext(
    "new Uint8Array(new SharedArrayBuffer(4))",
  ) as Uint8Array;
  assert.equal(
    errorCode(() => loadRealmText([{ bytes, path: ".atlas/shared.md" }], BUDGETS)),
    "SHARED_BYTES_NOT_ALLOWED",
  );
});

test("strictly rejects invalid UTF-8", () => {
  assert.equal(
    errorCode(() =>
      loadRealmText(
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
    errorCode(() => loadRealmText(input, { maxFileBytes: 3, maxTotalBytes: 100 })),
    "FILE_TOO_LARGE",
  );
  assert.equal(
    errorCode(() => loadRealmText(input, { maxFileBytes: 4, maxTotalBytes: 7 })),
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
      errorCode(() => loadRealmText([], budgets)),
      "INVALID_BUDGET",
    );
  }
});

test("returns deeply immutable records and collection", () => {
  const loaded = loadRealmText([captured(".atlas/index.md", "text")], BUDGETS);
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
