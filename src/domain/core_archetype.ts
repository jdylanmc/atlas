export interface CoreArchetypeIdentifiers {
  readonly diagnosticStem: string;
  readonly directory: string;
  readonly idPrefix: string;
  readonly pageType: string;
}

/**
 * The Vocabulary Binding of every Core Archetype: one CONTEXT.md glossary term
 * mapped to the identifiers Atlas SDK contracts spell it with. A term fixes
 * those spellings, so this table records them in one place and trusted
 * vocabulary validation verifies that the glossary and the table still agree.
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
  TrackedAtlas: Object.freeze({
    diagnosticStem: "TRACKED_ATLAS",
    directory: "tracked-atlases",
    idPrefix: "tracked-atlas",
    pageType: "tracked-atlas",
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
export const reservedPageDirectories: ReadonlySet<string> = new Set([
  "atlas-cache",
  // Retiring the Framework Bundle removed the glossary terms that named this
  // directory, but the directory itself still exists and is still SDK-reserved.
  // Issue #162 removes it and this entry with it.
  "framework",
  "types",
]);

export const rootAnchorPageId = `${coreArchetypes.Anchor.idPrefix}:root`;
