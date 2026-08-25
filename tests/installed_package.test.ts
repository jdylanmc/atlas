import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  atlasInitializationFiles,
  initialAtlasInitializationWorkflowState,
} from "../src/operations/initialize_operation.ts";
import { lintCommandExitCodes } from "../src/interfaces/lint_command.ts";
import { exploreCommandExitCodes } from "../src/interfaces/explore_command.ts";

// Issue #204 retired the assembled-bundle model, and with it the only test that
// ran Atlas commands under production-only conditions. The bundle is gone; the
// properties it proved are not, because ADR-0002 made the published package the
// way an operator obtains Atlas SDK. This installs the packed artifact with dev
// dependencies omitted and drives the installed executable, so a runtime import
// that is only satisfied by a development dependency fails here rather than on
// an adopter's first command.

const ROOT = resolve(import.meta.dirname, "..");

// The consumer lives outside this repository on purpose. Node resolves a bare
// specifier by walking parent directories, so a consumer nested under the repo
// would find the development `node_modules` and satisfy an import the published
// package does not actually declare. That is not a hypothetical: this test was
// first written inside `.test-workspaces/` and passed while `yaml` was moved to
// a development dependency, proving nothing at all.
let WORKSPACE = "";

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function packArtifact(): string {
  const destination = join(WORKSPACE, "artifact");
  mkdirSync(destination, { recursive: true });
  // `dist/` is already built by the coverage gate that runs this suite, so the
  // artifact is packed without lifecycle scripts rather than rebuilt here.
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", destination, "--quiet"],
    { cwd: ROOT, stdio: "ignore" },
  );
  const [tarball] = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
  assert.ok(tarball !== undefined, "npm pack produced no tarball");
  return join(destination, tarball);
}

/**
 * A consumer: its own directory, its own Git history, and Atlas SDK installed
 * from the packed artifact with production dependencies only. It shares no
 * `node_modules` and no module cache with the session running the test.
 */
function createConsumer(tarball: string): string {
  const consumer = join(WORKSPACE, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "atlas-consumer", private: true, version: "0.0.0" }, null, 2)}\n`,
  );
  execFileSync(
    "npm",
    ["install", tarball, "--omit=dev", "--ignore-scripts", "--quiet"],
    {
      cwd: consumer,
      stdio: "ignore",
    },
  );

  const state = initialAtlasInitializationWorkflowState({
    baseSnapshotDigest: "0".repeat(64),
    proposalBranch: "atlas/initialize",
    targetBranch: "main",
    targetHead: "0".repeat(40),
  });
  for (const file of atlasInitializationFiles(state)) {
    const destination = join(consumer, file.path);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, file.bytes);
  }

  // Atlas Snapshot capture reads committed bytes, so the Atlas must be a real
  // commit rather than a working-tree file.
  for (const argv of [
    ["init", "--quiet", "--initial-branch=main"],
    ["config", "user.email", "atlas@example.invalid"],
    ["config", "user.name", "Atlas Consumer"],
    ["add", "--all"],
    ["commit", "--quiet", "-m", "initialize atlas"],
  ]) {
    execFileSync("git", argv, { cwd: consumer, stdio: "ignore" });
  }
  return consumer;
}

function writeRuntimeGuard(path: string): void {
  writeFileSync(
    path,
    `import fs from "node:fs";
import net from "node:net";
import { resolve, sep } from "node:path";
import { syncBuiltinESMExports } from "node:module";
const host = process.env.ATLAS_RUNTIME_GUARD_HOST;
if (host) {
  const normalizedHost = resolve(host);
  const guarded = new Set([
    resolve(normalizedHost, "package.json"),
    resolve(normalizedHost, "package-lock.json"),
    resolve(normalizedHost, "npm-shrinkwrap.json"),
  ]);
  const nodeModulesPrefix = resolve(normalizedHost, "node_modules") + sep;
  function assertAllowed(path) {
    if (typeof path !== "string") return;
    const normalized = resolve(path);
    if (guarded.has(normalized) || normalized.startsWith(nodeModulesPrefix)) {
      throw new Error("host package graph access blocked: " + normalized);
    }
  }
  for (const name of ["readFileSync", "readdirSync", "lstatSync", "statSync", "openSync", "writeFileSync"]) {
    const original = fs[name].bind(fs);
    fs[name] = (path, ...args) => {
      assertAllowed(path);
      return original(path, ...args);
    };
  }
}
net.Socket.prototype.connect = function blockedConnect() {
  throw new Error("network access blocked");
};
syncBuiltinESMExports();
`,
  );
}

function runInstalled(consumer: string, arguments_: readonly string[]): CommandResult {
  const runtimeGuard = join(WORKSPACE, "runtime_guard.mjs");
  writeRuntimeGuard(runtimeGuard);
  const result = spawnSync(
    process.execPath,
    [join(consumer, "node_modules", ".bin", "atlas"), ...arguments_],
    {
      cwd: consumer,
      encoding: "utf8",
      env: {
        ...process.env,
        ATLAS_RUNTIME_GUARD_HOST: ROOT,
        NODE_OPTIONS: `--import=${runtimeGuard}`,
      },
    },
  );
  assert.equal(result.error, undefined);
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

test(
  "the installed package lints and explores an Atlas with production dependencies only",
  { timeout: 180_000 },
  () => {
    rmSync(WORKSPACE, { force: true, recursive: true });
    WORKSPACE = mkdtempSync(join(tmpdir(), "atlas-installed-"));
    const consumer = createConsumer(packArtifact());

    const lint = runInstalled(consumer, [
      "lint",
      "--machine",
      "--atlas-host-directory",
      consumer,
    ]);
    assert.equal(lint.status, lintCommandExitCodes.success, lint.stderr);
    const lintResult = JSON.parse(lint.stdout) as {
      readonly completion: string;
      readonly disposition: string;
    };
    assert.equal(lintResult.completion, "completed");
    assert.equal(lintResult.disposition, "success");

    const explore = runInstalled(consumer, [
      "explore",
      "--machine",
      "Home Atlas",
      "--atlas-host-directory",
      consumer,
    ]);
    assert.equal(explore.status, exploreCommandExitCodes.success, explore.stderr);
    const exploreResult = JSON.parse(explore.stdout) as {
      readonly completion: string;
      readonly handoff: { readonly homeAtlas: { readonly state: string } };
    };
    assert.equal(exploreResult.completion, "completed");
    assert.equal(exploreResult.handoff.homeAtlas.state, "known");

    // The consumer resolved Atlas SDK from its own installation, never from the
    // development tree that packed it.
    assert.ok(!consumer.startsWith(ROOT));
    rmSync(WORKSPACE, { force: true, recursive: true });
  },
);
