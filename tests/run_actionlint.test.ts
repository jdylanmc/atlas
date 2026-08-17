import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  architectureName,
  downloadArchive,
  platformName,
  runActionlint,
  sha256,
} from "../scripts/run_actionlint.ts";

const ROOT = resolve(import.meta.dirname, "..");

function scratchDirectory(): string {
  const directory = join(
    ROOT,
    ".test-workspaces",
    `actionlint-${String(process.pid)}-${randomUUID()}`,
  );
  mkdirSync(directory, { recursive: true });
  return directory;
}

test("Actionlint platform and architecture pins fail closed", () => {
  assert.equal(platformName("darwin"), "darwin");
  assert.equal(platformName("linux"), "linux");
  assert.equal(platformName("win32"), "windows");
  assert.throws(() => platformName("aix"), /not pinned for platform aix/);
  assert.equal(architectureName("x64"), "amd64");
  assert.equal(architectureName("arm64"), "arm64");
  assert.throws(() => architectureName("ia32"), /not pinned for architecture ia32/);
});

test("Actionlint archive download verifies content before writing", async () => {
  const workspace = scratchDirectory();
  const archive = join(workspace, "tool.tar.gz");
  const data = new TextEncoder().encode("trusted archive");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(data, { status: 200 }));
  try {
    await downloadArchive(
      archive,
      "https://example.invalid",
      "tool.tar.gz",
      sha256(data),
    );
    assert.deepEqual(readFileSync(archive), Buffer.from(data));
    await assert.rejects(
      downloadArchive(archive, "https://example.invalid", "tool.tar.gz", "invalid"),
      /checksum mismatch/,
    );
    globalThis.fetch = () =>
      Promise.resolve(new Response(null, { status: 503, statusText: "Unavailable" }));
    await assert.rejects(
      downloadArchive(archive, "https://example.invalid", "tool.tar.gz", sha256(data)),
      /503 Unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Actionlint runner wires pinned tools and caller arguments", async () => {
  const calls: Array<[string, readonly string[], { cwd: string; stdio: "inherit" }]> =
    [];
  const result = await runActionlint(["workflow.yml"], {
    prepareActionlint: () => Promise.resolve("/tools/actionlint"),
    prepareShellCheck: () => Promise.resolve("/tools/shellcheck"),
    execute: (file, args, options) => {
      calls.push([file, args, options]);
      return Buffer.alloc(0);
    },
  });
  assert.equal(result, 0);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call[0], "/tools/actionlint");
  assert.deepEqual(call[1], [
    "-shellcheck",
    "/tools/shellcheck",
    "-pyflakes",
    "",
    "workflow.yml",
  ]);
  assert.deepEqual(call[2], {
    cwd: ROOT,
    stdio: "inherit",
  });
});
