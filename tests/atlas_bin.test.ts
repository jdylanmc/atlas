import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { isAtlasBinEntrypoint } from "../scripts/atlas_bin.ts";

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "atlas-bin");

test("installed Atlas bin detects npm shim symlinks as its entrypoint", () => {
  rmSync(WORKSPACE, { force: true, recursive: true });
  mkdirSync(WORKSPACE, { recursive: true });
  const real = join(WORKSPACE, "atlas_bin.js");
  const link = join(WORKSPACE, "atlas");
  writeFileSync(real, "#!/usr/bin/env node\n");
  symlinkSync(real, link);
  try {
    assert.equal(isAtlasBinEntrypoint(pathToFileURL(real).href, link), true);
    assert.equal(isAtlasBinEntrypoint(pathToFileURL(real).href, undefined), false);
    assert.equal(
      isAtlasBinEntrypoint(pathToFileURL(real).href, join(WORKSPACE, "missing")),
      false,
    );
  } finally {
    rmSync(WORKSPACE, { force: true, recursive: true });
  }
});
