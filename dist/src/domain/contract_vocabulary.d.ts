export interface ContractVocabularyBinding {
    readonly exportedIdentifiers: readonly string[];
    readonly term: string;
}
/**
 * SDK-owned contract result terms that are not Core Archetypes. Each term is
 * bound to the exported TypeScript identifiers that carry the public contract,
 * so a code rename without a glossary rename is reported.
 */
export declare const contractVocabularyBindings: readonly [Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Atlas Lint Result";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Atlas View";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Valid Atlas Lint Result";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Invalid Atlas Lint Result";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Operation Result";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Operation Handoff";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Search Provider";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Atlas Snapshot";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Framework Bundle";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Framework Release";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Framework Release Manifest";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Atlas Initialization";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Operation Workflow";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Atlas Change Set";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Lint Stamp";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Atlas Readiness Report";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Ingest";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Ingest Scope";
}>, Readonly<{
    exportedIdentifiers: readonly string[];
    term: "Candidate Graph";
}>];
