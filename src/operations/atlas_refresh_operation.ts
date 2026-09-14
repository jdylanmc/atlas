import { buildAtlasView } from "../atlas/atlas_view.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import {
  defaultAtlasTextBudgets,
  type CapturedAtlasFile,
} from "../atlas/load_atlas_text.ts";
import type { Finding } from "../domain/finding.ts";
import { atlasCacheKey } from "../domain/atlas_cache.ts";
import { parseTrackedAtlas } from "../domain/tracked_atlas.ts";
import { loadAndValidateAtlasInput } from "../lint/validate_atlas_input.ts";
import type {
  AtlasCacheResolverRequest,
  AtlasCacheResolverResult,
} from "./connected_atlas_explore.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationHandoff,
  type OperationReference,
  type OperationResult,
} from "./operation_result.ts";

export type AtlasRefreshSelection =
  { readonly kind: "all" } | { readonly kind: "one"; readonly slug: string };

interface AtlasRefreshContext {
  readonly baseSnapshot: OperationReference;
  readonly homeAtlas: OperationReference;
  readonly selection?: AtlasRefreshSelection;
}

export interface AtlasRefreshRequest extends AtlasRefreshContext {
  readonly capturedFiles: readonly CapturedAtlasFile[];
  readonly selection: AtlasRefreshSelection;
  readonly runtime: {
    readonly refresh: (request: AtlasCacheResolverRequest) => AtlasCacheResolverResult;
  };
}

export interface AtlasRefreshEntry {
  readonly declarationId: string;
  readonly findings: readonly Finding[];
  readonly slug?: string;
  readonly snapshot?: string;
  readonly state: "refreshed" | "cached-offline" | "unreachable" | "invalid";
}

export interface AtlasRefreshPayload {
  readonly entries: readonly AtlasRefreshEntry[];
  readonly findings: readonly Finding[];
  readonly maintenanceFindings: readonly Finding[];
  readonly selection: AtlasRefreshSelection | null;
}

const operation = Object.freeze({
  kind: "atlas-refresh" as const,
  subject: "local-home-atlas" as const,
});
export type AtlasRefreshResult = OperationResult<
  typeof operation,
  OperationHandoff<typeof operation>,
  AtlasRefreshPayload
>;

function finding(code: string, message: string, path = ".atlas"): Finding {
  return Object.freeze({
    attribution: Object.freeze({
      checkId: "sdk-core.atlas-refresh",
      kind: "sdk-core" as const,
      trusted: true as const,
    }),
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "error",
  });
}

function result(
  context: AtlasRefreshContext,
  entries: readonly AtlasRefreshEntry[],
  findings: readonly Finding[],
  maintenanceFindings: readonly Finding[],
  completion: "completed" | "not-completed",
): AtlasRefreshResult {
  const failed =
    completion === "not-completed" ||
    entries.some(
      (entry) => entry.state === "invalid" || entry.state === "unreachable",
    ) ||
    findings.some((entry) => entry.severity === "error");
  const disposition = failed ? "failed" : "success";
  const summary =
    completion === "not-completed"
      ? "Atlas Refresh stopped before refreshing declarations."
      : `Atlas Refresh processed ${String(entries.length)} declaration(s).`;
  const decisions = findings
    .filter((entry) => entry.code === "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE")
    .map((entry) => entry.message);
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion,
    disposition,
    operation,
    payload: Object.freeze({
      entries: Object.freeze([...entries]),
      findings: Object.freeze([...findings]),
      maintenanceFindings: Object.freeze([...maintenanceFindings]),
      selection: context.selection ?? null,
    }),
    handoff: Object.freeze({
      "operation-handoff-schema": operationHandoffSchemaVersion,
      baseSnapshot: context.baseSnapshot,
      homeAtlas: context.homeAtlas,
      operation,
      degradationState: Object.freeze({
        state:
          findings.length === 0 ? ("not-degraded" as const) : ("degraded" as const),
        reason: summary,
      }),
      proposedChanges: Object.freeze({
        state: "not-applicable" as const,
        reason: "Atlas Refresh updates generated cache state, not Atlas knowledge.",
      }),
      reviewLink: Object.freeze({
        state: "not-applicable" as const,
        reason: "Atlas Refresh creates no Atlas Proposal.",
      }),
      recommendedNextAction:
        failed || findings.length > 0
          ? "Inspect the Findings; repair declarations or restore remote access, then retry Atlas Refresh."
          : maintenanceFindings.length > 0
            ? "Inspect the generated-state maintenance Findings before relying on persisted cache records."
            : "Use the returned fixed Snapshots for subsequent Atlas operations.",
      result: Object.freeze({ disposition, summary }),
      unresolvedHumanDecisions:
        decisions.length === 0
          ? Object.freeze({
              state: "none" as const,
              summary:
                "No human decision is required to interpret this refresh result.",
            })
          : Object.freeze({
              state: "pending" as const,
              decisions: Object.freeze([...new Set(decisions)]),
            }),
      validationState: Object.freeze({
        findings: Object.freeze([...findings]),
        state:
          completion === "not-completed"
            ? ("not-completed" as const)
            : findings.length === 0
              ? ("passed" as const)
              : ("failed" as const),
      }),
    }),
  });
}

export function refuseAtlasRefresh(
  code: string,
  message: string,
  context?: AtlasRefreshContext,
): AtlasRefreshResult {
  return result(
    context ?? {
      baseSnapshot: {
        state: "unknown",
        reason: "Refresh stopped before a Home Atlas Snapshot was captured.",
      },
      homeAtlas: {
        state: "unknown",
        reason: "Refresh stopped before a Home Atlas was selected.",
      },
    },
    [],
    [finding(code, message)],
    [],
    "not-completed",
  );
}

export function runAtlasRefreshOperation(
  request: AtlasRefreshRequest,
): AtlasRefreshResult {
  if (request.baseSnapshot.state !== "known" || request.homeAtlas.state !== "known") {
    return refuseAtlasRefresh(
      "ATLAS_REFRESH_SNAPSHOT_REQUIRED",
      "Atlas Refresh requires a fixed Home Atlas Snapshot.",
      request,
    );
  }
  const validated = loadAndValidateAtlasInput(
    request.capturedFiles,
    defaultAtlasTextBudgets,
  );
  if (validated.validationState === "invalid")
    return result(request, [], validated.findings, [], "not-completed");
  const view = buildAtlasView({
    identity: {
      atlas: request.homeAtlas,
      role: "home",
      slug: "local-home-atlas",
      snapshot: request.baseSnapshot,
    },
    validation: validated,
  });
  const selection = request.selection;
  const declarations = view.objects
    .filter(
      (object) =>
        object.type === "tracked-atlas" &&
        (selection.kind === "all" || object.id === `tracked-atlas:${selection.slug}`),
    )
    .toSorted((left, right) => compareCodePoints(left.id, right.id));
  if (selection.kind === "one" && declarations.length === 0) {
    return refuseAtlasRefresh(
      "ATLAS_REFRESH_TARGET_NOT_FOUND",
      "No committed TrackedAtlas declaration matches the selected Atlas Slug.",
      request,
    );
  }
  const gateways = [...view.graphIndexes.edgesById.values()].toSorted((left, right) =>
    compareCodePoints(left.id, right.id),
  );
  const entries: AtlasRefreshEntry[] = [];
  const findings: Finding[] = [];
  const maintenanceFindings: Finding[] = [];
  const resolutions = new Map<string, AtlasCacheResolverResult>();
  for (const declaration of declarations) {
    const parsed = parseTrackedAtlas(declaration);
    if (parsed.state === "invalid") {
      findings.push(...parsed.findings);
      entries.push(
        Object.freeze({
          declarationId: declaration.id,
          findings: parsed.findings,
          state: "invalid",
        }),
      );
      continue;
    }
    const gateway = gateways.find(
      (edge) =>
        (edge.to === declaration.id &&
          view.graphIndexes.objectsById.get(edge.from)?.type === "anchor") ||
        (edge.from === declaration.id &&
          view.graphIndexes.objectsById.get(edge.to)?.type === "anchor"),
    );
    if (gateway === undefined) {
      const missing = finding(
        "ATLAS_REFRESH_GATEWAY_MISSING",
        "The declaration has no Anchor gateway from which to record its cache dependency.",
        declaration.path,
      );
      findings.push(missing);
      entries.push(
        Object.freeze({
          declarationId: declaration.id,
          findings: Object.freeze([missing]),
          slug: parsed.trackedAtlas.slug.value,
          state: "invalid",
        }),
      );
      continue;
    }
    const key = atlasCacheKey(parsed.trackedAtlas.locator);
    let refreshed = resolutions.get(key);
    if (refreshed === undefined) {
      refreshed = request.runtime.refresh({
        introducedByAnchorId:
          gateway.from === declaration.id ? gateway.to : gateway.from,
        introducedByEdgeId: gateway.id,
        trackedAtlas: parsed.trackedAtlas,
      });
      resolutions.set(key, refreshed);
      maintenanceFindings.push(...(refreshed.maintenanceFindings ?? []));
      findings.push(
        ...(refreshed.state === "unreachable"
          ? refreshed.findings
          : refreshed.snapshot.findings),
      );
    }
    const entryFindings =
      refreshed.state === "unreachable"
        ? refreshed.findings
        : refreshed.snapshot.findings;
    entries.push(
      Object.freeze({
        declarationId: declaration.id,
        findings: Object.freeze([...entryFindings]),
        slug: parsed.trackedAtlas.slug.value,
        ...(refreshed.state === "resolved"
          ? { snapshot: refreshed.snapshot.snapshot }
          : {}),
        state:
          refreshed.state === "unreachable"
            ? "unreachable"
            : entryFindings.some(
                  (entry) => entry.code === "ATLAS_CROSS_ATLAS_CACHED_OFFLINE",
                )
              ? "cached-offline"
              : "refreshed",
      }),
    );
  }
  return result(request, entries, findings, maintenanceFindings, "completed");
}
