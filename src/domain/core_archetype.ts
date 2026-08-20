export interface CoreArchetypeIdentifiers {
  readonly diagnosticStem: string;
  readonly directory: string;
  readonly idPrefix: string;
  readonly pageType: string;
}

/**
 * The Vocabulary Binding of every Core Archetype: one CONTEXT.md glossary term
 * mapped to the identifiers Atlas SDK contracts derive from it. Each identifier
 * is declared rather than computed, so renaming one side alone is a visible
 * disagreement that trusted vocabulary validation reports.
 */
export type CoreArchetypeBindings = Readonly<Record<string, CoreArchetypeIdentifiers>>;

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
}) satisfies CoreArchetypeBindings;

const archetypes: readonly CoreArchetypeIdentifiers[] = Object.values(coreArchetypes);

export const corePageTypesByDirectory: ReadonlyMap<string, string> = new Map(
  archetypes.map((archetype) => [archetype.directory, archetype.pageType]),
);

export const corePageTypes: ReadonlySet<string> = new Set(
  archetypes.map((archetype) => archetype.pageType),
);

export const corePageDirectories: ReadonlySet<string> = new Set(
  archetypes.map((archetype) => archetype.directory),
);

/**
 * Atlas-relative `.atlas/` directory names Atlas SDK reserves without naming a
 * Core Archetype, so vocabulary validation accepts them without a glossary term.
 */
export const reservedPageDirectories: ReadonlySet<string> = new Set(["types"]);

export const rootAnchorPageId = `${coreArchetypes.Anchor.idPrefix}:root`;
