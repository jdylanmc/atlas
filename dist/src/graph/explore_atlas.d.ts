import type { AtlasTextBudgets } from "../atlas/load_atlas_text.ts";
import type { AtlasView } from "../atlas/atlas_view.ts";
import type { Finding } from "../domain/finding.ts";
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
    readonly rank: (documents: readonly ExploreSearchDocument[], query: string, budgets: Pick<ExploreBudgets, "maxQueryCharacters" | "maxTerms">) => readonly ExploreCandidate[];
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
    readonly result: ExploreSourceContext & {
        readonly type: string;
    };
    readonly route: readonly ExploreRouteStep[];
}
export type ExploreDegradationLevel = "blocked" | "partial-structure" | "raw-markdown" | "valid-structured";
export interface ExplorePayload {
    readonly degradation: {
        readonly diagnostics: readonly Finding[];
        readonly level: ExploreDegradationLevel;
        readonly remediation: string | undefined;
    };
    readonly reanchors: readonly ExploreReanchor[];
    readonly results: readonly ExploreResultItem[];
}
export declare function exploreAtlas(atlasView: AtlasView, query: string, provider: SearchProvider, budgets: ExploreBudgets): ExplorePayload;
