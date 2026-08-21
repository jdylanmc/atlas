import { lexicalSearchProvider } from "../graph/lexical_search_provider.ts";
import {
  exploreAtlas,
  type ExploreBudgets,
  type ExplorePayload,
  type SearchProvider,
} from "../graph/explore_atlas.ts";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { loadAndValidateAtlasInput } from "../lint/validate_atlas_input.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationChanges,
  type OperationHandoff,
  type OperationIdentity,
  type OperationReference,
  type OperationResult,
  type OperationReviewLink,
} from "./operation_result.ts";

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

export type ExploreOperationHandoff = OperationHandoff<ExploreOperationIdentity>;
export type ExploreOperationResult = OperationResult<
  ExploreOperationIdentity,
  ExploreOperationHandoff,
  ExplorePayload
>;

const exploreOperation: ExploreOperationIdentity = Object.freeze({
  kind: "explore",
  subject: "local-home-atlas",
});

const noProposedChanges: OperationChanges = Object.freeze({
  reason: "Explore is read-only and proposes no Atlas Change Set.",
  state: "not-applicable",
});

const noReviewLink: OperationReviewLink = Object.freeze({
  reason: "Explore did not create an Atlas Proposal.",
  state: "not-applicable",
});

const defaultBudgetValues = Object.freeze({
  maxContextCharacters: 4096,
  maxEdges: 2048,
  maxFileBytes: 1024 * 1024,
  maxObjects: 2048,
  maxQueryCharacters: 1024,
  maxResults: 5,
  maxRouteEdges: 32,
  maxTerms: 128,
  maxTotalBytes: 16 * 1024 * 1024,
});

function budgetsOf(request: ExploreOperationRequest): ExploreBudgets {
  return Object.freeze({
    ...defaultBudgetValues,
    ...request.budgets,
  });
}

function handoff(
  request: ExploreOperationRequest,
  payload: ExplorePayload,
): ExploreOperationHandoff {
  const blocked = payload.degradation.level === "blocked";
  const degraded = payload.degradation.level !== "valid-structured";
  const succeeded = !blocked && payload.results.length > 0;
  return Object.freeze({
    "operation-handoff-schema": operationHandoffSchemaVersion,
    baseSnapshot: request.baseSnapshot,
    degradationState: degraded
      ? Object.freeze({
          reason: `Explore completed at degradation level ${payload.degradation.level}.`,
          state: "degraded" as const,
        })
      : Object.freeze({
          reason: "Explore used valid structured Atlas objects.",
          state: "not-degraded" as const,
        }),
    homeAtlas: request.homeAtlas,
    operation: exploreOperation,
    proposedChanges: noProposedChanges,
    recommendedNextAction:
      payload.degradation.remediation ??
      (succeeded
        ? "Use the returned route, Re-anchoring record, and cited context."
        : "Refine the Explore request or add reachable Atlas knowledge."),
    result: Object.freeze({
      disposition: succeeded ? ("success" as const) : ("failed" as const),
      summary: succeeded
        ? "Explore returned reachable Atlas context."
        : blocked
          ? "Explore could not load usable Atlas material."
          : "Explore found no reachable result.",
    }),
    reviewLink: noReviewLink,
    unresolvedHumanDecisions: Object.freeze({
      state: "none" as const,
      summary: "No human decision is required to interpret this Explore result.",
    }),
    validationState: Object.freeze({
      findings: payload.degradation.diagnostics,
      state: blocked
        ? ("not-completed" as const)
        : payload.degradation.diagnostics.length === 0
          ? ("passed" as const)
          : ("failed" as const),
    }),
  });
}

export function runExploreOperation(
  request: ExploreOperationRequest,
): ExploreOperationResult {
  const budgets = budgetsOf(request);
  const validated = loadAndValidateAtlasInput(request.capturedFiles, budgets);
  const payload = exploreAtlas(
    validated.files,
    validated.findings,
    request.query,
    request.provider ?? lexicalSearchProvider,
    budgets,
  );
  const operationHandoff = handoff(request, payload);
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion:
      operationHandoff.validationState.state === "not-completed"
        ? ("not-completed" as const)
        : ("completed" as const),
    disposition: operationHandoff.result.disposition,
    handoff: operationHandoff,
    operation: exploreOperation,
    payload,
  });
}
