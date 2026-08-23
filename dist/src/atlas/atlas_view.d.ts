import type { AtlasInputValidation } from "../lint/validate_atlas_input.ts";
import type { ParsedAtlasPage } from "./parse_atlas_pages.ts";
import type { AtlasPageEnvelope } from "../domain/atlas_page.ts";
import type { Finding } from "../domain/finding.ts";
export interface AtlasViewSnapshotReference {
    readonly reason?: string;
    readonly reference?: string;
    readonly state: "known" | "not-applicable" | "unknown";
}
export interface AtlasViewSnapshotIdentity {
    readonly atlas: AtlasViewSnapshotReference;
    readonly role: "home" | "tracked";
    readonly slug: string;
    readonly snapshot: AtlasViewSnapshotReference;
}
export interface AtlasViewFileDigest {
    readonly algorithm: "sha256";
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
    readonly snapshot: AtlasViewSnapshotIdentity;
}
export interface AtlasViewFile {
    readonly content: string;
    readonly path: string;
    readonly snapshot: AtlasViewSnapshotIdentity;
}
export interface AtlasViewSourceLocation {
    readonly body: ParsedAtlasPage["source"]["body"];
    readonly frontmatter: ParsedAtlasPage["source"]["frontmatter"];
    readonly path: string;
    readonly snapshot: AtlasViewSnapshotIdentity;
}
export interface AtlasViewOwnership {
    readonly createdBy: AtlasPageEnvelope["sdk"]["created-by"];
    readonly updatedBy: AtlasPageEnvelope["sdk"]["updated-by"];
}
export interface AtlasViewObject {
    readonly body: string;
    readonly id: string;
    readonly ownership: AtlasViewOwnership;
    readonly page: AtlasPageEnvelope;
    readonly path: string;
    readonly sourceLocation: AtlasViewSourceLocation;
    readonly snapshot: AtlasViewSnapshotIdentity;
    readonly tags: readonly string[];
    readonly title: string;
    readonly type: string;
}
export interface AtlasViewEdge {
    readonly from: string;
    readonly id: string;
    readonly path: string;
    readonly snapshot: AtlasViewSnapshotIdentity;
    readonly to: string;
}
export interface AtlasViewGraphIndexes {
    readonly adjacencyByObjectId: ReadonlyMap<string, readonly string[]>;
    readonly edgeByObjectId: ReadonlyMap<string, AtlasViewEdge>;
    readonly edgesById: ReadonlyMap<string, AtlasViewEdge>;
    readonly objectsById: ReadonlyMap<string, AtlasViewObject>;
    readonly objectsByPath: ReadonlyMap<string, AtlasViewObject>;
}
export interface AtlasViewValidationState {
    readonly findings: readonly Finding[];
    readonly state: "invalid" | "valid";
}
export interface AtlasViewSnapshotInput {
    readonly identity: AtlasViewSnapshotIdentity;
    readonly validation: AtlasInputValidation;
}
export interface AtlasView {
    readonly fileDigests: readonly AtlasViewFileDigest[];
    readonly files: readonly AtlasViewFile[];
    readonly graphIndexes: AtlasViewGraphIndexes;
    readonly objects: readonly AtlasViewObject[];
    readonly snapshots: readonly AtlasViewSnapshotIdentity[];
    readonly sourceLocations: readonly AtlasViewSourceLocation[];
    readonly validationState: AtlasViewValidationState;
}
export declare function buildAtlasView(home: AtlasViewSnapshotInput, tracked?: readonly AtlasViewSnapshotInput[]): AtlasView;
