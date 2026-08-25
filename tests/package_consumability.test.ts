import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import {
  atlasInitializationFiles,
  initialAtlasInitializationWorkflowState,
} from "../src/operations/initialize_operation.ts";
import { lintCommandExitCodes } from "../src/interfaces/lint_command.ts";
import { exploreCommandExitCodes } from "../src/interfaces/explore_command.ts";

const ROOT = resolve(import.meta.dirname, "..");

interface PackageContract {
  readonly bin?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly files?: readonly string[];
  readonly private?: boolean;
  readonly publishConfig?: { readonly access?: string };
  readonly version?: string;
}

interface PackedFile {
  readonly path: string;
}

interface PackDryRun {
  readonly files: readonly PackedFile[];
  readonly version: string;
}

function readPackage(): PackageContract {
  return JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as PackageContract;
}

function walkFiles(directory: string): readonly string[] {
  const paths: string[] = [];
  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      paths.push(
        absolute
          .slice(ROOT.length + 1)
          .split(sep)
          .join("/"),
      );
    }
  }
  walk(directory);
  return paths.toSorted();
}

function packDryRun(): PackDryRun {
  const output = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--silent", "--ignore-scripts=false"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  const [pack] = JSON.parse(output) as readonly PackDryRun[];
  assert.ok(pack);
  return pack;
}

test("package metadata declares the supported consumption contract", () => {
  const packageJson = readPackage();

  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.publishConfig?.access, "public");
  assert.deepEqual(packageJson.bin, { atlas: "./dist/scripts/atlas_bin.js" });
  assert.deepEqual(packageJson.files, ["README.md", "dist/**/*.d.ts", "dist/**/*.js"]);
  assert.deepEqual(packageJson.exports, {
    ".": {
      types: "./dist/src/index.d.ts",
      default: "./dist/src/index.js",
    },
    "./package.json": "./package.json",
  });
});

test("source public API barrel exposes the same root contract", async () => {
  const atlas = (await import("../src/index.ts")) as {
    readonly lintCommandUsage: string;
    readonly runLintCommandOperation: unknown;
  };

  assert.match(atlas.lintCommandUsage, /^usage: atlas lint/u);
  assert.equal(typeof atlas.runLintCommandOperation, "function");
});

test("package root is importable and internal subpaths are private", async () => {
  const atlas = (await import("@jdylanmc/atlas")) as {
    readonly lintCommandUsage: string;
    readonly runLintCommandOperation: unknown;
  };

  assert.match(atlas.lintCommandUsage, /^usage: atlas lint/u);
  assert.equal(typeof atlas.runLintCommandOperation, "function");
  const internalSpecifier = "@jdylanmc/atlas/src/operations/lint_operation.ts";
  await assert.rejects(import(internalSpecifier), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
});

test("npm artifact contains only the runtime allowlist", () => {
  assert.equal(statSync(join(ROOT, "dist", "scripts", "atlas.js")).isFile(), true);
  const pack = packDryRun();
  assert.equal(pack.version, "0.1.0");

  const actual = pack.files.map((file) => file.path).toSorted();
  const expected = [
    "README.md",
    "package.json",
    ...walkFiles(join(ROOT, "dist")).filter(
      (path) => path.endsWith(".d.ts") || path.endsWith(".js"),
    ),
  ].toSorted();
  assert.deepEqual(actual, expected);
  assert.equal(
    actual.some((path) => path.startsWith("tests/")),
    false,
  );
  assert.equal(
    actual.some((path) => path.startsWith(".test-workspaces/")),
    false,
  );
  assert.equal(
    actual.some((path) => path.startsWith("src/")),
    false,
  );
  assert.equal(
    actual.some((path) => path.includes("package-lock.json")),
    false,
  );
});

test("prepack rebuild removes ignored dist files before packaging", () => {
  const injectedPath = join(ROOT, "dist", "proof-unreviewed.js");
  writeFileSync(injectedPath, 'console.error("unreviewed");\n');
  assert.equal(existsSync(injectedPath), true);

  const pack = packDryRun();
  const actual = pack.files.map((file) => file.path).toSorted();

  assert.equal(existsSync(injectedPath), false);
  assert.equal(actual.includes("dist/proof-unreviewed.js"), false);
});

// Issue #204 retired the assembled-bundle model, and with it the only test that
// ran Atlas commands under production-only conditions. The bundle is gone; the
// properties it proved are not, because ADR-0002 made the published package the
// way an operator obtains Atlas SDK. This installs the packed artifact with
// development dependencies omitted and drives the installed executable, so a
// runtime import that only a development dependency satisfies fails here rather
// than on an adopter's first command.
//
// It lives in this file rather than its own so that it cannot run concurrently
// with the packing tests above. Every `npm pack` here rebuilds `dist/` through
// `prepack`, whose first act is to delete it; two such tests in separate files
// race, and the loser installs a truncated tarball.

interface InstalledCommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function packArtifact(destination: string): string {
  mkdirSync(destination, { recursive: true });
  // `--ignore-scripts=false` runs `prepack`, so the artifact under test is built
  // by the same path `package:publish` uses rather than from whatever `dist/`
  // happened to contain when this suite started.
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts=false", "--pack-destination", destination, "--silent"],
    { cwd: ROOT, stdio: "ignore" },
  );
  const [tarball] = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
  assert.ok(tarball !== undefined, "npm pack produced no tarball");
  return join(destination, tarball);
}

/**
 * A consumer with its own directory, its own Git history, and Atlas SDK
 * installed from the packed artifact with production dependencies only.
 *
 * It lives under the operating system temporary directory rather than inside
 * this repository, and that placement is the whole mechanism: Node resolves a
 * bare specifier by walking parent directories, so a consumer nested under the
 * repository would reach the development `node_modules` and satisfy an import
 * the published package never declared. An earlier version of this test was
 * nested, and passed while `yaml` was a development dependency. Monkey-patching
 * `node:fs` does not substitute for this, because the module loader does not
 * read through it.
 */
function createConsumer(workspace: string): string {
  const consumer = join(workspace, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "atlas-consumer", private: true, version: "0.0.0" }, null, 2)}\n`,
  );
  execFileSync(
    "npm",
    [
      "install",
      packArtifact(join(workspace, "artifact")),
      "--omit=dev",
      "--ignore-scripts",
      "--silent",
    ],
    { cwd: consumer, stdio: "ignore" },
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

function runInstalled(
  consumer: string,
  arguments_: readonly string[],
): InstalledCommandResult {
  const result = spawnSync(
    process.execPath,
    [join(consumer, "node_modules", ".bin", "atlas"), ...arguments_],
    { cwd: consumer, encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

test(
  "the installed package lints and explores an Atlas with production dependencies only",
  { timeout: 180_000 },
  () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-installed-"));
    try {
      const consumer = createConsumer(workspace);
      assert.ok(!consumer.startsWith(ROOT));

      const lint = runInstalled(consumer, [
        "lint",
        "--machine",
        "--atlas-host-directory",
        consumer,
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

      const explore = runInstalled(consumer, [
        "explore",
        "--machine",
        "Home Atlas",
        "--atlas-host-directory",
        consumer,
      ]);
      assert.equal(explore.status, exploreCommandExitCodes.success, explore.stderr);
      assert.equal(explore.stderr, "");
      const exploreResult = JSON.parse(explore.stdout) as {
        readonly completion: string;
        readonly disposition: string;
        readonly handoff: { readonly homeAtlas: { readonly state: string } };
        readonly payload: {
          readonly results: readonly {
            readonly route: readonly { readonly objectId: string }[];
          }[];
        };
      };
      assert.equal(exploreResult.completion, "completed");
      assert.equal(exploreResult.disposition, "success");
      assert.equal(exploreResult.handoff.homeAtlas.state, "known");
      // Reachability is not function: an installed build whose search provider
      // returned nothing would still complete, still classify the Home Atlas,
      // and still exit zero.
      assert.ok(exploreResult.payload.results.length > 0);
      const [firstResult] = exploreResult.payload.results;
      assert.ok(firstResult !== undefined);
      assert.equal(firstResult.route[0]?.objectId, "anchor:root");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  },
);
