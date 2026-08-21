export const frameworkReleaseManifestSchemaVersion = "1.0.0";

export type FrameworkInventoryKind =
  | "dependency-evidence"
  | "framework-runtime"
  | "sdk-owned-source"
  | "vendored-production-dependency";

export interface FrameworkReleaseInventoryEntry {
  readonly bytes: number;
  readonly kind: FrameworkInventoryKind;
  readonly path: string;
  readonly sha256: string;
}

export interface FrameworkReleaseDependencyEvidence {
  readonly license: string;
  readonly licenseFiles: readonly string[];
  readonly name: string;
  readonly path: string;
  readonly version: string;
}

export interface FrameworkReleaseEnvironment {
  readonly ambientGit: "not-required-for-lint";
  readonly node: string;
}

export interface FrameworkReleaseMigrationPaths {
  readonly from: readonly string[];
  readonly to: readonly string[];
}

export interface FrameworkReleaseManifest {
  readonly "framework-release-manifest-schema": typeof frameworkReleaseManifestSchemaVersion;
  readonly atlasContracts: {
    readonly atlasLintResult: string;
    readonly operationResult: string;
  };
  readonly declaredInventoryRoots: readonly string[];
  readonly frameworkRelease: FrameworkRelease;
  readonly inventory: readonly FrameworkReleaseInventoryEntry[];
  readonly migrationPaths: FrameworkReleaseMigrationPaths;
  readonly productionDependencies: readonly FrameworkReleaseDependencyEvidence[];
  readonly supportedEnvironments: FrameworkReleaseEnvironment;
}

export interface FrameworkRelease {
  readonly id: string;
  readonly packageName: string;
  readonly sourceRevision: string;
  readonly version: string;
}

export interface FrameworkBundle {
  readonly manifest: FrameworkReleaseManifest;
  readonly manifestDigest: string;
}

export type FrameworkBundleVerificationResult =
  | {
      readonly bundle: FrameworkBundle;
      readonly state: "verified";
    }
  | {
      readonly code: string;
      readonly message: string;
      readonly path: string;
      readonly state: "failed";
    };

export type FrameworkReleaseManifestParseResult =
  | {
      readonly manifest: FrameworkReleaseManifest;
      readonly state: "parsed";
    }
  | {
      readonly code: "ATLAS_FRAMEWORK_MANIFEST_INVALID";
      readonly message: string;
      readonly state: "failed";
    };

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

function invalid(message: string): FrameworkReleaseManifestParseResult {
  return Object.freeze({
    code: "ATLAS_FRAMEWORK_MANIFEST_INVALID" as const,
    message,
    state: "failed" as const,
  });
}

function parseRelease(value: unknown): FrameworkRelease | undefined {
  if (!isRecord(value)) return undefined;
  const { id, packageName, sourceRevision, version } = value;
  if (
    typeof id !== "string" ||
    typeof packageName !== "string" ||
    typeof sourceRevision !== "string" ||
    typeof version !== "string"
  ) {
    return undefined;
  }
  return Object.freeze({ id, packageName, sourceRevision, version });
}

function parseInventoryEntry(
  value: unknown,
): FrameworkReleaseInventoryEntry | undefined {
  if (!isRecord(value)) return undefined;
  const { bytes, kind, path, sha256 } = value;
  if (
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    typeof kind !== "string" ||
    !inventoryKinds.includes(kind as FrameworkInventoryKind) ||
    typeof path !== "string" ||
    path === "" ||
    typeof sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(sha256)
  ) {
    return undefined;
  }
  return Object.freeze({ bytes, kind: kind as FrameworkInventoryKind, path, sha256 });
}

function parseDependencyEvidence(
  value: unknown,
): FrameworkReleaseDependencyEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const { license, licenseFiles, name, path, version } = value;
  if (
    typeof license !== "string" ||
    !isStringArray(licenseFiles) ||
    typeof name !== "string" ||
    typeof path !== "string" ||
    typeof version !== "string"
  ) {
    return undefined;
  }
  return Object.freeze({
    license,
    licenseFiles: Object.freeze([...licenseFiles]),
    name,
    path,
    version,
  });
}

export function parseFrameworkReleaseManifest(
  value: unknown,
): FrameworkReleaseManifestParseResult {
  if (!isRecord(value)) return invalid("Framework Release Manifest must be an object.");
  if (
    value["framework-release-manifest-schema"] !== frameworkReleaseManifestSchemaVersion
  ) {
    return invalid("Framework Release Manifest schema version is unsupported.");
  }

  const release = parseRelease(value["frameworkRelease"]);
  if (release === undefined)
    return invalid("Framework Release Manifest release is invalid.");

  if (!isStringArray(value["declaredInventoryRoots"])) {
    return invalid("Framework Release Manifest declared inventory roots are invalid.");
  }

  if (!isRecord(value["atlasContracts"])) {
    return invalid("Framework Release Manifest Atlas contracts are invalid.");
  }
  const { atlasLintResult, operationResult } = value["atlasContracts"];
  if (typeof atlasLintResult !== "string" || typeof operationResult !== "string") {
    return invalid("Framework Release Manifest Atlas contracts are invalid.");
  }

  if (!isRecord(value["migrationPaths"])) {
    return invalid("Framework Release Manifest migration paths are invalid.");
  }
  const { from, to } = value["migrationPaths"];
  if (!isStringArray(from) || !isStringArray(to)) {
    return invalid("Framework Release Manifest migration paths are invalid.");
  }

  if (!isRecord(value["supportedEnvironments"])) {
    return invalid("Framework Release Manifest supported environments are invalid.");
  }
  const { ambientGit, node } = value["supportedEnvironments"];
  if (ambientGit !== "not-required-for-lint" || typeof node !== "string") {
    return invalid("Framework Release Manifest supported environments are invalid.");
  }

  if (!Array.isArray(value["inventory"])) {
    return invalid("Framework Release Manifest inventory is invalid.");
  }
  const inventory = value["inventory"].map(parseInventoryEntry);
  if (inventory.some((entry) => entry === undefined)) {
    return invalid("Framework Release Manifest inventory is invalid.");
  }

  if (!Array.isArray(value["productionDependencies"])) {
    return invalid("Framework Release Manifest production dependencies are invalid.");
  }
  const productionDependencies = value["productionDependencies"].map(
    parseDependencyEvidence,
  );
  if (productionDependencies.some((entry) => entry === undefined)) {
    return invalid("Framework Release Manifest production dependencies are invalid.");
  }

  return Object.freeze({
    manifest: Object.freeze({
      "framework-release-manifest-schema": frameworkReleaseManifestSchemaVersion,
      atlasContracts: Object.freeze({ atlasLintResult, operationResult }),
      declaredInventoryRoots: Object.freeze([...value["declaredInventoryRoots"]]),
      frameworkRelease: release,
      inventory: Object.freeze(inventory as readonly FrameworkReleaseInventoryEntry[]),
      migrationPaths: Object.freeze({
        from: Object.freeze([...from]),
        to: Object.freeze([...to]),
      }),
      productionDependencies: Object.freeze(
        productionDependencies as readonly FrameworkReleaseDependencyEvidence[],
      ),
      supportedEnvironments: Object.freeze({ ambientGit, node }),
    }),
    state: "parsed" as const,
  });
}

export function frameworkReleaseIdentity(release: FrameworkRelease): string {
  return `${release.packageName}@${release.version}+${release.sourceRevision}`;
}

export function inventoryPaths(manifest: FrameworkReleaseManifest): readonly string[] {
  return Object.freeze(manifest.inventory.map((entry) => entry.path).toSorted());
}
