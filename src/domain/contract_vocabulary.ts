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
  Object.freeze({
    exportedIdentifiers: Object.freeze(["FrameworkBundle"]),
    term: "Framework Bundle",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["FrameworkRelease"]),
    term: "Framework Release",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["FrameworkReleaseManifest"]),
    term: "Framework Release Manifest",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasInitializationResult"]),
    term: "Atlas Initialization",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasInitializationWorkflowState"]),
    term: "Operation Workflow",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasInitializationChangeSet"]),
    term: "Atlas Change Set",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["LintStamp"]),
    term: "Lint Stamp",
  }),
  Object.freeze({
    exportedIdentifiers: Object.freeze(["AtlasReadinessReport"]),
    term: "Atlas Readiness Report",
  }),
] as const) satisfies readonly ContractVocabularyBinding[];
