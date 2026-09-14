import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type {
  ExploreBudgets,
  ExploreCandidate,
  ExploreSearchDocument,
  SearchProvider,
} from "./explore_atlas.ts";

function isAsciiAlphanumeric(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x41 && code <= 0x5a)
  );
}

export function exploreLexicalTokens(
  text: string,
  maxTerms: number,
): readonly string[] {
  if (maxTerms === 0) return Object.freeze([]);
  const tokens: string[] = [];
  let current = "";
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if (isAsciiAlphanumeric(code)) {
      current += character.toLowerCase();
      continue;
    }
    if (current !== "") {
      tokens.push(current);
      if (tokens.length >= maxTerms) return Object.freeze(tokens);
      current = "";
    }
  }
  if (current !== "" && tokens.length < maxTerms) tokens.push(current);
  return Object.freeze(tokens);
}

function frequency(tokens: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

const queryFunctionWords: ReadonlySet<string> = new Set(
  (
    "a an and are as at be been being by can could did do does for from had has " +
    "have how i if in is it its may of on or our should that the their there " +
    "these this to was we were what when where which who why will with would you your"
  ).split(" "),
);

function documentTermCounts(
  document: ExploreSearchDocument,
  budgets: Pick<ExploreBudgets, "maxTerms">,
): ReadonlyMap<string, number> {
  return frequency(
    exploreLexicalTokens(
      [
        document.id,
        document.title,
        document.type,
        ...document.tags,
        document.body,
      ].join(" "),
      budgets.maxTerms,
    ),
  );
}

function score(
  counts: ReadonlyMap<string, number>,
  queryWeights: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const [term, weight] of queryWeights) {
    const count = counts.get(term) ?? 0;
    total += (count / (count + 1)) * weight;
  }
  return total;
}

export const lexicalSearchProvider = Object.freeze({
  rank(
    documents: readonly ExploreSearchDocument[],
    query: string,
    budgets: Pick<ExploreBudgets, "maxQueryCharacters" | "maxTerms">,
  ): readonly ExploreCandidate[] {
    const queryTerms = [...new Set(exploreLexicalTokens(query, budgets.maxTerms))].sort(
      compareCodePoints,
    );
    const contentTerms = queryTerms.filter((term) => !queryFunctionWords.has(term));
    const effectiveTerms = contentTerms.length === 0 ? queryTerms : contentTerms;
    const indexed = documents.map((document) => ({
      document,
      counts: documentTermCounts(document, budgets),
    }));
    const queryWeights = new Map<string, number>();
    for (const term of effectiveTerms) {
      const matches = indexed.filter(({ counts }) => counts.has(term)).length;
      if (matches > 0) {
        queryWeights.set(term, Math.log1p(indexed.length / matches));
      }
    }
    const candidates = indexed.map(({ document, counts }) =>
      Object.freeze({
        objectId: document.id,
        score: score(counts, queryWeights),
      }),
    );
    return Object.freeze(
      candidates
        .filter((candidate) => candidate.score > 0)
        .toSorted((left, right) => {
          const scoreDifference = right.score - left.score;
          return scoreDifference === 0
            ? compareCodePoints(left.objectId, right.objectId)
            : scoreDifference;
        }),
    );
  },
}) satisfies SearchProvider;
