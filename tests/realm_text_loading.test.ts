import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createNodeReadOnlyFileTree } from "../src/adapters/node_read_only_file_tree.ts";
import {
  loadRealmText,
  RealmLoadError,
  type ReadOnlyFileTree,
} from "../src/realm/load_realm_text.ts";

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACES = resolve(ROOT, ".test-workspaces");
const BUDGETS = Object.freeze({
  maxFileBytes: 32,
  maxTotalBytes: 64,
});

function workspace(): string {
  mkdirSync(WORKSPACES, { recursive: true });
  const root = mkdtempSync(join(WORKSPACES, "realm-load-"));
  mkdirSync(join(root, ".atlas"));
  return root;
}

function expectCode(code: RealmLoadError["code"]): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.ok(error instanceof RealmLoadError);
    assert.equal(error.code, code);
    assert.equal(error.message.includes(ROOT), false);
    return true;
  };
}

test("loads exact text in fixed code-point path order repeatedly", async () => {
  const root = workspace();
  try {
    mkdirSync(join(root, ".atlas", "nested"));
    writeFileSync(join(root, ".atlas", "z.md"), "z\r\n");
    writeFileSync(join(root, ".atlas", "\u{10000}.md"), "astral");
    writeFileSync(join(root, ".atlas", "\u{e000}.md"), "bmp");
    writeFileSync(join(root, ".atlas", "\u{10000}-a.md"), "astral-a");
    writeFileSync(join(root, ".atlas", "\u{10000}-b.md"), "astral-b");
    writeFileSync(join(root, ".atlas", "nested", "a.txt"), "a");
    const tree = createNodeReadOnlyFileTree(root);

    const first = await loadRealmText(tree, BUDGETS);
    const second = await loadRealmText(tree, BUDGETS);

    assert.deepEqual(first, second);
    assert.deepEqual(first, [
      { content: "a", path: ".atlas/nested/a.txt" },
      { content: "z\r\n", path: ".atlas/z.md" },
      { content: "bmp", path: ".atlas/\u{e000}.md" },
      { content: "astral-a", path: ".atlas/\u{10000}-a.md" },
      { content: "astral-b", path: ".atlas/\u{10000}-b.md" },
      { content: "astral", path: ".atlas/\u{10000}.md" },
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("returned collection and records are immutable without aliases", async () => {
  const root = workspace();
  try {
    writeFileSync(join(root, ".atlas", "index.md"), "original");
    const loaded = await loadRealmText(createNodeReadOnlyFileTree(root), BUDGETS);
    writeFileSync(join(root, ".atlas", "index.md"), "changed");

    assert.equal(Object.isFrozen(loaded), true);
    assert.equal(Object.isFrozen(loaded[0]), true);
    assert.equal(loaded[0]?.content, "original");
    assert.throws(() => {
      (loaded as RealmTextFileForMutation[]).push({
        content: "x",
        path: "x",
      });
    }, TypeError);
    assert.throws(() => {
      (loaded[0] as { path: string }).path = "changed";
    }, TypeError);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

interface RealmTextFileForMutation {
  content: string;
  path: string;
}

test("rejects traversal and malicious file-tree paths", async () => {
  const root = workspace();
  try {
    const tree = createNodeReadOnlyFileTree(root);
    for (const segment of ["", ".", "..", "a/b", "a\\b", "a\0b"]) {
      await assert.rejects(
        tree.listDirectory([".atlas", segment]),
        expectCode("INVALID_PATH"),
      );
    }

    const malicious: ReadOnlyFileTree = {
      listDirectory() {
        return Promise.resolve([{ kind: "file", name: "../outside" }]);
      },
      readFile() {
        assert.fail("invalid paths must not be read");
      },
    };
    await assert.rejects(loadRealmText(malicious, BUDGETS), expectCode("INVALID_PATH"));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects a symbolic-link .atlas directory", async (context) => {
  const root = workspace();
  const atlas = join(root, ".atlas");
  const target = join(root, "target");
  rmSync(atlas, { recursive: true });
  mkdirSync(target);
  try {
    try {
      symlinkSync(target, atlas, "dir");
    } catch (error: unknown) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        context.skip(`symbolic links unavailable: ${code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      loadRealmText(createNodeReadOnlyFileTree(root), BUDGETS),
      expectCode("SYMLINK_NOT_ALLOWED"),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects symbolic links at file and directory levels", async (context) => {
  const root = workspace();
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "outside");
  mkdirSync(join(root, "outside-directory"));
  writeFileSync(join(root, "outside-directory", "page.md"), "outside");
  try {
    try {
      symlinkSync(outside, join(root, ".atlas", "file-link"));
      symlinkSync(
        join(root, "outside-directory"),
        join(root, ".atlas", "directory-link"),
        "dir",
      );
    } catch (error: unknown) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        context.skip(`symbolic links unavailable: ${code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      loadRealmText(createNodeReadOnlyFileTree(root), BUDGETS),
      expectCode("SYMLINK_NOT_ALLOWED"),
    );
    rmSync(join(root, ".atlas", "file-link"));
    await assert.rejects(
      loadRealmText(createNodeReadOnlyFileTree(root), BUDGETS),
      expectCode("SYMLINK_NOT_ALLOWED"),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects invalid UTF-8 with a stable sanitized error", async () => {
  const root = workspace();
  try {
    writeFileSync(join(root, ".atlas", "bad.txt"), Buffer.from([0xc3, 0x28]));
    await assert.rejects(
      loadRealmText(createNodeReadOnlyFileTree(root), BUDGETS),
      expectCode("INVALID_UTF8"),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("enforces per-file and total byte budgets", async () => {
  const root = workspace();
  try {
    writeFileSync(join(root, ".atlas", "a.txt"), "1234");
    writeFileSync(join(root, ".atlas", "b.txt"), "5678");
    const tree = createNodeReadOnlyFileTree(root);

    await assert.rejects(
      loadRealmText(tree, { maxFileBytes: 3, maxTotalBytes: 100 }),
      expectCode("FILE_TOO_LARGE"),
    );
    await assert.rejects(
      loadRealmText(tree, { maxFileBytes: 4, maxTotalBytes: 7 }),
      expectCode("TOTAL_TOO_LARGE"),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects every invalid budget shape", async () => {
  const emptyTree: ReadOnlyFileTree = {
    listDirectory() {
      return Promise.resolve([]);
    },
    readFile() {
      return Promise.resolve(new Uint8Array());
    },
  };
  for (const budgets of [
    { maxFileBytes: -1, maxTotalBytes: 0 },
    { maxFileBytes: 0.5, maxTotalBytes: 0 },
    { maxFileBytes: 0, maxTotalBytes: -1 },
    { maxFileBytes: 0, maxTotalBytes: 0.5 },
  ]) {
    await assert.rejects(
      loadRealmText(emptyTree, budgets),
      expectCode("INVALID_BUDGET"),
    );
  }
});

test("rejects unsupported entries from any file tree", async () => {
  await assert.rejects(
    loadRealmText(
      {
        listDirectory() {
          return Promise.resolve([{ kind: "unsupported", name: "device" }]);
        },
        readFile() {
          return Promise.resolve(new Uint8Array());
        },
      },
      BUDGETS,
    ),
    expectCode("UNSUPPORTED_ENTRY"),
  );
});

test("sanitizes file-tree listing and reading failures", async () => {
  const genericListFailure: ReadOnlyFileTree = {
    listDirectory() {
      return Promise.reject(new Error(`${ROOT}/secret`));
    },
    readFile() {
      return Promise.resolve(new Uint8Array());
    },
  };
  await assert.rejects(
    loadRealmText(genericListFailure, BUDGETS),
    expectCode("IO_ERROR"),
  );

  const realmListFailure = new RealmLoadError("UNSUPPORTED_ENTRY");
  await assert.rejects(
    loadRealmText(
      {
        listDirectory() {
          return Promise.reject(realmListFailure);
        },
        readFile() {
          return Promise.resolve(new Uint8Array());
        },
      },
      BUDGETS,
    ),
    (error: unknown) => error === realmListFailure,
  );

  const genericReadFailure: ReadOnlyFileTree = {
    listDirectory() {
      return Promise.resolve([{ kind: "file", name: "page.md" }]);
    },
    readFile() {
      return Promise.reject(new Error(`${ROOT}/secret`));
    },
  };
  await assert.rejects(
    loadRealmText(genericReadFailure, BUDGETS),
    expectCode("IO_ERROR"),
  );

  const realmReadFailure = new RealmLoadError("SYMLINK_NOT_ALLOWED");
  await assert.rejects(
    loadRealmText(
      {
        listDirectory() {
          return Promise.resolve([{ kind: "file", name: "page.md" }]);
        },
        readFile() {
          return Promise.reject(realmReadFailure);
        },
      },
      BUDGETS,
    ),
    (error: unknown) => error === realmReadFailure,
  );

  const duplicateAstralPaths: ReadOnlyFileTree = {
    listDirectory() {
      return Promise.resolve([
        { kind: "file", name: "\u{10000}.md" },
        { kind: "file", name: "\u{10000}.md" },
      ]);
    },
    readFile() {
      return Promise.resolve(new Uint8Array());
    },
  };
  assert.equal((await loadRealmText(duplicateAstralPaths, BUDGETS)).length, 2);
});

test("Node adapter sanitizes IO and rejects non-files", async (context) => {
  const root = workspace();
  const tree = createNodeReadOnlyFileTree(root);
  try {
    await assert.rejects(tree.listDirectory(["missing"]), expectCode("IO_ERROR"));
    await assert.rejects(tree.readFile([".atlas", "missing"]), expectCode("IO_ERROR"));
    mkdirSync(join(root, ".atlas", "directory"));
    await assert.rejects(
      tree.readFile([".atlas", "directory"]),
      expectCode("UNSUPPORTED_ENTRY"),
    );

    const target = join(root, ".atlas", "target");
    const link = join(root, ".atlas", "link");
    writeFileSync(target, "target");
    try {
      symlinkSync(target, link);
    } catch (error: unknown) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        context.skip(`symbolic links unavailable: ${code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      tree.readFile([".atlas", "link"]),
      expectCode("SYMLINK_NOT_ALLOWED"),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("Node adapter classifies unsupported filesystem entries", async (context) => {
  if (process.platform === "win32") {
    context.skip("Unix domain sockets are not filesystem entries on Windows.");
    return;
  }
  const root = workspace();
  const fifoPath = join(root, ".atlas", "fifo");
  try {
    execFileSync("mkfifo", [fifoPath]);
    await assert.rejects(
      loadRealmText(createNodeReadOnlyFileTree(root), BUDGETS),
      expectCode("UNSUPPORTED_ENTRY"),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
