export interface CapturedAtlasFile {
    readonly bytes: Uint8Array;
    readonly path: string;
}
export interface AtlasTextFile {
    readonly content: string;
    readonly path: string;
}
export interface AtlasTextBudgets {
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
}
export type AtlasLoadErrorCode = "DUPLICATE_PATH" | "FILE_TOO_LARGE" | "INVALID_BUDGET" | "INVALID_PATH" | "INVALID_UTF8" | "SHARED_BYTES_NOT_ALLOWED" | "TOTAL_TOO_LARGE";
export declare class AtlasLoadError extends Error {
    readonly code: AtlasLoadErrorCode;
    constructor(code: AtlasLoadErrorCode);
}
export declare function loadAtlasText(capturedFiles: readonly CapturedAtlasFile[], budgets: AtlasTextBudgets): readonly AtlasTextFile[];
