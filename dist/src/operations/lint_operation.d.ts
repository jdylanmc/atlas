import type { Finding } from "../domain/finding.ts";
import type { AtlasTextBudgets, CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { type AtlasLintResult } from "../lint/lint_atlas.ts";
import { type OperationHandoff, type OperationIdentity, type OperationResult } from "./operation_result.ts";
export type LintOperationSubject = "atlas-host-directory" | "captured-home-atlas";
export interface LintOperationIdentity extends OperationIdentity {
    readonly kind: "lint";
    readonly subject: LintOperationSubject;
}
declare const completedLintOperationPayloadBrand: unique symbol;
export interface CompletedLintOperationPayload {
    readonly [completedLintOperationPayloadBrand]: true;
    readonly lint: AtlasLintResult;
    readonly state: "completed";
}
export interface NotCompletedLintOperationPayload {
    readonly findings: readonly Finding[];
    readonly state: "not-completed";
}
export type LintOperationPayload = CompletedLintOperationPayload | NotCompletedLintOperationPayload;
export type LintOperationHandoff = OperationHandoff<LintOperationIdentity>;
export type LintOperationResult = OperationResult<LintOperationIdentity, LintOperationHandoff, LintOperationPayload>;
export interface NotCompletedLintOperationInput {
    readonly baseSnapshotReason: string;
    readonly code: string;
    readonly degradationReason?: string;
    readonly homeAtlasReason: string;
    readonly message: string;
    readonly recommendedNextAction: string;
    readonly subject: LintOperationSubject;
    readonly summary: string;
}
export declare function notCompletedLintOperationResult(input: NotCompletedLintOperationInput): LintOperationResult;
export declare function runLintOperation(capturedFiles: readonly CapturedAtlasFile[], budgets: AtlasTextBudgets): LintOperationResult;
export {};
