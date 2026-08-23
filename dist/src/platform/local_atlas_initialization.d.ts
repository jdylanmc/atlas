import { runAtlasInitializationWorkflow, type AtlasInitializationWorkflowState } from "../operations/initialize_operation.ts";
export declare function createLocalAtlasInitializationState(repository: string): AtlasInitializationWorkflowState;
export declare function readLocalAtlasInitializationState(repository: string, proposalBranch: string): AtlasInitializationWorkflowState;
export declare function resumeLocalAtlasInitialization(repository: string, proposalBranch: string): ReturnType<typeof runLocalAtlasInitialization>;
export declare function runLocalAtlasInitialization(repository: string, state?: AtlasInitializationWorkflowState): ReturnType<typeof runAtlasInitializationWorkflow>;
