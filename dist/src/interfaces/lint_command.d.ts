import { type LintOperationResult } from "../operations/lint_operation.ts";
export interface LintCommandCapturedFile {
    readonly bytes: Uint8Array;
    readonly path: string;
}
export interface LintCommandCaptureBudgets {
    readonly maxFileBytes: number;
    readonly maxFiles: number;
    readonly maxTotalBytes: number;
    readonly maxTraversalDepth: number;
}
export declare const lintCommandExitCodes: Readonly<{
    readonly atlasInvalid: 1;
    readonly operationNotCompleted: 2;
    readonly success: 0;
    readonly usage: 64;
}>;
export declare const lintCommandBudgets: Readonly<{
    maxFileBytes: number;
    maxTotalBytes: number;
}>;
export declare const lintCommandCaptureBudgets: LintCommandCaptureBudgets;
export declare const lintCommandUsage = "usage: atlas lint --machine [--atlas-host-directory PATH]";
export declare function usageLintOperationResult(message: string): LintOperationResult;
export declare function missingAtlasLintOperationResult(message: string): LintOperationResult;
export declare function unreadableAtlasLintOperationResult(message: string): LintOperationResult;
export declare function runLintCommandOperation(capturedFiles: readonly LintCommandCapturedFile[]): LintOperationResult;
export declare function exitCodeForLintOperationResult(result: LintOperationResult): number;
export declare function serializeLintMachineResult(result: LintOperationResult): string;
