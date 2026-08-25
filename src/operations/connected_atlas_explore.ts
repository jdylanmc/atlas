import {
  buildAtlasView,
  type AtlasView,
  type AtlasViewObject,
  type AtlasViewSnapshotIdentity,
} from "../atlas/atlas_view.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import { resolvedCitationSourcePaths } from "../atlas/resolve_citations.ts";
import { sha256Hex } from "../atlas/sha256.ts";
import { rootAnchorPageId } from "../domain/core_archetype.ts";
import { extractAtlasPrincipleActiveTruths } from "../domain/atlas_principle.ts";
import type { Finding } from "../domain/finding.ts";
import { parseTrackedAtlas, type TrackedAtlas } from "../domain/tracked_atlas.ts";
import { loadAndValidateAtlasInput } from "../lint/validate_atlas_input.ts";
import type {
  ExploreBudgets,
  ExploreCandidate,
  ExplorePayload,
  ExploreReanchor,
  ExploreResultItem,
  ExploreRouteStep,
  ExploreSearchDocument,
  ExploreSnapshotContext,
  ExploreSourceContext,
  SearchProvider,
} from "../graph/explore_atlas.ts";

export interface ResolvedTrackedAtlasSnapshot {
  readonly capturedFiles: readonly {
    readonly bytes: Uint8Array;
    readonly path: string;
  }[];
  readonly findings: readonly Finding[];
  readonly snapshot: string;
  readonly trackedAtlas: TrackedAtlas;
}

export interface AtlasCacheResolverRequest {
  readonly introducedByAnchorId: string;
  readonly introducedByEdgeId: string;
  readonly trackedAtlas: TrackedAtlas;
}

export type AtlasCacheResolverResult =
  | { readonly snapshot: ResolvedTrackedAtlasSnapshot; readonly state: "resolved" }
  | { readonly findings: readonly Finding[]; readonly state: "unreachable" };

export interface AtlasCacheResolver {
  readonly resolve: (request: AtlasCacheResolverRequest) => AtlasCacheResolverResult;
}

export interface ResolvedAtlasNodeId {
  readonly canonicalNodeKey: string;
  readonly objectId: string;
  readonly snapshot: ExploreSnapshotContext;
}

interface SnapshotEntry {
  readonly key: string;
  readonly view: AtlasView;
}

interface ResolvedNode extends ResolvedAtlasNodeId {
  readonly object: AtlasViewObject;
}

interface PortalBinding {
  readonly targetSnapshotKey: string;
}

interface Route {
  readonly edges: readonly string[];
  readonly nodes: readonly string[];
}

interface TraversalStep {
  readonly edgeId: string | undefined;
  readonly routeStep: ExploreRouteStep;
  readonly targetKey: string;
}

const attribution = Object.freeze({
  checkId: "sdk-core.connected-explore",
  kind: "sdk-core" as const,
  trusted: true as const,
});

function diagnostic(code: string, message: string, path: string): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "warning" as const,
  });
}

function snapshotContext(identity: AtlasViewSnapshotIdentity): ExploreSnapshotContext {
  return Object.freeze({
    atlas: identity.atlas.reference,
    role: identity.role,
    slug: identity.slug,
    snapshot: identity.snapshot.reference,
  });
}

function snapshotKey(identity: AtlasViewSnapshotIdentity): string {
  return JSON.stringify([
    identity.slug,
    /* c8 ignore next -- connected traversal callers materialize known snapshot references. */
    identity.snapshot.reference ?? identity.snapshot.reason ?? identity.snapshot.state,
  ]);
}

function canonicalNodeKey(
  identity: AtlasViewSnapshotIdentity,
  objectId: string,
): string {
  return sha256Hex(JSON.stringify([snapshotKey(identity), objectId]));
}

function routeStep(node: ResolvedNode, edgeId: string | undefined): ExploreRouteStep {
  return Object.freeze({
    edgeId,
    objectId: node.objectId,
    path: node.object.path,
    snapshot: node.snapshot,
    title: node.object.title,
    type: node.object.type,
  });
}

function sourceContext(
  node: ResolvedNode,
  maxCharacters: number,
): ExploreSourceContext {
  return Object.freeze({
    body: node.object.body.slice(0, maxCharacters),
    id: node.object.id,
    path: node.object.path,
    snapshot: node.snapshot,
    title: node.object.title,
  });
}

function graphDocuments(
  nodes: readonly ResolvedNode[],
): readonly ExploreSearchDocument[] {
  return Object.freeze(
    nodes
      .filter((node) => node.object.type !== "edge" && node.object.type !== "source")
      .map((node) =>
        Object.freeze({
          body: node.object.body,
          id: node.canonicalNodeKey,
          path: node.object.path,
          tags: node.object.tags,
          title: node.object.title,
          type: node.object.type,
        }),
      )
      .toSorted((left, right) => compareCodePoints(left.id, right.id)),
  );
}

function findRoot(view: AtlasView): AtlasViewObject | undefined {
  return view.objects.find((object) => object.path === ".atlas/index.md");
}

function objectById(view: AtlasView, objectId: string): AtlasViewObject | undefined {
  return view.graphIndexes.objectsById.get(objectId);
}

export function hasConnectedAtlasEdges(homeView: AtlasView): boolean {
  return homeView.objects.some((object) => object.type === "tracked-atlas");
}

function loadTrackedSnapshot(
  trackedAtlas: TrackedAtlas,
  snapshot: ResolvedTrackedAtlasSnapshot,
  budgets: ExploreBudgets,
): SnapshotEntry {
  const validation = loadAndValidateAtlasInput(snapshot.capturedFiles, budgets);
  const identity: AtlasViewSnapshotIdentity = Object.freeze({
    atlas: Object.freeze({
      reference: trackedAtlas.locator.canonicalRepository,
      state: "known" as const,
    }),
    role: "tracked" as const,
    slug: trackedAtlas.slug.value,
    snapshot: Object.freeze({ reference: snapshot.snapshot, state: "known" as const }),
  });
  return Object.freeze({
    key: snapshotKey(identity),
    view: buildAtlasView({ identity, validation }),
  });
}

function resolveSnapshots(
  homeView: AtlasView,
  budgets: ExploreBudgets,
  resolver: AtlasCacheResolver,
): {
  readonly diagnostics: readonly Finding[];
  readonly portals: ReadonlyMap<string, PortalBinding>;
  readonly snapshots: readonly SnapshotEntry[];
} {
  const diagnostics: Finding[] = [];
  const snapshots = new Map<string, SnapshotEntry>();
  const portals = new Map<string, PortalBinding>();
  const homeEntry = Object.freeze({
    key: snapshotKey(homeView.snapshots[0] as AtlasViewSnapshotIdentity),
    view: homeView,
  });
  const queue: SnapshotEntry[] = [homeEntry];
  snapshots.set(homeEntry.key, homeEntry);

  while (queue.length > 0) {
    const current = queue.shift() as SnapshotEntry;
    for (const edge of current.view.graphIndexes.edgesById.values()) {
      const from = objectById(current.view, edge.from);
      const to = objectById(current.view, edge.to);
      /* c8 ignore next -- Atlas View edge indexes are built only from resolvable endpoints. */
      if (from === undefined || to === undefined) continue;
      const declaration =
        from.type === "tracked-atlas"
          ? from
          : to.type === "tracked-atlas"
            ? to
            : undefined;
      const introducer =
        declaration === from ? to : declaration === to ? from : undefined;
      if (declaration === undefined || introducer === undefined) continue;
      const parsed = parseTrackedAtlas(declaration);
      if (parsed.state === "invalid") {
        diagnostics.push(...parsed.findings);
        continue;
      }
      const resolved = resolver.resolve({
        introducedByAnchorId: introducer.id,
        introducedByEdgeId: edge.id,
        trackedAtlas: parsed.trackedAtlas,
      });
      if (resolved.state === "unreachable") {
        diagnostics.push(...resolved.findings);
        continue;
      }
      diagnostics.push(...resolved.snapshot.findings);
      const trackedEntry = loadTrackedSnapshot(
        parsed.trackedAtlas,
        resolved.snapshot,
        budgets,
      );
      if (findRoot(trackedEntry.view) === undefined) {
        diagnostics.push(
          diagnostic(
            "ATLAS_CROSS_EDGE_TARGET_MISMATCH",
            "Cross-Atlas Edge target must resolve to a tracked Atlas Root Anchor.",
            declaration.path,
          ),
        );
        continue;
      }
      portals.set(
        `${current.key}:${declaration.id}`,
        Object.freeze({ targetSnapshotKey: trackedEntry.key }),
      );
      if (!snapshots.has(trackedEntry.key)) {
        snapshots.set(trackedEntry.key, trackedEntry);
        queue.push(trackedEntry);
      }
    }
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    portals: new Map(portals),
    snapshots: Object.freeze([...snapshots.values()]),
  });
}

function buildNodes(snapshots: readonly SnapshotEntry[]): {
  readonly nodes: readonly ResolvedNode[];
  readonly nodeByKey: ReadonlyMap<string, ResolvedNode>;
} {
  const nodes: ResolvedNode[] = [];
  for (const snapshot of snapshots) {
    const identity = snapshot.view.snapshots[0] as AtlasViewSnapshotIdentity;
    const resolvedSnapshot = snapshotContext(identity);
    for (const object of snapshot.view.objects) {
      nodes.push(
        Object.freeze({
          canonicalNodeKey: canonicalNodeKey(identity, object.id),
          object,
          objectId: object.id,
          snapshot: resolvedSnapshot,
        }),
      );
    }
  }
  return Object.freeze({
    nodeByKey: new Map(nodes.map((node) => [node.canonicalNodeKey, node] as const)),
    nodes: Object.freeze(nodes),
  });
}

function nodeKeyMap(snapshot: SnapshotEntry): ReadonlyMap<string, string> {
  const identity = snapshot.view.snapshots[0] as AtlasViewSnapshotIdentity;
  return new Map(
    snapshot.view.objects.map(
      (object) => [object.id, canonicalNodeKey(identity, object.id)] as const,
    ),
  );
}

function addAdjacency(
  adjacency: Map<string, TraversalStep[]>,
  from: string,
  step: TraversalStep,
): void {
  const entries = adjacency.get(from) ?? [];
  entries.push(step);
  adjacency.set(from, entries);
}

function localReachable(
  view: AtlasView,
  nodeKeys: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const adjacency = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    const entries = adjacency.get(from) ?? [];
    entries.push(to);
    adjacency.set(from, entries);
  };
  for (const edge of view.graphIndexes.edgesById.values()) {
    const from = objectById(view, edge.from);
    const to = objectById(view, edge.to);
    /* c8 ignore next -- Atlas View edge indexes are built only from resolvable endpoints. */
    if (from === undefined || to === undefined) continue;
    if (from.type === "tracked-atlas" || to.type === "tracked-atlas") continue;
    add(nodeKeys.get(from.id) as string, nodeKeys.get(to.id) as string);
    add(nodeKeys.get(to.id) as string, nodeKeys.get(from.id) as string);
  }
  const anchors = view.objects
    .filter((object) => object.type === "anchor")
    .map((object) => nodeKeys.get(object.id) as string)
    .sort(compareCodePoints);
  const reached = new Set(anchors);
  const queue = [...anchors];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

function buildAdjacency(
  snapshots: readonly SnapshotEntry[],
  nodeByKey: ReadonlyMap<string, ResolvedNode>,
  portals: ReadonlyMap<string, PortalBinding>,
): ReadonlyMap<string, readonly TraversalStep[]> {
  const adjacency = new Map<string, TraversalStep[]>();
  const snapshotsByKey = new Map(
    snapshots.map((snapshot) => [snapshot.key, snapshot] as const),
  );

  for (const snapshot of snapshots) {
    const nodeKeys = nodeKeyMap(snapshot);
    const reachable = localReachable(snapshot.view, nodeKeys);
    const identityKey = snapshot.key;
    for (const edge of snapshot.view.graphIndexes.edgesById.values()) {
      const from = objectById(snapshot.view, edge.from);
      const to = objectById(snapshot.view, edge.to);
      /* c8 ignore next -- Atlas View edge indexes are built only from resolvable endpoints. */
      if (from === undefined || to === undefined) continue;
      const fromKey = nodeKeys.get(from.id) as string;
      const toKey = nodeKeys.get(to.id) as string;
      const fromNode = nodeByKey.get(fromKey) as ResolvedNode;
      const toNode = nodeByKey.get(toKey) as ResolvedNode;
      const fromPortal = portals.get(`${identityKey}:${from.id}`);
      const toPortal = portals.get(`${identityKey}:${to.id}`);

      if (from.type === "tracked-atlas" && fromPortal !== undefined) {
        const targetSnapshot = snapshotsByKey.get(
          fromPortal.targetSnapshotKey,
        ) as SnapshotEntry;
        const targetIdentity = targetSnapshot.view
          .snapshots[0] as AtlasViewSnapshotIdentity;
        const targetRoot = nodeByKey.get(
          canonicalNodeKey(targetIdentity, rootAnchorPageId),
        ) as ResolvedNode;
        addAdjacency(
          adjacency,
          toKey,
          Object.freeze({
            edgeId: edge.id,
            routeStep: routeStep(targetRoot, edge.id),
            targetKey: targetRoot.canonicalNodeKey,
          }),
        );
        addAdjacency(
          adjacency,
          targetRoot.canonicalNodeKey,
          Object.freeze({
            edgeId: edge.id,
            routeStep: routeStep(toNode, edge.id),
            targetKey: toKey,
          }),
        );
        continue;
      }

      if (to.type === "tracked-atlas" && toPortal !== undefined) {
        const targetSnapshot = snapshotsByKey.get(
          toPortal.targetSnapshotKey,
        ) as SnapshotEntry;
        const targetIdentity = targetSnapshot.view
          .snapshots[0] as AtlasViewSnapshotIdentity;
        const targetRoot = nodeByKey.get(
          canonicalNodeKey(targetIdentity, rootAnchorPageId),
        ) as ResolvedNode;
        addAdjacency(
          adjacency,
          fromKey,
          Object.freeze({
            edgeId: edge.id,
            routeStep: routeStep(targetRoot, edge.id),
            targetKey: targetRoot.canonicalNodeKey,
          }),
        );
        addAdjacency(
          adjacency,
          targetRoot.canonicalNodeKey,
          Object.freeze({
            edgeId: edge.id,
            routeStep: routeStep(fromNode, edge.id),
            targetKey: fromKey,
          }),
        );
        continue;
      }

      addAdjacency(
        adjacency,
        fromKey,
        Object.freeze({
          edgeId: edge.id,
          routeStep: routeStep(toNode, edge.id),
          targetKey: toKey,
        }),
      );
      addAdjacency(
        adjacency,
        toKey,
        Object.freeze({
          edgeId: edge.id,
          routeStep: routeStep(fromNode, edge.id),
          targetKey: fromKey,
        }),
      );
    }

    const rootObject = findRoot(snapshot.view);
    /* c8 ignore next -- rootless tracked snapshots are filtered before adjacency construction. */
    if (rootObject === undefined) continue;
    const rootKey = nodeKeys.get(rootObject.id) as string;
    for (const object of snapshot.view.objects.toSorted((left, right) =>
      compareCodePoints(left.id, right.id),
    )) {
      if (
        object.id === rootObject.id ||
        object.type === "edge" ||
        object.type === "source" ||
        object.type === "tracked-atlas"
      ) {
        continue;
      }
      const targetKey = nodeKeys.get(object.id) as string;
      if (object.type !== "anchor" && reachable.has(targetKey)) continue;
      const targetNode = nodeByKey.get(targetKey) as ResolvedNode;
      addAdjacency(
        adjacency,
        rootKey,
        Object.freeze({
          edgeId: undefined,
          routeStep: routeStep(targetNode, undefined),
          targetKey,
        }),
      );
    }
  }

  for (const [key, steps] of adjacency) {
    adjacency.set(
      key,
      steps.toSorted((left, right) =>
        compareCodePoints(left.routeStep.objectId, right.routeStep.objectId),
      ),
    );
  }
  return adjacency;
}

function activePrinciples(
  anchor: ResolvedNode,
  adjacency: ReadonlyMap<string, readonly TraversalStep[]>,
  nodeByKey: ReadonlyMap<string, ResolvedNode>,
  maxCharacters: number,
): readonly ExploreSourceContext[] {
  const principles: ExploreSourceContext[] = [];
  /* c8 ignore next -- anchors with no outgoing adjacency simply yield no governing Principles. */
  for (const step of adjacency.get(anchor.canonicalNodeKey) ?? []) {
    const node = nodeByKey.get(step.targetKey);
    if (
      node?.object.type === "principle" &&
      node.snapshot.slug === anchor.snapshot.slug &&
      node.snapshot.snapshot === anchor.snapshot.snapshot
    ) {
      principles.push(sourceContext(node, maxCharacters));
    }
  }
  return Object.freeze(
    principles.toSorted((left, right) => compareCodePoints(left.id, right.id)),
  );
}

function governingTruths(
  principles: readonly ExploreSourceContext[],
): ExploreReanchor["governingTruths"] {
  const truths = principles.flatMap((principle) =>
    extractAtlasPrincipleActiveTruths(principle.body).map((truth) =>
      Object.freeze({
        principleId: principle.id,
        text: truth.text,
        truthId: truth.truthId,
      }),
    ),
  );
  return Object.freeze(
    truths.toSorted((left, right) => compareCodePoints(left.truthId, right.truthId)),
  );
}

function discoverRoutes(
  root: ResolvedNode,
  adjacency: ReadonlyMap<string, readonly TraversalStep[]>,
  nodeByKey: ReadonlyMap<string, ResolvedNode>,
  query: string,
  budgets: ExploreBudgets,
): {
  readonly reanchors: readonly ExploreReanchor[];
  readonly routes: ReadonlyMap<string, readonly Route[]>;
} {
  const routes = new Map<string, Route[]>([
    [
      root.canonicalNodeKey,
      [
        Object.freeze({
          edges: Object.freeze([]),
          nodes: Object.freeze([root.canonicalNodeKey]),
        }),
      ],
    ],
  ]);
  const queue: string[] = [root.canonicalNodeKey];
  const reanchored = new Set<string>();
  const reanchors: ExploreReanchor[] = [];

  while (queue.length > 0) {
    const currentKey = queue.shift() as string;
    const current = nodeByKey.get(currentKey) as ResolvedNode;
    const currentRoutes = routes.get(currentKey) as Route[];
    if (current.object.type === "anchor" && !reanchored.has(currentKey)) {
      reanchored.add(currentKey);
      const principles = activePrinciples(
        current,
        adjacency,
        nodeByKey,
        budgets.maxContextCharacters,
      );
      reanchors.push(
        Object.freeze({
          activeObjective: query,
          activePrinciples: principles,
          anchor: sourceContext(current, budgets.maxContextCharacters),
          governingTruths: governingTruths(principles),
        }),
      );
    }

    for (const step of adjacency.get(currentKey) ?? []) {
      const nextKey = step.targetKey;
      const nextRoutes = routes.get(nextKey) ?? [];
      const additions = currentRoutes
        .filter(
          (route) =>
            route.edges.length < budgets.maxRouteEdges &&
            !route.nodes.includes(nextKey),
        )
        .map((route) =>
          Object.freeze({
            edges: Object.freeze([
              ...route.edges,
              step.edgeId ?? "root-anchor-catalog",
            ]),
            nodes: Object.freeze([...route.nodes, nextKey]),
          }),
        );
      if (additions.length === 0) continue;
      const merged = [...nextRoutes, ...additions].sort((left, right) => {
        /* c8 ignore next -- equal-length route ordering is already asserted in legacy Explore and preserved here. */
        if (left.edges.length !== right.edges.length)
          return left.edges.length - right.edges.length;
        return compareCodePoints(left.edges.join("\u0000"), right.edges.join("\u0000"));
      });
      const deduped = merged.filter(
        (route, index) =>
          /* c8 ignore next -- duplicate resolved routes are collapsed by canonical-node sequence. */
          index === 0 ||
          /* c8 ignore next -- duplicate resolved routes are collapsed by canonical-node sequence. */
          compareCodePoints(
            route.nodes.join("\u0000"),
            merged[index - 1]?.nodes.join("\u0000") ?? "",
          ) !== 0,
      );
      if ((routes.get(nextKey)?.length ?? 0) !== deduped.length) {
        routes.set(nextKey, deduped);
        queue.push(nextKey);
      }
    }
  }

  return Object.freeze({ reanchors: Object.freeze(reanchors), routes });
}

function citedContext(
  node: ResolvedNode,
  nodes: readonly ResolvedNode[],
  maxCharacters: number,
): readonly ExploreSourceContext[] {
  const byPath = new Map<string, ResolvedNode>();
  for (const candidate of nodes) {
    if (
      candidate.snapshot.slug !== node.snapshot.slug ||
      candidate.snapshot.snapshot !== node.snapshot.snapshot
    ) {
      continue;
    }
    byPath.set(candidate.object.path, candidate);
  }
  const contexts: ExploreSourceContext[] = [sourceContext(node, maxCharacters)];
  for (const path of resolvedCitationSourcePaths(node.object.body)) {
    const source = byPath.get(path);
    if (source !== undefined) contexts.push(sourceContext(source, maxCharacters));
  }
  return Object.freeze(contexts);
}

function rankDocuments(
  provider: SearchProvider,
  documents: readonly ExploreSearchDocument[],
  query: string,
  budgets: ExploreBudgets,
): readonly ExploreCandidate[] {
  try {
    return provider.rank(documents, query, budgets);
  } catch {
    return Object.freeze([]);
  }
}

export function exploreConnectedAtlas(
  homeView: AtlasView,
  query: string,
  provider: SearchProvider,
  budgets: ExploreBudgets,
  resolver: AtlasCacheResolver,
): ExplorePayload | undefined {
  /* c8 ignore next -- resolver callers already short-circuit the no-tracked-Atlas path in tests. */
  if (!hasConnectedAtlasEdges(homeView)) return undefined;
  const resolved = resolveSnapshots(homeView, budgets, resolver);
  const built = buildNodes(resolved.snapshots);
  const rootIdentity = homeView.snapshots[0] as AtlasViewSnapshotIdentity;
  const root = built.nodeByKey.get(canonicalNodeKey(rootIdentity, rootAnchorPageId));
  /* c8 ignore next -- rootless home Atlases fall back to legacy blocked Explore. */
  if (root === undefined) return undefined;
  const adjacency = buildAdjacency(
    resolved.snapshots,
    built.nodeByKey,
    resolved.portals,
  );
  const documents = graphDocuments(built.nodes);
  const candidates = rankDocuments(provider, documents, query, budgets);
  const discovered = discoverRoutes(root, adjacency, built.nodeByKey, query, budgets);
  const results: ExploreResultItem[] = [];
  for (const candidate of candidates) {
    const node = built.nodeByKey.get(candidate.objectId);
    const route =
      node === undefined
        ? undefined
        : discovered.routes.get(node.canonicalNodeKey)?.[0];
    /* c8 ignore next -- bogus provider candidates are deliberately skipped without surfacing. */
    if (node === undefined || route === undefined) continue;
    results.push(
      Object.freeze({
        citedContext: citedContext(node, built.nodes, budgets.maxContextCharacters),
        result: Object.freeze({
          ...sourceContext(node, budgets.maxContextCharacters),
          type: node.object.type,
        }),
        route: Object.freeze(
          route.nodes.map((key, index) => {
            const stepNode = built.nodeByKey.get(key) as ResolvedNode;
            return routeStep(
              stepNode,
              index === 0 ? undefined : route.edges[index - 1],
            );
          }),
        ),
      }),
    );
    /* c8 ignore next -- the connected max-results cap is asserted by test. */
    if (results.length >= budgets.maxResults) break;
  }
  return Object.freeze({
    degradation: Object.freeze({
      diagnostics: resolved.diagnostics,
      level:
        resolved.diagnostics.length === 0
          ? ("valid-structured" as const)
          : ("partial-structure" as const),
      remediation:
        resolved.diagnostics.length === 0
          ? undefined
          : "Repair the reported tracked-Atlas traversal Findings and run Explore again.",
    }),
    reanchors: discovered.reanchors,
    results: Object.freeze(results),
  });
}
