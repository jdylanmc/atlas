import { defaultAtlasTextBudgets } from "../atlas/load_atlas_text.ts";
import { dateTimeMilliseconds } from "../domain/atlas_page.ts";
import {
  notCompletedLintOperationResult,
  runLintOperation,
  type LintOperationResult,
} from "../operations/lint_operation.ts";

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

export const lintCommandExitCodes = Object.freeze({
  atlasInvalid: 1,
  operationNotCompleted: 2,
  success: 0,
  usage: 64,
} as const);

export const lintCommandBudgets = defaultAtlasTextBudgets;

export const lintCommandCaptureBudgets: LintCommandCaptureBudgets = Object.freeze({
  maxFileBytes: lintCommandBudgets.maxFileBytes,
  maxFiles: 4096,
  maxTotalBytes: lintCommandBudgets.maxTotalBytes,
  maxTraversalDepth: 32,
});

export const lintCommandUsage =
  "usage: atlas lint --machine [--atlas-host-directory PATH] [--as-of DATE_TIME]";

export function isValidLintObservationTime(value: string): boolean {
  return dateTimeMilliseconds(value) !== undefined;
}

export function usageLintOperationResult(message: string): LintOperationResult {
  return notCompletedLintOperationResult({
    baseSnapshotReason:
      "Lint command arguments were invalid before a Git-backed Atlas Snapshot was read.",
    code: "ATLAS_LINT_USAGE",
    homeAtlasReason:
      "Lint command arguments were invalid before an Atlas Host Directory was selected.",
    message,
    recommendedNextAction: lintCommandUsage,
    subject: "atlas-host-directory",
    summary: "Lint command arguments were invalid.",
  });
}

export function missingAtlasLintOperationResult(message: string): LintOperationResult {
  return notCompletedLintOperationResult({
    baseSnapshotReason:
      "Lint command selected an Atlas Host Directory with no .atlas directory.",
    code: "ATLAS_LINT_ATLAS_NOT_FOUND",
    homeAtlasReason:
      "Lint command selected an Atlas Host Directory with no .atlas directory.",
    message,
    recommendedNextAction:
      "Run Lint from an Atlas Host Directory or pass --atlas-host-directory with one that contains .atlas/.",
    subject: "atlas-host-directory",
    summary: "No Atlas was found in the selected Atlas Host Directory.",
  });
}

export function unreadableAtlasLintOperationResult(
  message: string,
): LintOperationResult {
  return notCompletedLintOperationResult({
    baseSnapshotReason: "Lint could not capture a Git-backed Atlas Snapshot.",
    code: "ATLAS_LINT_ATLAS_UNREADABLE",
    homeAtlasReason: "Lint could not read the selected Atlas Host Directory.",
    message,
    recommendedNextAction:
      "Retry Lint in a healthy runtime with readable Atlas files; if it repeats, escalate the operation failure.",
    subject: "atlas-host-directory",
    summary: "Lint could not capture the Atlas files.",
  });
}

export function runLintCommandOperation(
  capturedFiles: readonly LintCommandCapturedFile[],
  asOf?: string,
): LintOperationResult {
  return runLintOperation(
    capturedFiles,
    lintCommandBudgets,
    asOf === undefined ? undefined : { asOf },
  );
}

export function exitCodeForLintOperationResult(result: LintOperationResult): number {
  const code = result.handoff.validationState.findings[0]?.code;
  if (code === "ATLAS_LINT_USAGE" || code === "ATLAS_LINT_ATLAS_NOT_FOUND") {
    return lintCommandExitCodes.usage;
  }
  if (result.completion === "not-completed") {
    return lintCommandExitCodes.operationNotCompleted;
  }
  return result.disposition === "success"
    ? lintCommandExitCodes.success
    : lintCommandExitCodes.atlasInvalid;
}

export function serializeLintMachineResult(result: LintOperationResult): string {
  return `${JSON.stringify(result)}\n`;
}
