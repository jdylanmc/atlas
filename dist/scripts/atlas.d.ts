#!/usr/bin/env node
/** Atlas command-line interface. */
import { type LintCommandCaptureBudgets, type LintCommandCapturedFile } from "../src/interfaces/lint_command.ts";
export declare class CaptureBudgetError extends Error {
    readonly capturedFiles: readonly LintCommandCapturedFile[];
    constructor(message: string, capturedFiles: readonly LintCommandCapturedFile[]);
}
type ReadFile = (path: string) => Uint8Array;
export declare function captureAtlasHostDirectory(atlasHostDirectory: string, budgets: LintCommandCaptureBudgets, readFile?: ReadFile): readonly LintCommandCapturedFile[];
export declare function main(arguments_: readonly string[]): number;
export {};
