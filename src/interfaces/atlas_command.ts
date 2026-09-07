import type { Finding } from "../domain/finding.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationHandoff,
  type OperationIdentity,
  type OperationResult,
} from "../operations/operation_result.ts";

export interface AtlasCommandOperationIdentity extends OperationIdentity {
  readonly kind: "atlas-command";
  readonly subject: "command-dispatch";
}

export interface NotCompletedAtlasCommandPayload {
  readonly findings: readonly Finding[];
  readonly state: "not-completed";
}

export type AtlasCommandOperationHandoff =
  OperationHandoff<AtlasCommandOperationIdentity>;
export type AtlasCommandOperationResult = OperationResult<
  AtlasCommandOperationIdentity,
  AtlasCommandOperationHandoff,
  NotCompletedAtlasCommandPayload
>;

export const atlasCommandExitCodes = Object.freeze({
  usage: 64,
} as const);

const atlasCommandOperation: AtlasCommandOperationIdentity = Object.freeze({
  kind: "atlas-command",
  subject: "command-dispatch",
});

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.atlas-command",
  kind: "sdk-core" as const,
  trusted: true as const,
});

export function commandNamesForDispatch<
  Dispatch extends Readonly<Record<string, unknown>>,
>(dispatch: Dispatch): readonly Extract<keyof Dispatch, string>[] {
  return Object.freeze(Object.keys(dispatch)) as readonly Extract<
    keyof Dispatch,
    string
  >[];
}

export function formatAtlasCommandUsage(commandNames: readonly string[]): string {
  return `usage: atlas <command> --machine [arguments]\ncommands: ${commandNames.join(", ")}`;
}

function atlasCommandFinding(code: string, message: string): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path: "atlas",
    severity: "error" as const,
  });
}

function notCompletedAtlasCommandOperationResult(
  finding: Finding,
  summary: string,
  commandUsage: string,
): AtlasCommandOperationResult {
  const findings = Object.freeze([finding]);
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "not-completed",
    disposition: "failed",
    handoff: Object.freeze({
      "operation-handoff-schema": operationHandoffSchemaVersion,
      baseSnapshot: Object.freeze({
        reason:
          "Command dispatch stopped before a Git-backed Atlas Snapshot was selected.",
        state: "not-applicable",
      }),
      degradationState: Object.freeze({
        reason: summary,
        state: "not-degraded",
      }),
      homeAtlas: Object.freeze({
        reason: "Command dispatch stopped before an Atlas Host Directory was selected.",
        state: "not-applicable",
      }),
      operation: atlasCommandOperation,
      proposedChanges: Object.freeze({
        reason: "Command dispatch proposes no Atlas Change Set.",
        state: "not-applicable",
      }),
      recommendedNextAction: commandUsage,
      result: Object.freeze({
        disposition: "failed",
        summary,
      }),
      reviewLink: Object.freeze({
        reason: "Command dispatch did not create an Atlas Proposal.",
        state: "not-applicable",
      }),
      unresolvedHumanDecisions: Object.freeze({
        state: "none",
        summary: "No human decision is required to resolve Atlas command dispatch.",
      }),
      validationState: Object.freeze({
        findings,
        state: "not-completed",
      }),
    }),
    operation: atlasCommandOperation,
    payload: Object.freeze({
      findings,
      state: "not-completed",
    }),
  });
}

export function usageAtlasCommandOperationResult(
  commandUsage: string,
): AtlasCommandOperationResult {
  return notCompletedAtlasCommandOperationResult(
    atlasCommandFinding("ATLAS_COMMAND_USAGE", "An Atlas command must be selected."),
    "Atlas command dispatch did not receive a command.",
    commandUsage,
  );
}

export function unknownAtlasCommandOperationResult(
  command: string,
  commandUsage: string,
): AtlasCommandOperationResult {
  return notCompletedAtlasCommandOperationResult(
    atlasCommandFinding("ATLAS_COMMAND_UNKNOWN", `Unknown Atlas command "${command}".`),
    "Atlas command dispatch received an unknown command.",
    commandUsage,
  );
}

export function serializeAtlasCommandMachineResult(
  result: AtlasCommandOperationResult,
): string {
  return `${JSON.stringify(result)}\n`;
}
