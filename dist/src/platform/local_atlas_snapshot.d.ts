import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import type { OperationReference } from "../operations/operation_result.ts";
export interface AtlasSnapshot {
    readonly baseSnapshot: OperationReference;
    readonly capturedFiles: readonly CapturedAtlasFile[];
    readonly homeAtlas: OperationReference;
}
export interface LocalAtlasSnapshotBudgets {
    readonly maxFileBytes: number;
    readonly maxFiles: number;
    readonly maxTotalBytes: number;
}
export declare const localAtlasSnapshotBudgets: LocalAtlasSnapshotBudgets;
export type AtlasSnapshotCaptureResult = {
    readonly snapshot: AtlasSnapshot;
    readonly state: "captured";
} | {
    readonly reason: string;
    readonly state: "failed";
};
export declare function captureLocalAtlasSnapshot(repository: string, budgets?: LocalAtlasSnapshotBudgets): AtlasSnapshotCaptureResult;
