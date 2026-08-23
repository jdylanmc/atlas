export const frameworkReleaseManifestSchemaVersion = "1.0.0";
const inventoryKinds = Object.freeze([
    "dependency-evidence",
    "framework-runtime",
    "sdk-owned-source",
    "vendored-production-dependency",
]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function invalid(message) {
    return Object.freeze({
        code: "ATLAS_FRAMEWORK_MANIFEST_INVALID",
        message,
        state: "failed",
    });
}
function parseRelease(value) {
    if (!isRecord(value))
        return undefined;
    const { id, packageName, sourceRevision, version } = value;
    if (typeof id !== "string" ||
        typeof packageName !== "string" ||
        typeof sourceRevision !== "string" ||
        typeof version !== "string") {
        return undefined;
    }
    return Object.freeze({ id, packageName, sourceRevision, version });
}
function parseInventoryEntry(value) {
    if (!isRecord(value))
        return undefined;
    const { bytes, kind, path, sha256 } = value;
    if (typeof bytes !== "number" ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        typeof kind !== "string" ||
        !inventoryKinds.includes(kind) ||
        typeof path !== "string" ||
        path === "" ||
        typeof sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(sha256)) {
        return undefined;
    }
    return Object.freeze({ bytes, kind: kind, path, sha256 });
}
function parseDependencyEvidence(value) {
    if (!isRecord(value))
        return undefined;
    const { license, licenseFiles, name, path, version } = value;
    if (typeof license !== "string" ||
        !isStringArray(licenseFiles) ||
        typeof name !== "string" ||
        typeof path !== "string" ||
        typeof version !== "string") {
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
export function parseFrameworkReleaseManifest(value) {
    if (!isRecord(value))
        return invalid("Framework Release Manifest must be an object.");
    if (value["framework-release-manifest-schema"] !== frameworkReleaseManifestSchemaVersion) {
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
    const productionDependencies = value["productionDependencies"].map(parseDependencyEvidence);
    if (productionDependencies.some((entry) => entry === undefined)) {
        return invalid("Framework Release Manifest production dependencies are invalid.");
    }
    return Object.freeze({
        manifest: Object.freeze({
            "framework-release-manifest-schema": frameworkReleaseManifestSchemaVersion,
            atlasContracts: Object.freeze({ atlasLintResult, operationResult }),
            declaredInventoryRoots: Object.freeze([...value["declaredInventoryRoots"]]),
            frameworkRelease: release,
            inventory: Object.freeze(inventory),
            migrationPaths: Object.freeze({
                from: Object.freeze([...from]),
                to: Object.freeze([...to]),
            }),
            productionDependencies: Object.freeze(productionDependencies),
            supportedEnvironments: Object.freeze({ ambientGit, node }),
        }),
        state: "parsed",
    });
}
export function frameworkReleaseIdentity(release) {
    return `${release.packageName}@${release.version}+${release.sourceRevision}`;
}
export function inventoryPaths(manifest) {
    return Object.freeze(manifest.inventory.map((entry) => entry.path).toSorted());
}
