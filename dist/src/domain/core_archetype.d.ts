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
export declare const coreArchetypes: Readonly<{
    Anchor: Readonly<{
        diagnosticStem: "ANCHOR";
        directory: "anchors";
        idPrefix: "anchor";
        pageType: "anchor";
    }>;
    Concept: Readonly<{
        diagnosticStem: "CONCEPT";
        directory: "concepts";
        idPrefix: "concept";
        pageType: "concept";
    }>;
    Source: Readonly<{
        diagnosticStem: "SOURCE";
        directory: "sources";
        idPrefix: "source";
        pageType: "source";
    }>;
    Principle: Readonly<{
        diagnosticStem: "PRINCIPLE";
        directory: "principles";
        idPrefix: "principle";
        pageType: "principle";
    }>;
    Edge: Readonly<{
        diagnosticStem: "EDGE";
        directory: "edges";
        idPrefix: "edge";
        pageType: "edge";
    }>;
}>;
export declare const corePageTypesByDirectory: ReadonlyMap<string, string>;
export declare const corePageTypes: ReadonlySet<string>;
export declare const corePageDirectories: ReadonlySet<string>;
/**
 * Atlas-relative `.atlas/` directory names Atlas SDK reserves without naming a
 * Core Archetype, so vocabulary validation accepts them without a glossary term.
 */
export declare const reservedPageDirectories: ReadonlySet<string>;
export declare const rootAnchorPageId: string;
