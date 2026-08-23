import type { Finding } from "../domain/finding.ts";
import type { AtlasTextFile } from "../atlas/load_atlas_text.ts";
import { type ParsedAtlasPage } from "../atlas/parse_atlas_pages.ts";
export interface AtlasStructureValidation {
    /**
     * Every page whose Atlas page envelope parsed from the validated text. Pages
     * that later structural checks reject are still carried so downstream
     * read-only operations consume the same parse Lint examined instead of
     * reparsing the snapshot.
     */
    readonly pages: readonly ParsedAtlasPage[];
    readonly findings: readonly Finding[];
}
declare function validateAtlasStructureWithPages(files: readonly AtlasTextFile[]): AtlasStructureValidation;
/**
 * Parses and validates captured Atlas text, returning deeply immutable Findings
 * ordered by path, source position, code, then message using Unicode code points.
 * Opaque Framework, Changelog, and non-page Markdown records produce no Findings.
 */
export declare function validateAtlasStructure(files: readonly AtlasTextFile[]): readonly Finding[];
export { validateAtlasStructureWithPages };
