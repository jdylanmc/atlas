import { type ExploreBudgets, type ExplorePayload, type SearchProvider } from "../graph/explore_atlas.ts";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { type OperationHandoff, type OperationIdentity, type OperationReference, type OperationResult } from "./operation_result.ts";
export interface ExploreOperationIdentity extends OperationIdentity {
    readonly kind: "explore";
    readonly subject: "local-home-atlas";
}
export interface ExploreOperationRequest {
    readonly baseSnapshot: OperationReference;
    readonly budgets?: Partial<ExploreBudgets>;
    readonly capturedFiles: readonly CapturedAtlasFile[];
    readonly homeAtlas: OperationReference;
    readonly provider?: SearchProvider;
    readonly query: string;
}
export interface ExploreCapturedSnapshot {
    readonly baseSnapshot: OperationReference;
    readonly capturedFiles: readonly CapturedAtlasFile[];
    readonly homeAtlas: OperationReference;
}
export type ExploreSnapshotCaptureResult = {
    readonly snapshot: ExploreCapturedSnapshot;
    readonly state: "captured";
} | {
    readonly reason: string;
    readonly state: "failed";
};
export type ExploreOperationHandoff = OperationHandoff<ExploreOperationIdentity>;
export type ExploreOperationResult = OperationResult<ExploreOperationIdentity, ExploreOperationHandoff, ExplorePayload>;
export declare function runExploreOperation(request: ExploreOperationRequest): ExploreOperationResult;
export declare function runExploreOperationFromSnapshotCapture(capture: ExploreSnapshotCaptureResult, options: {
    readonly budgets?: Partial<ExploreBudgets>;
    readonly provider?: SearchProvider;
    readonly query: string;
}): ExploreOperationResult;
