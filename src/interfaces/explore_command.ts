import type { Finding } from "../domain/finding.ts";
import type { ExploreOperationResult } from "../operations/explore_operation.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationReference,
} from "../operations/operation_result.ts";
export const exploreCommandUsage =
  "usage: atlas explore --machine QUERY [--atlas-host-directory PATH]";

export const exploreCommandExitCodes = Object.freeze({
  operationFailed: 1,
  operationNotCompleted: 2,
  success: 0,
  usage: 64,
} as const);

export const exploreCommandBudgets = Object.freeze({
  maxContextCharacters: 4096,
  maxEdges: 2048,
  maxFileBytes: 1024 * 1024,
  maxFiles: 4096,
  maxObjects: 2048,
  maxQueryCharacters: 1024,
  maxResults: 5,
  maxRouteEdges: 32,
  maxTerms: 128,
  maxTotalBytes: 16 * 1024 * 1024,
});

const exploreOperationIdentity = Object.freeze({
  kind: "explore" as const,
  subject: "local-home-atlas" as const,
});

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.atlas-explore-command",
  kind: "sdk-core" as const,
  trusted: true as const,
});

function exploreFinding(code: string, message: string, path = ".atlas"): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "error" as const,
  });
}

function unknownReference(reason: string): OperationReference {
  return Object.freeze({ reason, state: "unknown" as const });
}

function notCompletedExploreResult(
  findings: readonly Finding[],
  summary: string,
  recommendedNextAction: string,
  options: {
    readonly baseSnapshotReason: string;
    readonly degraded: boolean;
    readonly homeAtlasReason: string;
  },
): ExploreOperationResult {
  const payload = Object.freeze({
    degradation: Object.freeze({
      diagnostics: Object.freeze([...findings]),
      level: "blocked" as const,
      remediation: recommendedNextAction,
    }),
    reanchors: Object.freeze([]),
    results: Object.freeze([]),
  });
  const handoff = Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: unknownReference(options.baseSnapshotReason),
    degradationState: Object.freeze({
      reason: summary,
      state: options.degraded ? ("degraded" as const) : ("not-degraded" as const),
    }),
    homeAtlas: unknownReference(options.homeAtlasReason),
    operation: exploreOperationIdentity,
    proposedChanges: Object.freeze({
      reason: "Explore is read-only and proposes no Atlas Change Set.",
      state: "not-applicable" as const,
    }),
    recommendedNextAction,
    result: Object.freeze({ disposition: "failed" as const, summary }),
    reviewLink: Object.freeze({
      reason: "Explore did not create an Atlas Proposal.",
      state: "not-applicable" as const,
    }),
    unresolvedHumanDecisions: Object.freeze({
      state: "none" as const,
      summary: "No human decision is required to interpret this Explore result.",
    }),
    validationState: Object.freeze({
      findings: Object.freeze([...findings]),
      state: "not-completed" as const,
    }),
  });
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: "not-completed" as const,
    disposition: "failed" as const,
    handoff,
    operation: exploreOperationIdentity,
    payload,
  });
}

export function usageExploreOperationResult(message: string): ExploreOperationResult {
  return notCompletedExploreResult(
    [exploreFinding("ATLAS_EXPLORE_USAGE", message)],
    "Explore command arguments were invalid.",
    exploreCommandUsage,
    {
      baseSnapshotReason:
        "Explore command arguments were invalid before a Git-backed Atlas Snapshot was read.",
      degraded: false,
      homeAtlasReason:
        "Explore command arguments were invalid before an Atlas Host Directory was selected.",
    },
  );
}

export function missingAtlasExploreOperationResult(
  message: string,
): ExploreOperationResult {
  return notCompletedExploreResult(
    [exploreFinding("ATLAS_EXPLORE_ATLAS_NOT_FOUND", message)],
    "No Atlas was found in the selected Atlas Host Directory.",
    "Run Explore from an Atlas Host Directory or pass --atlas-host-directory with one that contains .atlas/.",
    {
      baseSnapshotReason:
        "Explore command selected an Atlas Host Directory with no .atlas directory.",
      degraded: false,
      homeAtlasReason:
        "Explore command selected an Atlas Host Directory with no .atlas directory.",
    },
  );
}

export function unreadableAtlasExploreOperationResult(
  message: string,
): ExploreOperationResult {
  return notCompletedExploreResult(
    [exploreFinding("ATLAS_EXPLORE_ATLAS_UNREADABLE", message)],
    "Explore could not capture the Atlas files.",
    "Retry Explore in a healthy Git worktree with readable committed Atlas files; if it repeats, escalate the operation failure.",
    {
      baseSnapshotReason: "Explore could not capture a Git-backed Atlas Snapshot.",
      degraded: true,
      homeAtlasReason: "Explore could not read the selected Atlas Host Directory.",
    },
  );
}

export function oversizedQueryExploreOperationResult(
  message: string,
): ExploreOperationResult {
  return notCompletedExploreResult(
    [exploreFinding("ATLAS_EXPLORE_QUERY_TOO_LARGE", message)],
    "Explore command input exceeded its query budget before Atlas capture.",
    "Shorten the Explore request and run Explore again.",
    {
      baseSnapshotReason:
        "Explore refused an oversized query before reading a Git-backed Atlas Snapshot.",
      degraded: false,
      homeAtlasReason:
        "Explore refused an oversized query before selecting an Atlas Host Directory.",
    },
  );
}

export function oversizedAtlasExploreOperationResult(
  message: string,
): ExploreOperationResult {
  return notCompletedExploreResult(
    [exploreFinding("ATLAS_EXPLORE_ATLAS_TOO_LARGE", message)],
    "Explore command input exceeded its byte budget before it could be read.",
    "Reduce the committed Atlas Snapshot to the supported byte budget, then retry Explore.",
    {
      baseSnapshotReason: "Explore refused an oversized Git-backed Atlas Snapshot.",
      degraded: false,
      homeAtlasReason: "Explore refused an oversized Atlas Host Directory.",
    },
  );
}

export function exitCodeForExploreOperationResult(
  result: ExploreOperationResult,
): number {
  if (result.completion === "completed" && result.disposition === "success") {
    return exploreCommandExitCodes.success;
  }
  const codes = new Set(
    result.handoff.validationState.findings.map((finding) => finding.code),
  );
  if (
    codes.has("ATLAS_EXPLORE_USAGE") ||
    codes.has("ATLAS_EXPLORE_ATLAS_NOT_FOUND") ||
    codes.has("ATLAS_EXPLORE_ATLAS_TOO_LARGE") ||
    codes.has("ATLAS_EXPLORE_ATLAS_TOO_MANY_FILES") ||
    codes.has("ATLAS_EXPLORE_QUERY_TOO_LARGE")
  ) {
    return exploreCommandExitCodes.usage;
  }
  if (codes.has("ATLAS_EXPLORE_ATLAS_UNREADABLE")) {
    return exploreCommandExitCodes.operationNotCompleted;
  }
  if (result.completion === "not-completed") {
    return exploreCommandExitCodes.operationNotCompleted;
  }
  return exploreCommandExitCodes.operationFailed;
}

export function serializeExploreMachineResult(result: ExploreOperationResult): string {
  return `${JSON.stringify(result)}\n`;
}
