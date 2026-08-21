import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertReleaseInputsClean,
  assembleFrameworkBundle,
  frameworkReleaseSourceRevision,
  main as frameworkBundleMain,
  verifyFrameworkBundle,
} from "../scripts/framework_bundle.ts";
import {
  main as frameworkRuntimeMain,
  verifyRuntimeBundle,
} from "../scripts/framework_bootstrap.ts";
import { frameworkReleaseOwnedPathRoots } from "../scripts/framework_release_inventory.ts";
import { runtimeEntrypoint } from "../scripts/framework_runtime.ts";
import {
  frameworkReleaseIdentity,
  inventoryPaths,
  parseFrameworkReleaseManifest,
  type FrameworkRelease,
} from "../src/framework/framework_release.ts";
import { lintCommandExitCodes } from "../src/interfaces/lint_command.ts";
import { assertGrowthRatio } from "./growth.ts";

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "framework-bundle");
const FIXTURE = resolve(ROOT, "tests", "fixtures", "complete-atlas");

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function clean(): void {
  rmSync(WORKSPACE, { force: true, recursive: true });
  mkdirSync(WORKSPACE, { recursive: true });
}

function assemble(name: string): string {
  const bundle = join(WORKSPACE, name);
  assembleFrameworkBundle(bundle);
  return bundle;
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

function runRuntime(bundle: string, host: string): CommandResult {
  const runtimeGuard = join(WORKSPACE, "runtime_guard.mjs");
  writeRuntimeGuard(runtimeGuard);
  const result = spawnSync(
    process.execPath,
    [
      join(bundle, "scripts", "framework_bootstrap.ts"),
      "lint",
      "--machine",
      "--atlas-host-directory",
      host,
    ],
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

async function captureOutput(run: () => number | Promise<number>): Promise<{
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    stdout += chunk.toString();
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    stderr += chunk.toString();
    return true;
  };
  try {
    return { code: await run(), stderr, stdout };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

test("Framework Release identity and inventory path helpers are deterministic", () => {
  const release: FrameworkRelease = Object.freeze({
    id: "ignored",
    packageName: "@jdylanmc/atlas",
    sourceRevision: "abc123",
    version: "0.0.0",
  });
  assert.equal(frameworkReleaseIdentity(release), "@jdylanmc/atlas@0.0.0+abc123");
  assert.deepEqual(
    inventoryPaths({
      "framework-release-manifest-schema": "1.0.0",
      atlasContracts: { atlasLintResult: "1.0.0", operationResult: "1.0.0" },
      declaredInventoryRoots: [],
      frameworkRelease: release,
      inventory: [
        { bytes: 1, kind: "framework-runtime", path: "z", sha256: "b" },
        { bytes: 1, kind: "framework-runtime", path: "a", sha256: "a" },
      ],
      migrationPaths: { from: [], to: [] },
      productionDependencies: [],
      supportedEnvironments: { ambientGit: "not-required-for-lint", node: ">=24" },
    }),
    ["a", "z"],
  );
});

test("Framework Release Manifest parser rejects missing compatibility sections", () => {
  const valid = {
    "framework-release-manifest-schema": "1.0.0",
    atlasContracts: { atlasLintResult: "1.0.0", operationResult: "1.0.0" },
    declaredInventoryRoots: [...frameworkReleaseOwnedPathRoots],
    frameworkRelease: {
      id: "@jdylanmc/atlas@0.0.0+abc123",
      packageName: "@jdylanmc/atlas",
      sourceRevision: "abc123",
      version: "0.0.0",
    },
    inventory: [
      {
        bytes: 1,
        kind: "framework-runtime",
        path: "scripts/framework_bootstrap.ts",
        sha256: "0".repeat(64),
      },
    ],
    migrationPaths: { from: [], to: [] },
    productionDependencies: [],
    supportedEnvironments: { ambientGit: "not-required-for-lint", node: ">=24" },
  };

  assert.equal(parseFrameworkReleaseManifest(valid).state, "parsed");
  assert.equal(parseFrameworkReleaseManifest(null).state, "failed");
  assert.equal(
    parseFrameworkReleaseManifest({
      ...valid,
      "framework-release-manifest-schema": "2.0.0",
    }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({
      ...valid,
      frameworkRelease: "not-release",
    }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({
      ...valid,
      frameworkRelease: { ...valid.frameworkRelease, sourceRevision: 1 },
    }).state,
    "failed",
  );
  for (const key of [
    "supportedEnvironments",
    "atlasContracts",
    "migrationPaths",
    "declaredInventoryRoots",
  ] as const) {
    const invalid = Object.fromEntries(
      Object.entries(valid).filter(([entryKey]) => entryKey !== key),
    );
    const result = parseFrameworkReleaseManifest(invalid);
    assert.equal(result.state, "failed", key);
    assert.equal(result.code, "ATLAS_FRAMEWORK_MANIFEST_INVALID");
  }

  assert.equal(
    parseFrameworkReleaseManifest({ ...valid, productionDependencies: "none" }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({ ...valid, supportedEnvironments: { node: 24 } })
      .state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({ ...valid, declaredInventoryRoots: [1] }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({
      ...valid,
      atlasContracts: { atlasLintResult: 1, operationResult: "1.0.0" },
    }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({ ...valid, migrationPaths: { from: [1], to: [] } })
      .state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({ ...valid, inventory: "none" }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({
      ...valid,
      inventory: ["not-entry"],
    }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({
      ...valid,
      inventory: [{ bytes: -1, kind: "framework-runtime", path: "x", sha256: "0" }],
    }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({
      ...valid,
      productionDependencies: ["not-dependency"],
    }).state,
    "failed",
  );
  assert.equal(
    parseFrameworkReleaseManifest({
      ...valid,
      productionDependencies: [{ license: "MIT" }],
    }).state,
    "failed",
  );
});

test("Framework Bundle assembly produces byte-identical manifests across equivalent outputs", () => {
  clean();
  const first = assemble("bundle-a");
  const second = assemble("bundle-b");

  assert.equal(verifyFrameworkBundle(first), undefined);
  assert.equal(verifyFrameworkBundle(second), undefined);
  assert.equal(
    readFileSync(join(first, "framework-release-manifest.json"), "utf8"),
    readFileSync(join(second, "framework-release-manifest.json"), "utf8"),
  );
  assert.equal(
    readFileSync(join(first, "framework-release-manifest.sha256"), "utf8"),
    readFileSync(join(second, "framework-release-manifest.sha256"), "utf8"),
  );
});

test("Framework Bundle runtime lints a clean host without reading the host package graph or network", () => {
  clean();
  const bundle = assemble("bundle");
  const host = join(WORKSPACE, "host-with-package-traps");
  mkdirSync(host, { recursive: true });
  cpSync(resolve(FIXTURE, ".atlas"), join(host, ".atlas"), { recursive: true });
  writeFileSync(join(host, "package.json"), '{"scripts":{"postinstall":"exit 1"}}\n');
  writeFileSync(join(host, "package-lock.json"), "host lock must not be read\n");
  mkdirSync(join(host, "node_modules"));
  writeFileSync(join(host, "node_modules", "sentinel"), "host dependency graph\n");

  const beforePackage = readFileSync(join(host, "package.json"), "utf8");
  const command = runRuntime(bundle, host);

  assert.equal(command.status, lintCommandExitCodes.success, command.stderr);
  assert.equal(command.stderr, "");
  const parsed = JSON.parse(command.stdout) as {
    readonly completion: string;
    readonly disposition: string;
  };
  assert.equal(parsed.completion, "completed");
  assert.equal(parsed.disposition, "success");
  assert.equal(readFileSync(join(host, "package.json"), "utf8"), beforePackage);
  assert.equal(
    readFileSync(join(host, "node_modules", "sentinel"), "utf8"),
    "host dependency graph\n",
  );
});

test("Framework Bundle bootstrap has no static imports from bundle-resident modules", () => {
  const source = readFileSync(
    resolve(ROOT, "scripts", "framework_bootstrap.ts"),
    "utf8",
  );
  const staticImports = [
    ...source.matchAll(/^import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["'];/gmu),
  ].map((match) => match[1]);
  assert.deepEqual(
    staticImports.filter((specifier) => specifier?.startsWith("node:") === false),
    [],
  );
});

test("Framework Bundle manifest declares the release inventory roots it assembled", () => {
  clean();
  const bundle = assemble("declared-inventory");
  const manifest = JSON.parse(
    readFileSync(join(bundle, "framework-release-manifest.json"), "utf8"),
  ) as {
    readonly declaredInventoryRoots: readonly string[];
    readonly inventory: readonly { readonly path: string }[];
  };
  assert.deepEqual(manifest.declaredInventoryRoots, frameworkReleaseOwnedPathRoots);
  const sdkOwnedPaths = manifest.inventory
    .map((entry) => entry.path)
    .filter(
      (path) =>
        !path.startsWith("node_modules/") &&
        path !== "dependency-evidence.json" &&
        path !== "package.json",
    );
  assert.ok(
    sdkOwnedPaths.every((path) =>
      frameworkReleaseOwnedPathRoots.some(
        (root) => path === root || path.startsWith(`${root}/`),
      ),
    ),
  );
});

test("Framework Bundle command and runtime entry points report success and verification failures", async () => {
  clean();
  const output = join(WORKSPACE, "cli-bundle");
  const assembled = await captureOutput(() =>
    frameworkBundleMain(["assemble", "--output", output]),
  );
  assert.equal(assembled.code, 0, assembled.stderr);
  assert.match(assembled.stdout, /framework-release-manifest/u);

  const verified = await captureOutput(() =>
    frameworkBundleMain(["verify", "--bundle", output]),
  );
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(verified.stdout, "Framework Bundle verified.\n");

  const host = join(WORKSPACE, "runtime-host");
  mkdirSync(host, { recursive: true });
  cpSync(resolve(FIXTURE, ".atlas"), join(host, ".atlas"), { recursive: true });
  const runtime = await captureOutput(() =>
    frameworkRuntimeMain(["lint", "--machine", "--atlas-host-directory", host], output),
  );
  assert.equal(runtime.code, 0, runtime.stderr);
  assert.equal(
    (JSON.parse(runtime.stdout) as { readonly completion: string }).completion,
    "completed",
  );

  writeFileSync(join(output, "extra.txt"), "not inventoried\n");
  const failedRuntime = await captureOutput(() =>
    frameworkRuntimeMain(["lint", "--machine", "--atlas-host-directory", host], output),
  );
  assert.equal(failedRuntime.code, lintCommandExitCodes.operationNotCompleted);
  assert.match(failedRuntime.stderr, /unexpected file/u);
  assert.equal(
    (
      JSON.parse(failedRuntime.stdout) as {
        readonly handoff: {
          readonly validationState: {
            readonly findings: readonly { readonly code: string }[];
          };
        };
      }
    ).handoff.validationState.findings[0]?.code,
    "ATLAS_FRAMEWORK_BUNDLE_EXTRA_FILE",
  );

  assert.equal((await captureOutput(() => frameworkBundleMain(["assemble"]))).code, 64);
  assert.equal(
    (await captureOutput(() => frameworkBundleMain(["assemble", "--output", "--bad"])))
      .code,
    64,
  );
  assert.equal(
    (
      await captureOutput(() =>
        frameworkBundleMain(["assemble", "--output", output, "--output", output]),
      )
    ).code,
    64,
  );
  assert.equal((await captureOutput(() => frameworkBundleMain(["verify"]))).code, 64);
  assert.equal((await captureOutput(() => frameworkBundleMain(["bogus"]))).code, 64);
});

test("Framework Bundle bootstrap reports symlink traversal failures as values", () => {
  clean();
  const bundle = assemble("symlink");
  symlinkSync("package.json", join(bundle, "link"));
  const failure = verifyRuntimeBundle(bundle);
  assert.ok(failure);
  assert.equal(failure.code, "ATLAS_FRAMEWORK_BUNDLE_SYMLINK");
  assert.equal(runtimeEntrypoint(), "atlas-lint");
});

test("Framework Bundle runtime verification fails before Lint for source and manifest tampering", () => {
  clean();
  const sourceBundle = assemble("source");
  writeFileSync(join(sourceBundle, "src", "lint", "lint_atlas.ts"), "tampered\n");
  const sourceFailure = verifyRuntimeBundle(sourceBundle);
  assert.ok(sourceFailure);
  assert.equal(sourceFailure.code, "ATLAS_FRAMEWORK_BUNDLE_TAMPERED");
  assert.equal(sourceFailure.path, "src/lint/lint_atlas.ts");

  const manifestBundle = assemble("runtime-manifest");
  writeFileSync(join(manifestBundle, "framework-release-manifest.json"), "{}\n");
  const manifestFailure = verifyRuntimeBundle(manifestBundle);
  assert.ok(manifestFailure);
  assert.equal(manifestFailure.code, "ATLAS_FRAMEWORK_MANIFEST_TAMPERED");
  assert.equal(manifestFailure.path, "framework-release-manifest.json");
});

test("Framework Bundle bootstrap rejects runtime module tampering before executing it", async () => {
  clean();
  const bundle = assemble("bootstrap-tamper");
  const host = join(WORKSPACE, "bootstrap-host");
  mkdirSync(host, { recursive: true });
  cpSync(resolve(FIXTURE, ".atlas"), join(host, ".atlas"), { recursive: true });
  writeFileSync(
    join(bundle, "scripts", "framework_runtime.ts"),
    'console.log("PREVERIFY_PAYLOAD_EXECUTED");\n',
  );
  const result = await captureOutput(() =>
    frameworkRuntimeMain(["lint", "--machine", "--atlas-host-directory", host], bundle),
  );
  assert.equal(result.code, lintCommandExitCodes.operationNotCompleted);
  assert.doesNotMatch(result.stdout, /PREVERIFY_PAYLOAD_EXECUTED/u);
  assert.match(result.stdout, /ATLAS_FRAMEWORK_BUNDLE_TAMPERED/u);
});

test("Framework Bundle bootstrap rejects source module tampering before top-level payload execution", () => {
  clean();
  const bundle = assemble("bootstrap-source-tamper");
  const host = join(WORKSPACE, "bootstrap-source-host");
  mkdirSync(host, { recursive: true });
  cpSync(resolve(FIXTURE, ".atlas"), join(host, ".atlas"), { recursive: true });
  const target = join(bundle, "src", "framework", "framework_release.ts");
  writeFileSync(
    target,
    `console.log("BOOTSTRAP_IMPORT_PAYLOAD_EXECUTED");\n${readFileSync(target, "utf8")}`,
  );

  const command = spawnSync(
    process.execPath,
    [
      join(bundle, "scripts", "framework_bootstrap.ts"),
      "lint",
      "--machine",
      "--atlas-host-directory",
      host,
    ],
    { cwd: host, encoding: "utf8" },
  );

  assert.equal(command.status, lintCommandExitCodes.operationNotCompleted);
  assert.doesNotMatch(command.stdout, /BOOTSTRAP_IMPORT_PAYLOAD_EXECUTED/u);
  assert.match(command.stdout, /ATLAS_FRAMEWORK_BUNDLE_TAMPERED/u);
});

test("Framework Bundle verification names each integrity failure precisely", () => {
  clean();
  const dependencyBundle = assemble("dependency");
  writeFileSync(
    join(dependencyBundle, "node_modules", "ajv", "package.json"),
    "tampered\n",
  );
  const dependencyFailure = verifyFrameworkBundle(dependencyBundle);
  assert.ok(dependencyFailure);
  assert.equal(dependencyFailure.code, "ATLAS_FRAMEWORK_BUNDLE_TAMPERED");
  assert.equal(dependencyFailure.path, "node_modules/ajv/package.json");

  const manifestBundle = assemble("manifest");
  writeFileSync(join(manifestBundle, "framework-release-manifest.json"), "{}\n");
  const manifestFailure = verifyFrameworkBundle(manifestBundle);
  assert.ok(manifestFailure);
  assert.equal(manifestFailure.code, "ATLAS_FRAMEWORK_MANIFEST_TAMPERED");
  assert.equal(manifestFailure.path, "framework-release-manifest.json");

  const extraBundle = assemble("extra");
  writeFileSync(join(extraBundle, "extra.txt"), "not inventoried\n");
  const extraFailure = verifyFrameworkBundle(extraBundle);
  assert.ok(extraFailure);
  assert.equal(extraFailure.code, "ATLAS_FRAMEWORK_BUNDLE_EXTRA_FILE");
  assert.equal(extraFailure.path, "extra.txt");
});

test("Framework Bundle verification rejects inventory-only forged manifests", () => {
  clean();
  const bundle = assemble("inventory-only");
  const manifestPath = join(bundle, "framework-release-manifest.json");
  const digestPath = join(bundle, "framework-release-manifest.sha256");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  delete manifest["supportedEnvironments"];
  delete manifest["atlasContracts"];
  delete manifest["migrationPaths"];
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, serialized);
  writeFileSync(
    digestPath,
    `${createHash("sha256").update(serialized).digest("hex")}\n`,
  );
  const failure = verifyFrameworkBundle(bundle);
  assert.ok(failure);
  assert.equal(failure.code, "ATLAS_FRAMEWORK_MANIFEST_INVALID");
});

test("Framework Release identity is pinned to clean committed inputs", () => {
  clean();
  const cleanRevision = frameworkReleaseSourceRevision(ROOT);
  assert.match(cleanRevision, /^[0-9a-f]{40}$/u);

  const repo = join(WORKSPACE, "identity-repo");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "scripts", "atlas.ts"), "export {};\n");
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["add", "scripts/atlas.ts"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "atlas@example.invalid",
      GIT_AUTHOR_NAME: "Atlas",
      GIT_COMMITTER_EMAIL: "atlas@example.invalid",
      GIT_COMMITTER_NAME: "Atlas",
    },
    stdio: "ignore",
  });
  const committed = frameworkReleaseSourceRevision(repo);
  assert.equal(assertReleaseInputsClean(repo), undefined);

  execFileSync("git", ["tag", "release-test"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["checkout", "release-test"], { cwd: repo, stdio: "ignore" });
  assert.equal(frameworkReleaseSourceRevision(repo), committed);

  execFileSync("git", ["checkout", committed], { cwd: repo, stdio: "ignore" });
  assert.equal(frameworkReleaseSourceRevision(repo), committed);

  writeFileSync(join(repo, "scripts", "atlas.ts"), "export const dirty = true;\n");
  assert.throws(() => assertReleaseInputsClean(repo), /differ from HEAD/u);
});

test("Framework Bundle excludes development dependencies while keeping dependency and license evidence", () => {
  clean();
  const bundle = assemble("runtime-only");
  const manifest = JSON.parse(
    readFileSync(join(bundle, "framework-release-manifest.json"), "utf8"),
  ) as {
    readonly inventory: readonly { readonly path: string }[];
    readonly productionDependencies: readonly {
      readonly license: string;
      readonly licenseFiles: readonly string[];
      readonly name: string;
    }[];
  };
  const paths = manifest.inventory.map((entry) => entry.path);

  assert.equal(
    paths.some((path) => path.startsWith("node_modules/typescript/")),
    false,
  );
  assert.equal(
    paths.some((path) => path.startsWith("node_modules/eslint/")),
    false,
  );
  assert.ok(paths.includes("dependency-evidence.json"));
  assert.ok(
    manifest.productionDependencies.some((dependency) => dependency.name === "ajv"),
  );
  assert.ok(
    manifest.productionDependencies.every(
      (dependency) =>
        dependency.license !== "UNKNOWN" || dependency.licenseFiles.length > 0,
    ),
  );
});

test("Framework Bundle verification has bounded linear growth over inventory size", async () => {
  clean();
  const bundle = assemble("growth");
  const manifestPath = join(bundle, "framework-release-manifest.json");
  const digestPath = join(bundle, "framework-release-manifest.sha256");
  const baseManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    inventory: { bytes: number; kind: string; path: string; sha256: string }[];
  };
  const crypto = await import("node:crypto");
  function rewrite(extraFiles: number): void {
    for (let index = 0; index < 32; index += 1) {
      rmSync(join(bundle, "src", "framework", `growth-${String(index)}.txt`), {
        force: true,
      });
    }
    const inventory = baseManifest.inventory.filter(
      (entry) => !entry.path.includes("growth-"),
    );
    for (let index = 0; index < extraFiles; index += 1) {
      const relativePath = `src/framework/growth-${String(index).padStart(2, "0")}.txt`;
      const content = `growth ${String(index)}\n`;
      writeFileSync(join(bundle, relativePath), content);
      inventory.push({
        bytes: Buffer.byteLength(content),
        kind: "sdk-owned-source",
        path: relativePath,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      });
    }
    const manifest = {
      ...baseManifest,
      inventory: inventory.toSorted((left, right) =>
        left.path.localeCompare(right.path),
      ),
    };
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(manifestPath, serialized);
    writeFileSync(
      digestPath,
      `${crypto.createHash("sha256").update(serialized).digest("hex")}\n`,
    );
  }
  assertGrowthRatio({
    large: () => {
      rewrite(32);
      assert.equal(verifyFrameworkBundle(bundle), undefined);
    },
    maxRatio: 4,
    name: "Framework Bundle verification inventory growth",
    small: () => {
      rewrite(16);
      assert.equal(verifyFrameworkBundle(bundle), undefined);
    },
  });
});
