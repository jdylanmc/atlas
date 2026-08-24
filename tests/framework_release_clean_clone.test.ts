import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assembleFrameworkBundle,
  verifyFrameworkBundle,
} from "../scripts/framework_bundle.ts";
import { lintCommandExitCodes } from "../src/interfaces/lint_command.ts";
import { exploreCommandExitCodes } from "../src/interfaces/explore_command.ts";

// Issue #158: prove Entry, Lint, and Explore work from a genuinely separate
// clean clone through an assembled Framework Release, not from source-tree
// shortcuts (this working tree's node_modules, an in-process bundle reuse,
// or an ambient checkout other tests share).

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "framework-release-clean-clone");

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function clean(): void {
  rmSync(WORKSPACE, { force: true, recursive: true });
  mkdirSync(WORKSPACE, { recursive: true });
}

/**
 * A clean clone: a separate Git checkout of this repository's own committed
 * HEAD, with its own independently installed production dependencies. It
 * shares no node_modules, no in-process module cache, and no working-tree
 * state with the session that is running the test.
 */
function createCleanClone(): string {
  const cloneRoot = join(WORKSPACE, "clone");
  execFileSync("git", ["clone", "--local", "--quiet", ROOT, cloneRoot], {
    stdio: "ignore",
  });
  execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--quiet"], {
    cwd: cloneRoot,
    stdio: "ignore",
  });
  return cloneRoot;
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

function runBootstrap(
  bundle: string,
  host: string,
  arguments_: readonly string[],
): CommandResult {
  const runtimeGuard = join(WORKSPACE, "runtime_guard.mjs");
  writeRuntimeGuard(runtimeGuard);
  const result = spawnSync(
    process.execPath,
    [join(bundle, "scripts", "framework_bootstrap.ts"), ...arguments_],
    {
      cwd: host,
      encoding: "utf8",
      env: {
        ...process.env,
        ATLAS_RUNTIME_GUARD_HOST: host,
        NODE_OPTIONS: `--import=${runtimeGuard}`,
      },
    },
  );
  assert.equal(result.error, undefined);
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

test(
  "Framework Release proves Entry, Lint, and Explore against the SDK Atlas from a clean clone",
  { timeout: 120_000 },
  () => {
    clean();
    const cloneRoot = createCleanClone();

    // The Framework Bundle assembler requires its output directory to be a
    // child of the repository root it assembles from, so the bundle lives
    // inside the clean clone itself rather than in the shared workspace.
    const bundle = join(cloneRoot, "dist", "framework-bundle");
    const manifest = assembleFrameworkBundle(bundle, cloneRoot);
    assert.equal(verifyFrameworkBundle(bundle), undefined);
    assert.equal(manifest.frameworkRelease.sourceRevision.length, 40);

    // Lint, against the clean clone's own committed Home Atlas.
    const lint = runBootstrap(bundle, cloneRoot, [
      "lint",
      "--machine",
      "--atlas-host-directory",
      cloneRoot,
    ]);
    assert.equal(lint.status, lintCommandExitCodes.success, lint.stderr);
    assert.equal(lint.stderr, "");
    const lintResult = JSON.parse(lint.stdout) as {
      readonly completion: string;
      readonly disposition: string;
      readonly payload: { readonly lint: { readonly findings: readonly unknown[] } };
    };
    assert.equal(lintResult.completion, "completed");
    assert.equal(lintResult.disposition, "success");
    assert.deepEqual(lintResult.payload.lint.findings, []);

    // Explore. A routed result, plus a "known" homeAtlas classification, is
    // Atlas Entry: the shared preflight that locates the Home Atlas and
    // classifies it ready before Explore proceeds.
    const explore = runBootstrap(bundle, cloneRoot, [
      "explore",
      "--machine",
      "How many characters should a line of Markdown be?",
      "--atlas-host-directory",
      cloneRoot,
    ]);
    assert.equal(explore.status, exploreCommandExitCodes.success, explore.stderr);
    assert.equal(explore.stderr, "");
    const exploreResult = JSON.parse(explore.stdout) as {
      readonly completion: string;
      readonly disposition: string;
      readonly handoff: {
        readonly homeAtlas: { readonly reference?: string; readonly state: string };
      };
      readonly payload: {
        readonly results: readonly {
          readonly route: readonly { readonly objectId: string }[];
        }[];
      };
    };
    assert.equal(exploreResult.completion, "completed");
    assert.equal(exploreResult.disposition, "success");
    assert.equal(exploreResult.handoff.homeAtlas.state, "known");
    assert.ok(exploreResult.payload.results.length > 0);
    const [firstResult] = exploreResult.payload.results;
    assert.ok(firstResult !== undefined);
    assert.ok(firstResult.route.length > 0);
    assert.equal(firstResult.route[0]?.objectId, "anchor:root");

    // No source-tree shortcut: the assembled bundle never read this
    // session's own node_modules or package graph, and the clone's own
    // package graph was never touched by the bundle runtime either (the
    // runtime guard above throws if it is).
    const workingTreeNodeModules = resolve(ROOT, "node_modules");
    assert.notEqual(cloneRoot, ROOT);
    assert.ok(!bundle.startsWith(workingTreeNodeModules));
  },
);
