import { compareCodePoints } from "../atlas/compare_code_points.js";
import { resolvedCitationSourcePaths } from "../atlas/resolve_citations.js";
import { rootAnchorPageId } from "../domain/core_archetype.js";
const attribution = Object.freeze({
    checkId: "sdk-core.explore",
    kind: "sdk-core",
    trusted: true,
});
function diagnostic(code, message, path, severity) {
    return Object.freeze({
        attribution,
        code,
        "finding-schema": "1.0.0",
        message,
        path,
        severity,
    });
}
function assertBudgets(budgets) {
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
function rawMarkdownTraversalIndex(files, diagnostics) {
    const objects = new Map();
    for (const file of files.toSorted((left, right) => compareCodePoints(left.path, right.path))) {
        if (!file.path.startsWith(".atlas/") || !file.path.endsWith(".md"))
            continue;
        const id = `raw-markdown/${file.path}`;
        objects.set(id, Object.freeze({
            body: file.content,
            id,
            path: file.path,
            tags: Object.freeze([]),
            title: file.path,
            type: "raw-markdown",
        }));
    }
    return Object.freeze({
        diagnostics,
        edges: Object.freeze([]),
        level: "raw-markdown",
        objects,
        remediation: "Repair Atlas page frontmatter to restore Anchor routing and Re-anchoring.",
    });
}
function structuredTraversalIndex(atlasView, diagnostics, level, budgets) {
    const objects = new Map();
    const edges = [];
    const viewDiagnostics = [...diagnostics];
    const orderedObjects = atlasView.objects.toSorted((left, right) => {
        if (left.path === ".atlas/index.md")
            return -1;
        if (right.path === ".atlas/index.md")
            return 1;
        return compareCodePoints(left.path, right.path);
    });
    for (const object of orderedObjects) {
        if (objects.size >= budgets.maxObjects) {
            viewDiagnostics.push(diagnostic("ATLAS_EXPLORE_OBJECT_BUDGET_EXHAUSTED", "Explore object budget was exhausted before every usable Atlas page was loaded.", ".atlas", "warning"));
            break;
        }
        objects.set(object.id, object);
        if (object.type === "edge" && edges.length < budgets.maxEdges) {
            const edge = atlasView.graphIndexes.edgeByObjectId.get(object.id);
            if (edge !== undefined)
                edges.push(edge);
        }
        else if (object.type === "edge") {
            viewDiagnostics.push(diagnostic("ATLAS_EXPLORE_EDGE_BUDGET_EXHAUSTED", "Explore Edge budget was exhausted before every usable Edge was loaded.", ".atlas", "warning"));
        }
    }
    edges.sort((left, right) => compareCodePoints(left.id, right.id));
    const exhausted = viewDiagnostics.length > diagnostics.length;
    const viewLevel = exhausted ? "partial-structure" : level;
    return Object.freeze({
        diagnostics: Object.freeze(viewDiagnostics),
        edges: Object.freeze(edges),
        level: viewLevel,
        objects,
        remediation: viewLevel === "valid-structured"
            ? undefined
            : "Repair the reported Atlas structural Findings and run Explore again.",
    });
}
function traversalIndexFrom(atlasView, files, budgets) {
    const validationFindings = atlasView.validationState.findings;
    if (files.length === 0) {
        return Object.freeze({
            diagnostics: validationFindings,
            edges: Object.freeze([]),
            level: "blocked",
            objects: new Map(),
            remediation: "Provide at least one readable Atlas page or raw .atlas Markdown file.",
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
            level: "blocked",
            objects: new Map(),
            remediation: "Restore the Root Anchor at .atlas/index.md before running Explore.",
        });
    }
    const diagnostics = validationFindings;
    return structuredTraversalIndex(atlasView, diagnostics, atlasView.validationState.state === "valid"
        ? "valid-structured"
        : "partial-structure", budgets);
}
function contextOf(object, maxCharacters) {
    return Object.freeze({
        body: object.body.slice(0, maxCharacters),
        id: object.id,
        path: object.path,
        title: object.title,
    });
}
function citedContext(result, objects, maxCharacters) {
    const byPath = new Map();
    for (const object of objects.values())
        byPath.set(object.path, object);
    const contexts = [contextOf(result, maxCharacters)];
    for (const path of resolvedCitationSourcePaths(result.body)) {
        const source = byPath.get(path);
        if (source !== undefined)
            contexts.push(contextOf(source, maxCharacters));
    }
    return Object.freeze(contexts);
}
function adjacency(view) {
    const next = new Map();
    const add = (from, to, edgeId) => {
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
        if (from === undefined || to === undefined)
            continue;
        add(from.id, to, edge.id);
        add(to.id, from, edge.id);
    }
    for (const [key, entries] of next) {
        next.set(key, entries.toSorted((left, right) => {
            return compareCodePoints(left.objectId, right.objectId);
        }));
    }
    return next;
}
function edgeOnlyAdjacency(view) {
    const next = new Map();
    const add = (from, to) => {
        const entries = next.get(from) ?? [];
        entries.push(to);
        next.set(from, entries);
    };
    for (const edge of view.edges) {
        if (!view.objects.has(edge.from) || !view.objects.has(edge.to))
            continue;
        add(edge.from, edge.to);
        add(edge.to, edge.from);
    }
    for (const [key, entries] of next) {
        next.set(key, entries.toSorted(compareCodePoints));
    }
    return next;
}
function anchorReachableObjects(view) {
    const graph = edgeOnlyAdjacency(view);
    const reached = new Set();
    const queue = [...view.objects.values()]
        .filter((object) => object.type === "anchor")
        .map((object) => object.id)
        .sort(compareCodePoints);
    for (const id of queue)
        reached.add(id);
    while (queue.length > 0) {
        const current = queue.shift();
        for (const next of graph.get(current) ?? []) {
            if (reached.has(next))
                continue;
            reached.add(next);
            queue.push(next);
        }
    }
    return reached;
}
function adjacencyWithRootCatalog(view) {
    const next = new Map(adjacency(view));
    const root = view.objects.get(rootAnchorPageId);
    const reached = anchorReachableObjects(view);
    const entries = [...(next.get(root.id) ?? [])];
    for (const object of [...view.objects.values()].sort((left, right) => compareCodePoints(left.id, right.id))) {
        const catalogEligible = object.type !== "edge" && object.type !== "source";
        const catalogNeeded = object.type === "anchor" || (catalogEligible && !reached.has(object.id));
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
    next.set(root.id, entries.toSorted((left, right) => compareCodePoints(left.objectId, right.objectId)));
    return next;
}
function activePrinciples(anchor, graph, objects, maxCharacters) {
    const principles = [];
    for (const step of graph.get(anchor.id) ?? []) {
        const object = objects.get(step.objectId);
        if (object?.type === "principle")
            principles.push(contextOf(object, maxCharacters));
    }
    principles.sort((left, right) => compareCodePoints(left.id, right.id));
    return Object.freeze(principles);
}
function governingTruths(principles) {
    const truths = [];
    for (const principle of principles) {
        const lines = principle.body.split(/\r?\n/u);
        let active = false;
        for (const line of lines) {
            if (/^## /u.test(line))
                active = line === "## Active truths";
            if (!active)
                continue;
            const match = /^- `([^`]+)` (.+)$/u.exec(line);
            if (match !== null) {
                truths.push(Object.freeze({
                    principleId: principle.id,
                    text: match[2],
                    truthId: match[1],
                }));
            }
        }
    }
    return Object.freeze(truths.toSorted((left, right) => compareCodePoints(`${left.principleId}\u{1f}${left.truthId}`, `${right.principleId}\u{1f}${right.truthId}`)));
}
function routeSteps(route, view) {
    return Object.freeze(route.nodes.map((node, index) => {
        const object = view.objects.get(node);
        return Object.freeze({
            edgeId: index === 0 ? undefined : route.edges[index - 1],
            objectId: object.id,
            path: object.path,
            title: object.title,
            type: object.type,
        });
    }));
}
function discoverRoutes(view, activeObjective, budgets) {
    const root = view.objects.get(rootAnchorPageId);
    const graph = adjacencyWithRootCatalog(view);
    const reanchored = new Set();
    const reanchors = [];
    const routes = new Map();
    const enqueued = new Set([root.id]);
    const queue = [
        { edges: Object.freeze([]), nodes: Object.freeze([root.id]) },
    ];
    while (queue.length > 0) {
        const route = queue.shift();
        const currentId = route.nodes.at(-1);
        routes.set(currentId, route);
        const current = view.objects.get(currentId);
        if (current.type === "anchor" && !reanchored.has(current.id)) {
            reanchored.add(current.id);
            const activePrincipleContexts = activePrinciples(current, graph, view.objects, budgets.maxContextCharacters);
            reanchors.push(Object.freeze({
                activeObjective,
                activePrinciples: activePrincipleContexts,
                anchor: contextOf(current, budgets.maxContextCharacters),
                governingTruths: governingTruths(activePrincipleContexts),
            }));
        }
        if (route.edges.length >= budgets.maxRouteEdges)
            continue;
        for (const step of graph.get(currentId) ?? []) {
            if (enqueued.has(step.objectId))
                continue;
            enqueued.add(step.objectId);
            queue.push(Object.freeze({
                edges: Object.freeze([...route.edges, step.edgeId ?? "root-anchor-catalog"]),
                nodes: Object.freeze([...route.nodes, step.objectId]),
            }));
        }
    }
    return { reanchors: Object.freeze(reanchors), routes };
}
function documentsOf(view) {
    const documents = [...view.objects.values()]
        .filter((object) => object.type !== "edge" && object.type !== "source")
        .map((object) => Object.freeze({
        body: object.body,
        id: object.id,
        path: object.path,
        tags: object.tags,
        title: object.title,
        type: object.type,
    }))
        .sort((left, right) => compareCodePoints(left.id, right.id));
    return Object.freeze(documents);
}
function compareItems(candidates) {
    return (left, right) => {
        const score = candidates.get(right.result.id) -
            candidates.get(left.result.id);
        if (score !== 0)
            return score;
        const length = left.route.length - right.route.length;
        if (length !== 0)
            return length;
        const route = compareCodePoints(left.route.map((step) => step.objectId).join("\u{1f}"), right.route.map((step) => step.objectId).join("\u{1f}"));
        return route;
    };
}
function rankedCandidates(ranked, view) {
    const diagnostics = [];
    const valid = [];
    const seen = new Set();
    for (const candidate of ranked) {
        if (typeof candidate.objectId !== "string" ||
            !Number.isFinite(candidate.score) ||
            candidate.score <= 0 ||
            !view.objects.has(candidate.objectId) ||
            seen.has(candidate.objectId)) {
            diagnostics.push(diagnostic("ATLAS_EXPLORE_PROVIDER_CANDIDATE_INVALID", "Search Provider returned a candidate Explore could not use.", ".atlas", "warning"));
            continue;
        }
        seen.add(candidate.objectId);
        valid.push(candidate);
    }
    return { diagnostics: Object.freeze(diagnostics), ranked: Object.freeze(valid) };
}
export function exploreAtlas(atlasView, query, provider, budgets) {
    assertBudgets(budgets);
    if (query.length > budgets.maxQueryCharacters) {
        return Object.freeze({
            degradation: Object.freeze({
                diagnostics: Object.freeze([
                    diagnostic("ATLAS_EXPLORE_QUERY_TOO_LARGE", "Explore query exceeds the declared character budget.", ".atlas", "error"),
                ]),
                level: "blocked",
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
                level: "blocked",
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
            const result = view.objects.get(candidate.objectId);
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
                level: candidates.diagnostics.length === 0 ? "raw-markdown" : "partial-structure",
                remediation: view.remediation,
            }),
            reanchors: Object.freeze([]),
            results: Object.freeze(results),
        });
    }
    const documents = documentsOf(view);
    const candidates = rankedCandidates(provider.rank(documents, query, budgets), view);
    const ranked = candidates.ranked;
    const candidateScores = new Map(ranked.map((candidate) => [candidate.objectId, candidate.score]));
    const { reanchors, routes } = discoverRoutes(view, query, budgets);
    const results = ranked
        .flatMap((candidate) => {
        const object = view.objects.get(candidate.objectId);
        const route = routes.get(candidate.objectId);
        if (object === undefined || route === undefined)
            return [];
        return [
            Object.freeze({
                citedContext: citedContext(object, view.objects, budgets.maxContextCharacters),
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
    const level = diagnostics.length === 0 && view.level === "valid-structured"
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
