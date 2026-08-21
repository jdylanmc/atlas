export interface ContractVocabularyBinding {
  readonly exportedIdentifiers: readonly string[];
  readonly term: string;
}

/**
 * SDK-owned contract result terms that are not Core Archetypes. Each term is
 * bound to the exported TypeScript identifiers that carry the public contract,
 * so a code rename without a glossary rename is reported.
 */
export const contractVocabularyBindings = Object.freeze([
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasLintResult"]),
    term: "Atlas Lint Result",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["ValidAtlasLintResult"]),
    term: "Valid Atlas Lint Result",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["InvalidAtlasLintResult"]),
    term: "Invalid Atlas Lint Result",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["OperationResult"]),
    term: "Operation Result",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["OperationHandoff"]),
    term: "Operation Handoff",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["SearchProvider"]),
    term: "Search Provider",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasSnapshot"]),
    term: "Atlas Snapshot",
  }),
] as const) satisfies readonly ContractVocabularyBinding[];
