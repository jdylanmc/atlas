import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE = resolve(ROOT, ".test-workspaces/source-symlinks");

function assertNoSymbolicLinks(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const stat = lstatSync(path);
  assert.equal(stat.isSymbolicLink(), false, `symbolic link: ${path}`);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      assertNoSymbolicLinks(join(path, entry));
    }
  }
}

test("repository product source contains no symbolic links", () => {
  assertNoSymbolicLinks(resolve(ROOT, "src"));
});

test("source scanner rejects symbolic links", (context) => {
  rmSync(WORKSPACE, { force: true, recursive: true });
  mkdirSync(WORKSPACE, { recursive: true });
  writeFileSync(join(WORKSPACE, "target.ts"), "");
  try {
    symlinkSync("target.ts", join(WORKSPACE, "link.ts"), "file");
  } catch (error: unknown) {
    rmSync(WORKSPACE, { force: true, recursive: true });
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

  try {
    assert.throws(() => {
      assertNoSymbolicLinks(WORKSPACE);
    }, /symbolic link:/u);
  } finally {
    rmSync(WORKSPACE, { force: true, recursive: true });
  }
});
