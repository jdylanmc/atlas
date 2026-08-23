import { compareCodePoints } from "../atlas/compare_code_points.js";
function isAsciiAlphanumeric(code) {
    return ((code >= 0x30 && code <= 0x39) ||
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x41 && code <= 0x5a));
}
export function exploreLexicalTokens(text, maxTerms) {
    if (maxTerms === 0)
        return Object.freeze([]);
    const tokens = [];
    let current = "";
    for (const character of text) {
        const code = character.codePointAt(0);
        if (isAsciiAlphanumeric(code)) {
            current += character.toLowerCase();
            continue;
        }
        if (current !== "") {
            tokens.push(current);
            if (tokens.length >= maxTerms)
                return Object.freeze(tokens);
            current = "";
        }
    }
    if (current !== "" && tokens.length < maxTerms)
        tokens.push(current);
    return Object.freeze(tokens);
}
function frequency(tokens) {
    const counts = new Map();
    for (const token of tokens)
        counts.set(token, (counts.get(token) ?? 0) + 1);
    return counts;
}
function score(document, queryTerms, budgets) {
    const counts = frequency(exploreLexicalTokens([
        document.id,
        document.title,
        document.type,
        ...document.tags,
        document.body,
    ].join(" "), budgets.maxTerms));
    let total = 0;
    for (const term of queryTerms)
        total += counts.get(term) ?? 0;
    return total;
}
export const lexicalSearchProvider = Object.freeze({
    rank(documents, query, budgets) {
        const queryTerms = [...new Set(exploreLexicalTokens(query, budgets.maxTerms))].sort(compareCodePoints);
        const candidates = documents.map((document) => Object.freeze({
            objectId: document.id,
            score: score(document, queryTerms, budgets),
        }));
        return Object.freeze(candidates
            .filter((candidate) => candidate.score > 0)
            .toSorted((left, right) => {
            const scoreDifference = right.score - left.score;
            return scoreDifference === 0
                ? compareCodePoints(left.objectId, right.objectId)
                : scoreDifference;
        }));
    },
});
