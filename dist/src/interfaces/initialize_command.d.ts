import { type AtlasInitializationResult } from "../operations/initialize_operation.ts";
export declare const initializeCommandUsage = "usage: atlas initialize --machine [--atlas-host-directory PATH] [--resume-proposal-branch NAME]";
export declare const initializeCommandExitCodes: Readonly<{
    readonly operationNotCompleted: 2;
    readonly success: 0;
    readonly usage: 64;
}>;
export declare function runInitializeCommandOperation(atlasHostDirectory: string, resumeProposalBranch?: string): AtlasInitializationResult;
export declare function usageInitializeOperationResult(message: string): AtlasInitializationResult;
export declare function exitCodeForInitializeOperationResult(result: AtlasInitializationResult): number;
export declare function serializeInitializeMachineResult(result: AtlasInitializationResult): string;
