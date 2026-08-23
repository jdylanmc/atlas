export declare const frameworkReleaseManifestSchemaVersion = "1.0.0";
export type FrameworkInventoryKind = "dependency-evidence" | "framework-runtime" | "sdk-owned-source" | "vendored-production-dependency";
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
export type FrameworkBundleVerificationResult = {
    readonly bundle: FrameworkBundle;
    readonly state: "verified";
} | {
    readonly code: string;
    readonly message: string;
    readonly path: string;
    readonly state: "failed";
};
export type FrameworkReleaseManifestParseResult = {
    readonly manifest: FrameworkReleaseManifest;
    readonly state: "parsed";
} | {
    readonly code: "ATLAS_FRAMEWORK_MANIFEST_INVALID";
    readonly message: string;
    readonly state: "failed";
};
export declare function parseFrameworkReleaseManifest(value: unknown): FrameworkReleaseManifestParseResult;
export declare function frameworkReleaseIdentity(release: FrameworkRelease): string;
export declare function inventoryPaths(manifest: FrameworkReleaseManifest): readonly string[];
