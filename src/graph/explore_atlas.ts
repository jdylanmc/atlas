import type { AtlasTextBudgets, AtlasTextFile } from "../atlas/load_atlas_text.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { AtlasView, AtlasViewEdge } from "../atlas/atlas_view.ts";
import { resolvedCitationSourcePaths } from "../atlas/resolve_citations.ts";
import { rootAnchorPageId } from "../domain/core_archetype.ts";
import { extractAtlasPrincipleActiveTruths } from "../domain/atlas_principle.ts";
import type { Finding } from "../domain/finding.ts";

const attribution = Object.freeze({
  checkId: "sdk-core.explore",
  kind: "sdk-core" as const,
  trusted: true as const,
});

export interface ExploreBudgets extends AtlasTextBudgets {
  readonly maxContextCharacters: number;
  readonly maxEdges: number;
  readonly maxObjects: number;
  readonly maxQueryCharacters: number;
  readonly maxResults: number;
  readonly maxRouteEdges: number;
  readonly maxTerms: number;
}

export interface ExploreCandidate {
  readonly objectId: string;
  readonly score: number;
}

export interface ExploreSearchDocument {
  readonly body: string;
  readonly id: string;
  readonly path: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly type: string;
}

export interface SearchProvider {
  readonly rank: (
    documents: readonly ExploreSearchDocument[],
    query: string,
    budgets: Pick<ExploreBudgets, "maxQueryCharacters" | "maxTerms">,
  ) => readonly ExploreCandidate[];
}

export interface ExploreSourceContext {
  readonly body: string;
  readonly id: string;
  readonly path: string;
  readonly title: string;
}

export interface ExploreRouteStep {
  readonly edgeId: string | undefined;
  readonly objectId: string;
  readonly path: string;
  readonly title: string;
  readonly type: string;
}

export interface ExploreReanchor {
  readonly activePrinciples: readonly ExploreSourceContext[];
  readonly activeObjective: string;
  readonly anchor: ExploreSourceContext;
  readonly governingTruths: readonly ExploreGoverningTruth[];
}

export interface ExploreGoverningTruth {
  readonly principleId: string;
  readonly text: string;
  readonly truthId: string;
}

export interface ExploreResultItem {
  readonly citedContext: readonly ExploreSourceContext[];
  readonly result: ExploreSourceContext & { readonly type: string };
  readonly route: readonly ExploreRouteStep[];
}

export type ExploreDegradationLevel =
  "blocked" | "partial-structure" | "raw-markdown" | "valid-structured";

export interface ExplorePayload {
  readonly degradation: {
    readonly diagnostics: readonly Finding[];
    readonly level: ExploreDegradationLevel;
    readonly remediation: string | undefined;
  };
  readonly reanchors: readonly ExploreReanchor[];
  readonly results: readonly ExploreResultItem[];
}

type Edge = AtlasViewEdge;

interface AtlasObject {
  readonly body: string;
  readonly id: string;
  readonly path: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly type: string;
}

interface Route {
  readonly edges: readonly string[];
  readonly nodes: readonly string[];
}

interface TraversalIndex {
  readonly diagnostics: readonly Finding[];
  readonly edges: readonly Edge[];
  readonly level: ExploreDegradationLevel;
  readonly objects: ReadonlyMap<string, AtlasObject>;
  readonly remediation: string | undefined;
}

function diagnostic(
  code: string,
  message: string,
  path: string,
  severity: Finding["severity"],
): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity,
  });
}

function assertBudgets(budgets: ExploreBudgets): void {
  for (const value of [
    budgets.maxContextCharacters,
    budgets.maxEdges,
    budgets.maxFileBytes,
    budgets.maxObjects,
    budgets.maxQueryCharacters,
    budgets.maxResults,
    budgets.maxRouteEdges,
    budgets.maxTerms,
    budgets.maxTotalBytes,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("Explore budgets must be non-negative safe integers.");
    }
  }
}

function rawMarkdownTraversalIndex(
  files: readonly AtlasTextFile[],
  diagnostics: readonly Finding[],
): TraversalIndex {
  const objects = new Map<string, AtlasObject>();
  for (const file of files.toSorted((left, right) =>
    compareCodePoints(left.path, right.path),
  )) {
    if (!file.path.startsWith(".atlas/") || !file.path.endsWith(".md")) continue;
    const id = `raw-markdown/${file.path}`;
    objects.set(
      id,
      Object.freeze({
        body: file.content,
        id,
        path: file.path,
        tags: Object.freeze([]),
        title: file.path,
        type: "raw-markdown",
      }),
    );
  }
  return Object.freeze({
    diagnostics,
    edges: Object.freeze([]),
    level: "raw-markdown",
    objects,
    remediation:
      "Repair Atlas page frontmatter to restore Anchor routing and Re-anchoring.",
  });
}

function structuredTraversalIndex(
  atlasView: AtlasView,
  diagnostics: readonly Finding[],
  level: ExploreDegradationLevel,
  budgets: ExploreBudgets,
): TraversalIndex {
  const objects = new Map<string, AtlasObject>();
  const edges: Edge[] = [];
  const viewDiagnostics = [...diagnostics];
  const orderedObjects = atlasView.objects.toSorted((left, right) => {
    if (left.path === ".atlas/index.md") return -1;
    if (right.path === ".atlas/index.md") return 1;
    return compareCodePoints(left.path, right.path);
  });
  for (const object of orderedObjects) {
    if (objects.size >= budgets.maxObjects) {
      viewDiagnostics.push(
        diagnostic(
          "ATLAS_EXPLORE_OBJECT_BUDGET_EXHAUSTED",
          "Explore object budget was exhausted before every usable Atlas page was loaded.",
          ".atlas",
          "warning",
        ),
      );
      break;
    }
    objects.set(object.id, object);
    if (object.type === "edge" && edges.length < budgets.maxEdges) {
      const edge = atlasView.graphIndexes.edgeByObjectId.get(object.id);
      if (edge !== undefined) edges.push(edge);
    } else if (object.type === "edge") {
      viewDiagnostics.push(
        diagnostic(
          "ATLAS_EXPLORE_EDGE_BUDGET_EXHAUSTED",
          "Explore Edge budget was exhausted before every usable Edge was loaded.",
          ".atlas",
          "warning",
        ),
      );
    }
  }
  edges.sort((left, right) => compareCodePoints(left.id, right.id));
  const exhausted = viewDiagnostics.length > diagnostics.length;
  const viewLevel: ExploreDegradationLevel = exhausted ? "partial-structure" : level;
  return Object.freeze({
    diagnostics: Object.freeze(viewDiagnostics),
    edges: Object.freeze(edges),
    level: viewLevel,
    objects,
    remediation:
      viewLevel === "valid-structured"
        ? undefined
        : "Repair the reported Atlas structural Findings and run Explore again.",
  });
}

function traversalIndexFrom(
  atlasView: AtlasView,
  files: readonly AtlasTextFile[],
  budgets: ExploreBudgets,
): TraversalIndex {
  const validationFindings = atlasView.validationState.findings;
  if (files.length === 0) {
    return Object.freeze({
      diagnostics: validationFindings,
      edges: Object.freeze([]),
      level: "blocked" as const,
      objects: new Map(),
      remediation:
        "Provide at least one readable Atlas page or raw .atlas Markdown file.",
    });
  }

  if (atlasView.objects.length === 0) {
    return rawMarkdownTraversalIndex(files, validationFindings);
  }
  const rootMissing = !atlasView.graphIndexes.objectsByPath.has(".atlas/index.md");
  if (rootMissing) {
    return Object.freeze({
      diagnostics: validationFindings,
      edges: Object.freeze([]),
      level: "blocked" as const,
      objects: new Map(),
      remediation: "Restore the Root Anchor at .atlas/index.md before running Explore.",
    });
  }
  const diagnostics = validationFindings;
  return structuredTraversalIndex(
    atlasView,
    diagnostics,
    atlasView.validationState.state === "valid"
      ? "valid-structured"
      : "partial-structure",
    budgets,
  );
}

function contextOf(object: AtlasObject, maxCharacters: number): ExploreSourceContext {
  return Object.freeze({
    body: object.body.slice(0, maxCharacters),
    id: object.id,
    path: object.path,
    title: object.title,
  });
}

function citedContext(
  result: AtlasObject,
  objects: ReadonlyMap<string, AtlasObject>,
  maxCharacters: number,
): readonly ExploreSourceContext[] {
  const byPath = new Map<string, AtlasObject>();
  for (const object of objects.values()) byPath.set(object.path, object);
  const contexts: ExploreSourceContext[] = [contextOf(result, maxCharacters)];
  for (const path of resolvedCitationSourcePaths(result.body)) {
    const source = byPath.get(path);
    if (source !== undefined) contexts.push(contextOf(source, maxCharacters));
  }
  return Object.freeze(contexts);
}

function adjacency(
  view: TraversalIndex,
): ReadonlyMap<string, readonly ExploreRouteStep[]> {
  const next = new Map<string, ExploreRouteStep[]>();
  const add = (from: string, to: AtlasObject, edgeId: string | undefined): void => {
    const entries = next.get(from) ?? [];
    entries.push({
      edgeId,
      objectId: to.id,
      path: to.path,
      title: to.title,
      type: to.type,
    });
    next.set(from, entries);
  };
  for (const edge of view.edges) {
    const from = view.objects.get(edge.from);
    const to = view.objects.get(edge.to);
    if (from === undefined || to === undefined) continue;
    add(from.id, to, edge.id);
    add(to.id, from, edge.id);
  }
  for (const [key, entries] of next) {
    next.set(
      key,
      entries.toSorted((left, right) => {
        return compareCodePoints(left.objectId, right.objectId);
      }),
    );
  }
  return next;
}

function edgeOnlyAdjacency(
  view: TraversalIndex,
): ReadonlyMap<string, readonly string[]> {
  const next = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    const entries = next.get(from) ?? [];
    entries.push(to);
    next.set(from, entries);
  };
  for (const edge of view.edges) {
    if (!view.objects.has(edge.from) || !view.objects.has(edge.to)) continue;
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  for (const [key, entries] of next) {
    next.set(key, entries.toSorted(compareCodePoints));
  }
  return next;
}

function anchorReachableObjects(view: TraversalIndex): ReadonlySet<string> {
  const graph = edgeOnlyAdjacency(view);
  const reached = new Set<string>();
  const queue = [...view.objects.values()]
    .filter((object) => object.type === "anchor")
    .map((object) => object.id)
    .sort(compareCodePoints);
  for (const id of queue) reached.add(id);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of graph.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

function adjacencyWithRootCatalog(
  view: TraversalIndex,
): ReadonlyMap<string, readonly ExploreRouteStep[]> {
  const next = new Map(adjacency(view));
  const root = view.objects.get(rootAnchorPageId) as AtlasObject;
  const reached = anchorReachableObjects(view);
  const entries = [...(next.get(root.id) ?? [])];
  for (const object of [...view.objects.values()].sort((left, right) =>
    compareCodePoints(left.id, right.id),
  )) {
    const catalogEligible = object.type !== "edge" && object.type !== "source";
    const catalogNeeded =
      object.type === "anchor" || (catalogEligible && !reached.has(object.id));
    if (object.id !== root.id && catalogNeeded) {
      entries.push({
        edgeId: undefined,
        objectId: object.id,
        path: object.path,
        title: object.title,
        type: object.type,
      });
    }
  }
  next.set(
    root.id,
    entries.toSorted((left, right) => compareCodePoints(left.objectId, right.objectId)),
  );
  return next;
}

function activePrinciples(
  anchor: AtlasObject,
  graph: ReadonlyMap<string, readonly ExploreRouteStep[]>,
  objects: ReadonlyMap<string, AtlasObject>,
  maxCharacters: number,
): readonly ExploreSourceContext[] {
  const principles: ExploreSourceContext[] = [];
  for (const step of graph.get(anchor.id) ?? []) {
    const object = objects.get(step.objectId);
    if (object?.type === "principle") principles.push(contextOf(object, maxCharacters));
  }
  principles.sort((left, right) => compareCodePoints(left.id, right.id));
  return Object.freeze(principles);
}

function governingTruths(
  principles: readonly ExploreSourceContext[],
): readonly ExploreGoverningTruth[] {
  const truths: ExploreGoverningTruth[] = [];
  for (const principle of principles) {
    for (const truth of extractAtlasPrincipleActiveTruths(principle.body)) {
      truths.push(
        Object.freeze({
          principleId: principle.id,
          text: truth.text,
          truthId: truth.truthId,
        }),
      );
    }
  }
  return Object.freeze(
    truths.toSorted((left, right) =>
      compareCodePoints(
        `${left.principleId}\u{1f}${left.truthId}`,
        `${right.principleId}\u{1f}${right.truthId}`,
      ),
    ),
  );
}

function routeSteps(route: Route, view: TraversalIndex): readonly ExploreRouteStep[] {
  return Object.freeze(
    route.nodes.map((node, index) => {
      const object = view.objects.get(node) as AtlasObject;
      return Object.freeze({
        edgeId: index === 0 ? undefined : route.edges[index - 1],
        objectId: object.id,
        path: object.path,
        title: object.title,
        type: object.type,
      });
    }),
  );
}

function discoverRoutes(
  view: TraversalIndex,
  activeObjective: string,
  budgets: ExploreBudgets,
): {
  readonly reanchors: readonly ExploreReanchor[];
  readonly routes: ReadonlyMap<string, Route>;
} {
  const root = view.objects.get(rootAnchorPageId) as AtlasObject;
  const graph = adjacencyWithRootCatalog(view);
  const reanchored = new Set<string>();
  const reanchors: ExploreReanchor[] = [];
  const routes = new Map<string, Route>();
  const enqueued = new Set<string>([root.id]);
  const queue: Route[] = [
    { edges: Object.freeze([]), nodes: Object.freeze([root.id]) },
  ];
  while (queue.length > 0) {
    const route = queue.shift() as Route;
    const currentId = route.nodes.at(-1) as string;
    routes.set(currentId, route);
    const current = view.objects.get(currentId) as AtlasObject;
    if (current.type === "anchor" && !reanchored.has(current.id)) {
      reanchored.add(current.id);
      const activePrincipleContexts = activePrinciples(
        current,
        graph,
        view.objects,
        budgets.maxContextCharacters,
      );
      reanchors.push(
        Object.freeze({
          activeObjective,
          activePrinciples: activePrincipleContexts,
          anchor: contextOf(current, budgets.maxContextCharacters),
          governingTruths: governingTruths(activePrincipleContexts),
        }),
      );
    }
    if (route.edges.length >= budgets.maxRouteEdges) continue;
    for (const step of graph.get(currentId) ?? []) {
      if (enqueued.has(step.objectId)) continue;
      enqueued.add(step.objectId);
      queue.push(
        Object.freeze({
          edges: Object.freeze([...route.edges, step.edgeId ?? "root-anchor-catalog"]),
          nodes: Object.freeze([...route.nodes, step.objectId]),
        }),
      );
    }
  }
  return { reanchors: Object.freeze(reanchors), routes };
}

function documentsOf(view: TraversalIndex): readonly ExploreSearchDocument[] {
  const documents = [...view.objects.values()]
    .filter((object) => object.type !== "edge" && object.type !== "source")
    .map((object) =>
      Object.freeze({
        body: object.body,
        id: object.id,
        path: object.path,
        tags: object.tags,
        title: object.title,
        type: object.type,
      }),
    )
    .sort((left, right) => compareCodePoints(left.id, right.id));
  return Object.freeze(documents);
}

function compareItems(
  candidates: ReadonlyMap<string, number>,
): (left: ExploreResultItem, right: ExploreResultItem) => number {
  return (left, right) => {
    const score =
      (candidates.get(right.result.id) as number) -
      (candidates.get(left.result.id) as number);
    if (score !== 0) return score;
    const length = left.route.length - right.route.length;
    if (length !== 0) return length;
    const route = compareCodePoints(
      left.route.map((step) => step.objectId).join("\u{1f}"),
      right.route.map((step) => step.objectId).join("\u{1f}"),
    );
    return route;
  };
}

function rankedCandidates(
  ranked: readonly ExploreCandidate[],
  view: TraversalIndex,
): {
  readonly diagnostics: readonly Finding[];
  readonly ranked: readonly ExploreCandidate[];
} {
  const diagnostics: Finding[] = [];
  const valid: ExploreCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of ranked) {
    if (
      typeof candidate.objectId !== "string" ||
      !Number.isFinite(candidate.score) ||
      candidate.score <= 0 ||
      !view.objects.has(candidate.objectId) ||
      seen.has(candidate.objectId)
    ) {
      diagnostics.push(
        diagnostic(
          "ATLAS_EXPLORE_PROVIDER_CANDIDATE_INVALID",
          "Search Provider returned a candidate Explore could not use.",
          ".atlas",
          "warning",
        ),
      );
      continue;
    }
    seen.add(candidate.objectId);
    valid.push(candidate);
  }
  return { diagnostics: Object.freeze(diagnostics), ranked: Object.freeze(valid) };
}

export function exploreAtlas(
  atlasView: AtlasView,
  query: string,
  provider: SearchProvider,
  budgets: ExploreBudgets,
): ExplorePayload {
  assertBudgets(budgets);
  if (query.length > budgets.maxQueryCharacters) {
    return Object.freeze({
      degradation: Object.freeze({
        diagnostics: Object.freeze([
          diagnostic(
            "ATLAS_EXPLORE_QUERY_TOO_LARGE",
            "Explore query exceeds the declared character budget.",
            ".atlas",
            "error",
          ),
        ]),
        level: "blocked" as const,
        remediation: "Shorten the Explore request and run Explore again.",
      }),
      reanchors: Object.freeze([]),
      results: Object.freeze([]),
    });
  }
  const view = traversalIndexFrom(atlasView, atlasView.files, budgets);
  if (view.level === "blocked" || view.objects.size === 0) {
    return Object.freeze({
      degradation: Object.freeze({
        diagnostics: view.diagnostics,
        level: "blocked" as const,
        remediation: view.remediation,
      }),
      reanchors: Object.freeze([]),
      results: Object.freeze([]),
    });
  }
  if (view.level === "raw-markdown") {
    const documents = documentsOf(view);
    const candidates = rankedCandidates(provider.rank(documents, query, budgets), view);
    const results = candidates.ranked.slice(0, budgets.maxResults).map((candidate) => {
      const result = view.objects.get(candidate.objectId) as AtlasObject;
      return Object.freeze({
        citedContext: Object.freeze([contextOf(result, budgets.maxContextCharacters)]),
        result: Object.freeze({
          ...contextOf(result, budgets.maxContextCharacters),
          type: result.type,
        }),
        route: Object.freeze([]),
      });
    });
    return Object.freeze({
      degradation: Object.freeze({
        diagnostics: Object.freeze([...view.diagnostics, ...candidates.diagnostics]),
        level:
          candidates.diagnostics.length === 0 ? "raw-markdown" : "partial-structure",
        remediation: view.remediation,
      }),
      reanchors: Object.freeze([]),
      results: Object.freeze(results),
    });
  }

  const documents = documentsOf(view);
  const candidates = rankedCandidates(provider.rank(documents, query, budgets), view);
  const ranked = candidates.ranked;
  const candidateScores = new Map(
    ranked.map((candidate) => [candidate.objectId, candidate.score]),
  );
  const { reanchors, routes } = discoverRoutes(view, query, budgets);
  const results = ranked
    .flatMap((candidate): readonly ExploreResultItem[] => {
      const object = view.objects.get(candidate.objectId);
      const route = routes.get(candidate.objectId);
      if (object === undefined || route === undefined) return [];
      return [
        Object.freeze({
          citedContext: citedContext(
            object,
            view.objects,
            budgets.maxContextCharacters,
          ),
          result: Object.freeze({
            ...contextOf(object, budgets.maxContextCharacters),
            type: object.type,
          }),
          route: routeSteps(route, view),
        }),
      ];
    })
    .toSorted(compareItems(candidateScores))
    .slice(0, budgets.maxResults);

  const diagnostics = Object.freeze([...view.diagnostics, ...candidates.diagnostics]);
  const level =
    diagnostics.length === 0 && view.level === "valid-structured"
      ? "valid-structured"
      : "partial-structure";
  return Object.freeze({
    degradation: Object.freeze({
      diagnostics,
      level,
      remediation: level === "valid-structured" ? undefined : view.remediation,
    }),
    reanchors,
    results: Object.freeze(results),
  });
}
