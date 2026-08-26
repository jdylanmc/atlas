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
      killSignal: "SIGKILL",
      timeout: 180_000,
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
    { cwd: ROOT, killSignal: "SIGKILL", stdio: "ignore", timeout: 180_000 },
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

  // The consumer is seeded with this repository's own verified lockfile, and
  // that is what makes an offline install possible at all. `npm ci` populates
  // the cache with tarballs keyed by resolved URL; it never caches a packument.
  // `npm install <tarball>` into a directory with no lockfile has to build an
  // ideal tree, which needs a packument for every dependency, so under
  // `--offline` it fails with ENOTCACHED on any cache but a developer's warm
  // one. With a lockfile there is nothing to resolve: npm reads the exact
  // versions, integrity hashes, and resolved URLs it was given.
  //
  // The consumer must not borrow the SDK's `name` together with an `exports`
  // map, or a bare specifier would self-resolve to the consumer root instead of
  // `node_modules` and silently destroy the isolation this function exists to
  // create. Versions are pinned by the seeded lockfile, and `npm ci` verifies
  // each package against the `integrity` hash it records; there is nothing left
  // for this function to assert about them that npm has not already enforced.
  const sdkPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    readonly dependencies: Readonly<Record<string, string>>;
  };
  const sdkLock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  const consumerPackage = {
    dependencies: sdkPackage.dependencies,
    name: "atlas-consumer",
    private: true,
    version: "0.0.0",
  };
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify(consumerPackage, null, 2)}\n`,
  );
  const consumerLock = {
    ...sdkLock,
    name: consumerPackage.name,
    packages: {
      ...sdkLock.packages,
      "": {
        dependencies: sdkPackage.dependencies,
        name: consumerPackage.name,
        version: consumerPackage.version,
      },
    },
    version: consumerPackage.version,
  };
  writeFileSync(
    join(consumer, "package-lock.json"),
    `${JSON.stringify(consumerLock, null, 2)}\n`,
  );

  const offlineInstall = {
    cwd: consumer,
    killSignal: "SIGKILL" as const,
    stdio: "ignore" as const,
    timeout: 180_000,
  };
  execFileSync(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"],
    offlineInstall,
  );
  execFileSync(
    "npm",
    [
      "install",
      packArtifact(join(workspace, "artifact")),
      "--omit=dev",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--silent",
    ],
    offlineInstall,
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
  // commit rather than a working-tree file. Global and system Git configuration
  // are neutralized: an operator with `commit.gpgsign` would otherwise send this
  // into a `pinentry` prompt that blocks forever, and a synchronous test body
  // has nothing above it that can interrupt.
  const git = {
    cwd: consumer,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
    killSignal: "SIGKILL" as const,
    stdio: "ignore" as const,
    timeout: 30_000,
  };
  for (const argv of [
    ["init", "--quiet", "--initial-branch=main"],
    ["config", "user.email", "atlas@example.invalid"],
    ["config", "user.name", "Atlas Consumer"],
    ["add", "--all"],
    ["commit", "--quiet", "-m", "initialize atlas"],
  ]) {
    execFileSync("git", argv, git);
  }
  return consumer;
}

/**
 * Blocks outbound sockets in the child process. Only the network half of the
 * guard the retired clean-clone test carried is restored: its filesystem half
 * wrapped `node:fs`, which the module loader does not read through, so it could
 * never have blocked the resolution it advertised. Patching
 * `net.Socket.prototype.connect` does work, and it is the only executable check
 * behind the runtime contract in `README.md` that an Atlas command never calls
 * a network service.
 */
function writeNetworkGuard(path: string): void {
  writeFileSync(
    path,
    `import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
net.Socket.prototype.connect = function blockedConnect() {
  throw new Error("network access blocked");
};
syncBuiltinESMExports();
`,
  );
}

function runInstalled(
  consumer: string,
  guard: string,
  arguments_: readonly string[],
): InstalledCommandResult {
  const result = spawnSync(
    process.execPath,
    [join(consumer, "node_modules", ".bin", "atlas"), ...arguments_],
    {
      cwd: consumer,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env["NODE_OPTIONS"] ?? ""} --import=${guard}`.trim(),
      },
      killSignal: "SIGKILL",
      timeout: 120_000,
    },
  );
  assert.equal(result.error, undefined);
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

// No `{ timeout }` on this test on purpose. Its body is synchronous, so it never
// yields to the runner's event loop and a declared test timeout can never fire -
// it would read as a guarantee while bounding nothing. Every child process
// carries its own timeout and SIGKILL instead, which is a bound that actually
// holds and keeps the cleanup in `finally` reachable.
test("the installed package lints and explores an Atlas with production dependencies only", () => {
  const workspace = mkdtempSync(join(tmpdir(), "atlas-installed-"));
  try {
    const consumer = createConsumer(workspace);
    assert.ok(!consumer.startsWith(ROOT));

    const guard = join(workspace, "network_guard.mjs");
    writeNetworkGuard(guard);

    // Positive control. A guard nothing can trip is indistinguishable from a
    // guard that is not armed, and the previous version of this test shipped
    // exactly that. Prove the injection works before trusting what it permits.
    const control = join(workspace, "control.mjs");
    writeFileSync(
      control,
      'import net from "node:net";\nnet.connect(1, "127.0.0.1");\n',
    );
    const armed = spawnSync(process.execPath, [control], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env["NODE_OPTIONS"] ?? ""} --import=${guard}`.trim(),
      },
      killSignal: "SIGKILL",
      timeout: 30_000,
    });
    assert.notEqual(armed.status, 0, "the network guard did not arm");
    assert.match(armed.stderr, /network access blocked/u);

    const lint = runInstalled(consumer, guard, [
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

    const explore = runInstalled(consumer, guard, [
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
});
