import { type CoreArchetypeBindings } from "../domain/core_archetype.ts";
import type { ContractVocabularyBinding } from "../domain/contract_vocabulary.ts";
import type { Finding } from "../domain/finding.ts";
export interface VocabularyTextFile {
    readonly content: string;
    readonly path: string;
}
interface GlossaryEntry {
    readonly line: number;
    readonly name: string;
}
interface Glossary {
    readonly avoided: ReadonlyMap<string, GlossaryEntry>;
    readonly malformed: readonly number[];
    readonly terms: ReadonlyMap<string, number>;
}
/**
 * Reads CONTEXT.md as the authoritative glossary: every defined term, and every
 * unconditionally avoided term in singular and plural form. An avoidance entry
 * that begins in lower case opens a human qualifier, which scopes the one entry
 * before it to a condition validation cannot judge, so that entry stays
 * advisory. A qualifier that scopes no entry, or that hides an entry behind it,
 * leaves an avoidance no reader can rely on, and its line is reported malformed.
 * An empty entry, which a stray comma leaves behind, is neither a term nor a
 * qualifier: the line binds what it would bind without the comma, and is
 * reported.
 */
export declare function parseGlossary(content: string): Glossary;
/**
 * Validates that the CONTEXT.md glossary and the vocabulary bound into Atlas
 * SDK-owned contracts agree in both directions. Disagreement is reported as a
 * deeply immutable, trusted Finding naming the glossary term and the contract
 * identifier that disagree.
 *
 * The check reads identifiers rather than prose. A diagnostic code and an
 * `.atlas/` directory reference are identifiers wherever a contract writes them;
 * a page-ID prefix, a page type, and a Finding message are read only inside a
 * single-line literal. Ordinary English writes none of those shapes, so a
 * sentence that uses a domain word raises nothing. Identical input produces
 * identical ordered Findings.
 */
export declare function validateVocabularyAgreement(bindings: CoreArchetypeBindings, contractTerms: readonly ContractVocabularyBinding[], glossary: VocabularyTextFile, contracts: readonly VocabularyTextFile[]): readonly Finding[];
export {};
