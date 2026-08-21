#!/usr/bin/env node
/** Assemble and verify a portable Framework Bundle. */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  type Dirent,
  type Stats,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  frameworkReleaseManifestSchemaVersion,
  frameworkReleaseIdentity,
  parseFrameworkReleaseManifest,
  type FrameworkReleaseDependencyEvidence,
  type FrameworkReleaseInventoryEntry,
  type FrameworkReleaseManifest,
} from "../src/framework/framework_release.ts";
import { lintCommandExitCodes } from "../src/interfaces/lint_command.ts";
import { operationResultSchemaVersion } from "../src/operations/operation_result.ts";
import { frameworkReleaseOwnedPathRoots } from "./framework_release_inventory.ts";

interface PackageJson {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly engines?: { readonly node?: string };
  readonly license?: string;
  readonly name?: string;
  readonly version?: string;
}

interface LockPackage {
  readonly dev?: boolean;
  readonly license?: string;
  readonly version?: string;
}

interface PackageLock {
  readonly packages?: Readonly<Record<string, LockPackage>>;
}

interface VerificationFailure {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

interface FrameworkBundleBudgets {
  readonly maxDepth: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestFile = "framework-release-manifest.json";
const manifestDigestFile = "framework-release-manifest.sha256";
const defaultBudgets: FrameworkBundleBudgets = Object.freeze({
  maxDepth: 64,
  maxFileBytes: 4 * 1024 * 1024,
  maxFiles: 20_000,
  maxTotalBytes: 64 * 1024 * 1024,
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNames(left: Dirent, right: Dirent): number {
  return compareText(left.name, right.name);
}

function slashPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertSafeRelativePath(path: string): void {
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new Error(`Unsafe Framework Bundle path: ${path}`);
  }
}

function copyFile(root: string, output: string, relativePath: string): void {
  assertSafeRelativePath(relativePath);
  const source = join(root, relativePath);
  const destination = join(output, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function assertSafeOutputDirectory(root: string, output: string): void {
  const relativeOutput = relative(root, output);
  if (
    relativeOutput === "" ||
    relativeOutput.startsWith("..") ||
    relativeOutput.startsWith(sep)
  ) {
    throw new Error(
      "Framework Bundle output must be a child directory of the source repository.",
    );
  }
  const existing = lstatSync(output, { throwIfNoEntry: false });
  if (existing !== undefined && !existing.isDirectory()) {
    throw new Error("Framework Bundle output must be a directory.");
  }
  if (
    existing !== undefined &&
    lstatSync(join(output, manifestDigestFile), { throwIfNoEntry: false }) === undefined
  ) {
    throw new Error(
      "Framework Bundle output may only replace a previous Framework Bundle.",
    );
  }
}

function boundedWalk(
  root: string,
  directory: string,
  budgets: FrameworkBundleBudgets,
  files: string[],
  state: { totalBytes: number },
  depth: number,
): void {
  if (depth > budgets.maxDepth) {
    throw new Error("Framework Bundle assembly exceeded traversal depth.");
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries.toSorted(compareNames)) {
    const absolute = join(directory, entry.name);
    let stat: Stats;
    try {
      stat = lstatSync(absolute);
    } catch {
      throw new Error("Framework Bundle assembly could not inspect a file.");
    }
    if (stat.isSymbolicLink()) {
      throw new Error("Framework Bundle assembly refuses symlinks.");
    }
    if (stat.isDirectory()) {
      boundedWalk(root, absolute, budgets, files, state, depth + 1);
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > budgets.maxFileBytes) {
      throw new Error("Framework Bundle assembly exceeded per-file byte budget.");
    }
    if (files.length >= budgets.maxFiles) {
      throw new Error("Framework Bundle assembly exceeded file count budget.");
    }
    state.totalBytes += stat.size;
    if (state.totalBytes > budgets.maxTotalBytes) {
      throw new Error("Framework Bundle assembly exceeded total byte budget.");
    }
    files.push(slashPath(root, absolute));
  }
}

function walkFiles(root: string, budgets = defaultBudgets): readonly string[] {
  const files: string[] = [];
  boundedWalk(root, root, budgets, files, { totalBytes: 0 }, 1);
  return Object.freeze(files.toSorted(compareText));
}

function productionDependencyPaths(lock: PackageLock): readonly string[] {
  return Object.freeze(
    Object.entries(lock.packages ?? {})
      .filter(([path, value]) => path.startsWith("node_modules/") && value.dev !== true)
      .map(([path]) => path)
      .toSorted(compareText),
  );
}

function directProductionDependencies(
  packageJson: PackageJson,
): Readonly<Record<string, string>> {
  const entries = Object.entries(packageJson.dependencies ?? {}).toSorted(
    ([left], [right]) => compareText(left, right),
  );
  return Object.fromEntries(entries);
}

function licenseFiles(packageRoot: string, bundlePath: string): readonly string[] {
  const files = walkFiles(packageRoot, defaultBudgets).filter((path) =>
    /^(?:licen[cs]e|copying|notice)(?:\.|$)/iu.test(path.split("/").at(-1) ?? ""),
  );
  return Object.freeze(files.map((path) => `${bundlePath}/${path}`));
}

function dependencyEvidence(
  output: string,
  dependencyPaths: readonly string[],
  lock: PackageLock,
): readonly FrameworkReleaseDependencyEvidence[] {
  return Object.freeze(
    dependencyPaths.map((path) => {
      const packageJson = readJson(join(output, path, "package.json")) as PackageJson;
      const lockPackage = lock.packages?.[path];
      const evidence: FrameworkReleaseDependencyEvidence = Object.freeze({
        license: packageJson.license ?? lockPackage?.license ?? "UNKNOWN",
        licenseFiles: licenseFiles(join(output, path), path),
        name: packageJson.name ?? path.replace(/^node_modules\//u, ""),
        path,
        version: packageJson.version ?? lockPackage?.version ?? "0.0.0",
      });
      if (evidence.license === "UNKNOWN" && evidence.licenseFiles.length === 0) {
        throw new Error(`Production dependency lacks license evidence: ${path}`);
      }
      return evidence;
    }),
  );
}

function createRuntimePackageJson(packageJson: PackageJson): string {
  return `${JSON.stringify(
    {
      bin: { atlas: "./scripts/framework_bootstrap.ts" },
      dependencies: directProductionDependencies(packageJson),
      engines: { node: packageJson.engines?.node ?? ">=24.0.0 <25" },
      name: packageJson.name ?? "@jdylanmc/atlas",
      private: true,
      type: "module",
      version: packageJson.version ?? "0.0.0",
    },
    null,
    2,
  )}\n`;
}

function inventory(output: string): readonly FrameworkReleaseInventoryEntry[] {
  return Object.freeze(
    walkFiles(output)
      .filter((path) => path !== manifestFile && path !== manifestDigestFile)
      .map((path) => {
        const bytes = readFileSync(join(output, path));
        const kind = path.startsWith("node_modules/")
          ? "vendored-production-dependency"
          : path === "dependency-evidence.json"
            ? "dependency-evidence"
            : path.startsWith("src/")
              ? "sdk-owned-source"
              : "framework-runtime";
        return Object.freeze({
          bytes: bytes.byteLength,
          kind,
          path,
          sha256: digest(bytes),
        });
      })
      .toSorted((left, right) => compareText(left.path, right.path)),
  );
}

export function frameworkReleaseSourceRevision(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

export function assertReleaseInputsClean(root: string): void {
  for (const arguments_ of [
    ["diff", "--quiet", "HEAD", "--", ...frameworkReleaseOwnedPathRoots],
    ["diff", "--cached", "--quiet", "HEAD", "--", ...frameworkReleaseOwnedPathRoots],
  ] as const) {
    try {
      execFileSync("git", arguments_, { cwd: root, stdio: "ignore" });
    } catch {
      throw new Error(
        "Framework Release inputs differ from HEAD; commit or revert them before assembly.",
      );
    }
  }
}

function trackedFrameworkFiles(root: string): readonly string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--", ...frameworkReleaseOwnedPathRoots],
    { cwd: root, encoding: "utf8" },
  );
  return Object.freeze(output.split("\n").filter((path) => path !== ""));
}

export function assembleFrameworkBundle(
  outputDirectory: string,
  root = repositoryRoot,
): FrameworkReleaseManifest {
  const output = resolve(outputDirectory);
  assertSafeOutputDirectory(resolve(root), output);
  assertReleaseInputsClean(root);
  rmSync(output, { force: true, recursive: true });
  mkdirSync(output, { recursive: true });

  const packageJson = readJson(join(root, "package.json")) as PackageJson;
  const lock = readJson(join(root, "package-lock.json")) as PackageLock;
  writeFileSync(join(output, "package.json"), createRuntimePackageJson(packageJson));

  for (const path of trackedFrameworkFiles(root)) {
    copyFile(root, output, path);
  }

  const dependencyPaths = productionDependencyPaths(lock);
  for (const dependencyPath of dependencyPaths) {
    for (const file of walkFiles(join(root, dependencyPath))) {
      copyFile(join(root, dependencyPath), join(output, dependencyPath), file);
    }
  }

  const dependencies = dependencyEvidence(output, dependencyPaths, lock);
  writeFileSync(
    join(output, "dependency-evidence.json"),
    `${JSON.stringify(dependencies, null, 2)}\n`,
  );

  const release = Object.freeze({
    id: `${packageJson.name ?? "@jdylanmc/atlas"}@${packageJson.version ?? "0.0.0"}`,
    packageName: packageJson.name ?? "@jdylanmc/atlas",
    sourceRevision: frameworkReleaseSourceRevision(root),
    version: packageJson.version ?? "0.0.0",
  });
  // The manifest sidecar detects corruption of reviewed bytes. It is not a
  // signature; the trust root is the host repository's Git history and review.
  const manifest: FrameworkReleaseManifest = Object.freeze({
    "framework-release-manifest-schema": frameworkReleaseManifestSchemaVersion,
    atlasContracts: Object.freeze({
      atlasLintResult: "1.0.0",
      operationResult: operationResultSchemaVersion,
    }),
    declaredInventoryRoots: frameworkReleaseOwnedPathRoots,
    frameworkRelease: Object.freeze({
      ...release,
      id: frameworkReleaseIdentity(release),
    }),
    inventory: inventory(output),
    migrationPaths: Object.freeze({ from: Object.freeze([]), to: Object.freeze([]) }),
    productionDependencies: dependencies,
    supportedEnvironments: Object.freeze({
      ambientGit: "not-required-for-lint" as const,
      node: packageJson.engines?.node ?? ">=24.0.0 <25",
    }),
  });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(output, manifestFile), serialized);
  writeFileSync(join(output, manifestDigestFile), `${digest(serialized)}\n`);
  return manifest;
}

function fail(code: string, path: string, message: string): VerificationFailure {
  return { code, message, path };
}

export function verifyFrameworkBundle(
  bundleDirectory: string,
): VerificationFailure | undefined {
  const root = resolve(bundleDirectory);
  try {
    const rawManifest = readFileSync(join(root, manifestFile), "utf8");
    const expectedManifestDigest = readFileSync(
      join(root, manifestDigestFile),
      "utf8",
    ).trim();
    const actualManifestDigest = digest(rawManifest);
    if (actualManifestDigest !== expectedManifestDigest) {
      return fail(
        "ATLAS_FRAMEWORK_MANIFEST_TAMPERED",
        manifestFile,
        `Framework Release Manifest digest mismatch: expected ${expectedManifestDigest} but found ${actualManifestDigest}.`,
      );
    }
    const parsed = parseFrameworkReleaseManifest(JSON.parse(rawManifest));
    if (parsed.state === "failed") {
      return fail(parsed.code, manifestFile, parsed.message);
    }
    const manifest = parsed.manifest;
    const expected = new Map(manifest.inventory.map((entry) => [entry.path, entry]));
    const actual = walkFiles(root);
    const allowed = new Set([manifestFile, manifestDigestFile]);
    for (const path of actual) {
      if (allowed.has(path)) continue;
      const entry = expected.get(path);
      if (entry === undefined) {
        return fail(
          "ATLAS_FRAMEWORK_BUNDLE_EXTRA_FILE",
          path,
          `Framework Bundle contains unexpected file ${path}.`,
        );
      }
      const bytes = readFileSync(join(root, path));
      const actualDigest = digest(bytes);
      if (bytes.byteLength !== entry.bytes || actualDigest !== entry.sha256) {
        return fail(
          "ATLAS_FRAMEWORK_BUNDLE_TAMPERED",
          path,
          `Framework Bundle inventory mismatch for ${path}: expected ${entry.sha256} but found ${actualDigest}.`,
        );
      }
    }
    for (const path of expected.keys()) {
      if (!actual.includes(path)) {
        return fail(
          "ATLAS_FRAMEWORK_BUNDLE_MISSING_FILE",
          path,
          `Framework Bundle is missing inventoried file ${path}.`,
        );
      }
    }
    return undefined;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Framework Bundle verification failed.";
    return fail("ATLAS_FRAMEWORK_BUNDLE_UNREADABLE", manifestFile, message);
  }
}

function parseOnlyPathFlag(
  arguments_: readonly string[],
  flag: string,
): string | undefined {
  let value: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== flag) return undefined;
    if (value !== undefined) return undefined;
    const next = arguments_[index + 1];
    if (next === undefined || next.startsWith("--")) return undefined;
    value = next;
    index += 1;
  }
  return value;
}

function usage(): string {
  return "usage: framework_bundle assemble --output PATH | verify --bundle PATH";
}

export function main(arguments_: readonly string[]): number {
  const command = arguments_[0];
  if (command === "assemble") {
    const output = parseOnlyPathFlag(arguments_, "--output");
    if (output === undefined) {
      console.error(usage());
      return 64;
    }
    const manifest = assembleFrameworkBundle(output);
    process.stdout.write(
      `${JSON.stringify({ manifest: join(resolve(output), manifestFile), release: manifest.frameworkRelease.id })}\n`,
    );
    return 0;
  }
  if (command === "verify") {
    const bundle = parseOnlyPathFlag(arguments_, "--bundle");
    if (bundle === undefined) {
      console.error(usage());
      return 64;
    }
    const failure = verifyFrameworkBundle(bundle);
    if (failure !== undefined) {
      console.error(failure.message);
      return lintCommandExitCodes.operationNotCompleted;
    }
    process.stdout.write("Framework Bundle verified.\n");
    return 0;
  }
  console.error(usage());
  return 64;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
