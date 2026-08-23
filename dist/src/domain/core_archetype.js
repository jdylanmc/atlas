export const coreArchetypes = Object.freeze({
    Anchor: Object.freeze({
        diagnosticStem: "ANCHOR",
        directory: "anchors",
        idPrefix: "anchor",
        pageType: "anchor",
    }),
    Concept: Object.freeze({
        diagnosticStem: "CONCEPT",
        directory: "concepts",
        idPrefix: "concept",
        pageType: "concept",
    }),
    Source: Object.freeze({
        diagnosticStem: "SOURCE",
        directory: "sources",
        idPrefix: "source",
        pageType: "source",
    }),
    Principle: Object.freeze({
        diagnosticStem: "PRINCIPLE",
        directory: "principles",
        idPrefix: "principle",
        pageType: "principle",
    }),
    Edge: Object.freeze({
        diagnosticStem: "EDGE",
        directory: "edges",
        idPrefix: "edge",
        pageType: "edge",
    }),
});
const archetypes = Object.values(coreArchetypes);
export const corePageTypesByDirectory = new Map(archetypes.map((archetype) => [archetype.directory, archetype.pageType]));
export const corePageTypes = new Set(archetypes.map((archetype) => archetype.pageType));
export const corePageDirectories = new Set(archetypes.map((archetype) => archetype.directory));
/**
 * Atlas-relative `.atlas/` directory names Atlas SDK reserves without naming a
 * Core Archetype, so vocabulary validation accepts them without a glossary term.
 */
export const reservedPageDirectories = new Set(["types"]);
export const rootAnchorPageId = `${coreArchetypes.Anchor.idPrefix}:root`;
