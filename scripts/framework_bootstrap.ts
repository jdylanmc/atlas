#!/usr/bin/env node
/** Integrity bootstrap for the bundled Atlas runtime. */

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, type Dirent, type Stats } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface ManifestEntry {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

type ManifestParseResult =
  | {
      readonly code: "ATLAS_FRAMEWORK_MANIFEST_INVALID";
      readonly message: string;
      readonly state: "failed";
    }
  | {
      readonly inventory: readonly ManifestEntry[];
      readonly state: "parsed";
    };

const manifestSchemaVersion = "1.0.0";
const inventoryKinds = Object.freeze([
  "dependency-evidence",
  "framework-runtime",
  "sdk-owned-source",
  "vendored-production-dependency",
] as const);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function invalidManifest(message: string): ManifestParseResult {
  return {
    code: "ATLAS_FRAMEWORK_MANIFEST_INVALID",
    message,
    state: "failed",
  };
}

function parseInventoryEntry(value: unknown): ManifestEntry | undefined {
  if (!isRecord(value)) return undefined;
  const { bytes, kind, path, sha256 } = value;
  if (
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    typeof kind !== "string" ||
    !inventoryKinds.includes(kind as (typeof inventoryKinds)[number]) ||
    typeof path !== "string" ||
    path === "" ||
    typeof sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(sha256)
  ) {
    return undefined;
  }
  return { bytes, path, sha256 };
}

function parseDependencyEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value["license"] === "string" &&
    isStringArray(value["licenseFiles"]) &&
    typeof value["name"] === "string" &&
    typeof value["path"] === "string" &&
    typeof value["version"] === "string"
  );
}

function parseFrameworkReleaseManifest(value: unknown): ManifestParseResult {
  if (!isRecord(value)) {
    return invalidManifest("Framework Release Manifest must be an object.");
  }
  if (value["framework-release-manifest-schema"] !== manifestSchemaVersion) {
    return invalidManifest("Framework Release Manifest schema version is unsupported.");
  }
  if (
    !isRecord(value["frameworkRelease"]) ||
    typeof value["frameworkRelease"]["id"] !== "string" ||
    typeof value["frameworkRelease"]["packageName"] !== "string" ||
    typeof value["frameworkRelease"]["sourceRevision"] !== "string" ||
    typeof value["frameworkRelease"]["version"] !== "string"
  ) {
    return invalidManifest("Framework Release Manifest release is invalid.");
  }
  if (!isStringArray(value["declaredInventoryRoots"])) {
    return invalidManifest(
      "Framework Release Manifest declared inventory roots are invalid.",
    );
  }
  if (
    !isRecord(value["atlasContracts"]) ||
    typeof value["atlasContracts"]["atlasLintResult"] !== "string" ||
    typeof value["atlasContracts"]["operationResult"] !== "string"
  ) {
    return invalidManifest("Framework Release Manifest Atlas contracts are invalid.");
  }
  if (
    !isRecord(value["migrationPaths"]) ||
    !isStringArray(value["migrationPaths"]["from"]) ||
    !isStringArray(value["migrationPaths"]["to"])
  ) {
    return invalidManifest("Framework Release Manifest migration paths are invalid.");
  }
  if (
    !isRecord(value["supportedEnvironments"]) ||
    value["supportedEnvironments"]["ambientGit"] !== "not-required-for-lint" ||
    typeof value["supportedEnvironments"]["node"] !== "string"
  ) {
    return invalidManifest(
      "Framework Release Manifest supported environments are invalid.",
    );
  }
  if (!Array.isArray(value["inventory"])) {
    return invalidManifest("Framework Release Manifest inventory is invalid.");
  }
  const inventory = value["inventory"].map(parseInventoryEntry);
  if (inventory.some((entry) => entry === undefined)) {
    return invalidManifest("Framework Release Manifest inventory is invalid.");
  }
  if (
    !Array.isArray(value["productionDependencies"]) ||
    !value["productionDependencies"].every(parseDependencyEvidence)
  ) {
    return invalidManifest(
      "Framework Release Manifest production dependencies are invalid.",
    );
  }
  return { inventory: inventory as readonly ManifestEntry[], state: "parsed" };
}

interface RuntimeFailure {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

interface RuntimeBudgets {
  readonly maxDepth: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
}

class RuntimeVerificationError extends Error {
  readonly failure: RuntimeFailure;

  constructor(failure: RuntimeFailure) {
    super(failure.message);
    this.name = "RuntimeVerificationError";
    this.failure = failure;
  }
}

const manifestFile = "framework-release-manifest.json";
const manifestDigestFile = "framework-release-manifest.sha256";
const exitCode = 2;
const runtimeBudgets: RuntimeBudgets = Object.freeze({
  maxDepth: 64,
  maxFileBytes: 4 * 1024 * 1024,
  maxFiles: 20_000,
  maxTotalBytes: 64 * 1024 * 1024,
});

function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareNames(left: Dirent, right: Dirent): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function slashPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function fail(code: string, path: string, message: string): RuntimeFailure {
  return { code, message, path };
}

function throwFailure(code: string, path: string, message: string): never {
  throw new RuntimeVerificationError(fail(code, path, message));
}

function walk(
  root: string,
  directory: string,
  files: string[],
  state: { totalBytes: number },
  depth: number,
): void {
  if (depth > runtimeBudgets.maxDepth) {
    throwFailure(
      "ATLAS_FRAMEWORK_BUNDLE_DEPTH",
      slashPath(root, directory),
      "Framework Bundle verification exceeded traversal depth.",
    );
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries.toSorted(compareNames)) {
    const absolute = join(directory, entry.name);
    let stat: Stats;
    try {
      stat = lstatSync(absolute);
    } catch {
      throwFailure(
        "ATLAS_FRAMEWORK_BUNDLE_UNREADABLE",
        slashPath(root, absolute),
        "Framework Bundle file could not be inspected.",
      );
    }
    if (stat.isSymbolicLink()) {
      throwFailure(
        "ATLAS_FRAMEWORK_BUNDLE_SYMLINK",
        slashPath(root, absolute),
        "Framework Bundle contains a symlink.",
      );
    }
    if (stat.isDirectory()) {
      walk(root, absolute, files, state, depth + 1);
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > runtimeBudgets.maxFileBytes) {
      throwFailure(
        "ATLAS_FRAMEWORK_BUNDLE_FILE_TOO_LARGE",
        slashPath(root, absolute),
        "Framework Bundle verification exceeded per-file byte budget.",
      );
    }
    if (files.length >= runtimeBudgets.maxFiles) {
      throwFailure(
        "ATLAS_FRAMEWORK_BUNDLE_FILE_COUNT",
        slashPath(root, absolute),
        "Framework Bundle verification exceeded file count budget.",
      );
    }
    state.totalBytes += stat.size;
    if (state.totalBytes > runtimeBudgets.maxTotalBytes) {
      throwFailure(
        "ATLAS_FRAMEWORK_BUNDLE_TOTAL_BYTES",
        slashPath(root, absolute),
        "Framework Bundle verification exceeded total byte budget.",
      );
    }
    files.push(slashPath(root, absolute));
  }
}

export function verifyRuntimeBundle(bundleRoot: string): RuntimeFailure | undefined {
  try {
    const root = resolve(bundleRoot);
    const raw = readFileSync(join(root, manifestFile), "utf8");
    const expectedManifestDigest = readFileSync(
      join(root, manifestDigestFile),
      "utf8",
    ).trim();
    const actualManifestDigest = digest(raw);
    if (actualManifestDigest !== expectedManifestDigest) {
      return fail(
        "ATLAS_FRAMEWORK_MANIFEST_TAMPERED",
        manifestFile,
        `Framework Release Manifest digest mismatch: expected ${expectedManifestDigest} but found ${actualManifestDigest}.`,
      );
    }
    const parsed = parseFrameworkReleaseManifest(JSON.parse(raw));
    if (parsed.state === "failed") {
      return fail(parsed.code, manifestFile, parsed.message);
    }

    const expectedFiles = new Map(parsed.inventory.map((entry) => [entry.path, entry]));
    const actualFiles: string[] = [];
    walk(root, root, actualFiles, { totalBytes: 0 }, 1);
    const allowed = new Set([manifestFile, manifestDigestFile]);
    for (const file of actualFiles) {
      if (allowed.has(file)) continue;
      const entry = expectedFiles.get(file);
      if (entry === undefined) {
        return fail(
          "ATLAS_FRAMEWORK_BUNDLE_EXTRA_FILE",
          file,
          `Framework Bundle contains unexpected file ${file}.`,
        );
      }
      const bytes = readFileSync(join(root, file));
      const actualDigest = digest(bytes);
      if (bytes.byteLength !== entry.bytes || actualDigest !== entry.sha256) {
        return fail(
          "ATLAS_FRAMEWORK_BUNDLE_TAMPERED",
          file,
          `Framework Bundle inventory mismatch for ${file}: expected ${entry.sha256} but found ${actualDigest}.`,
        );
      }
    }
    for (const [path] of expectedFiles) {
      if (!actualFiles.includes(path)) {
        return fail(
          "ATLAS_FRAMEWORK_BUNDLE_MISSING_FILE",
          path,
          `Framework Bundle is missing inventoried file ${path}.`,
        );
      }
    }
    return undefined;
  } catch (error: unknown) {
    if (error instanceof RuntimeVerificationError) return error.failure;
    const message =
      error instanceof Error ? error.message : "Framework Bundle verification failed.";
    return fail("ATLAS_FRAMEWORK_BUNDLE_UNREADABLE", manifestFile, message);
  }
}

function finding(failure: RuntimeFailure): object {
  return {
    attribution: {
      checkId: "sdk-core.framework-bundle-integrity",
      kind: "sdk-core",
      trusted: true,
    },
    code: failure.code,
    "finding-schema": "1.0.0",
    message: failure.message,
    path: failure.path,
    severity: "error",
  };
}

function writeFailure(failure: RuntimeFailure): void {
  const resultFinding = finding(failure);
  process.stdout.write(
    `${JSON.stringify({
      "operation-result-schema": "1.0.0",
      completion: "not-completed",
      disposition: "failed",
      handoff: {
        "operation-handoff-schema": "1.0.0",
        baseSnapshot: {
          reason:
            "Framework Bundle integrity failed before Lint read an Atlas Snapshot.",
          state: "unknown",
        },
        degradationState: { reason: failure.message, state: "degraded" },
        homeAtlas: {
          reason: "Framework Bundle integrity failed before a Home Atlas was read.",
          state: "unknown",
        },
        operation: { kind: "lint", subject: "atlas-host-directory" },
        proposedChanges: {
          reason: "Lint is read-only and proposes no Atlas Change Set.",
          state: "not-applicable",
        },
        recommendedNextAction:
          "Replace the Framework Bundle with the reviewed bytes pinned by the host repository before running Atlas maintenance.",
        result: {
          disposition: "failed",
          summary: "Framework Bundle integrity failed.",
        },
        reviewLink: {
          reason: "Lint did not create an Atlas Proposal.",
          state: "not-applicable",
        },
        unresolvedHumanDecisions: {
          state: "none",
          summary: "No human decision is required to interpret this integrity failure.",
        },
        validationState: { findings: [resultFinding], state: "not-completed" },
      },
      operation: { kind: "lint", subject: "atlas-host-directory" },
      payload: { findings: [resultFinding], state: "not-completed" },
    })}\n`,
  );
  console.error(failure.message);
}

export async function main(
  arguments_: readonly string[],
  bundleRootOverride?: string,
): Promise<number> {
  const scriptPath = fileURLToPath(import.meta.url);
  const bundleRoot = bundleRootOverride ?? dirname(dirname(scriptPath));
  const failure = verifyRuntimeBundle(bundleRoot);
  if (failure !== undefined) {
    writeFailure(failure);
    return exitCode;
  }
  const atlas = (await import(
    pathToFileURL(join(bundleRoot, "scripts", "atlas.ts")).href
  )) as { readonly main: (arguments_: readonly string[]) => number };
  return atlas.main(arguments_);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
