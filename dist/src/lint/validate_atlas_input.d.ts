import type { Finding } from "../domain/finding.ts";
import { type CapturedAtlasFile, type AtlasTextBudgets, type AtlasTextFile } from "../atlas/load_atlas_text.ts";
import type { ParsedAtlasPage } from "../atlas/parse_atlas_pages.ts";
declare const atlasInputValidationBrand: unique symbol;
export interface AtlasInputValidation {
    readonly [atlasInputValidationBrand]: true;
    /**
     * The loaded Atlas text, empty when loading itself failed and otherwise the
     * text these Findings were decided from, whether or not the Atlas is valid.
     */
    readonly files: readonly AtlasTextFile[];
    readonly findings: readonly Finding[];
    readonly pages: readonly ParsedAtlasPage[];
    readonly validationState: "invalid" | "valid";
}
/**
 * Loads and structurally validates a complete captured Atlas, converting every
 * loading failure, and every parsing failure the parser describes, into a
 * stable, sdk-core attributed Finding so invalid input escapes as neither an
 * uncaught exception nor a success-shaped result. A loading failure
 * short-circuits with one Finding, since the text it would parse cannot be
 * trusted; otherwise the loaded text flows through structural validation, whose
 * deterministic ordering, sanitization, and source evidence contracts are
 * preserved. Identical input bytes yield identical ordered Findings.
 *
 * A failure that describes the running process rather than the Atlas is raised
 * instead, because reporting it as a property of the input would let one Atlas
 * earn different verdicts on different runs. The Lint boundary answers for it.
 *
 * The loaded text is returned alongside its Findings so a caller composing
 * further stages can carry exactly the immutable text that was validated
 * instead of loading the same captured bytes a second time and risking a
 * different answer. Every value the caller owns is read once, so accessors that
 * answer differently on a later read do not make loading disagree with itself:
 * "decides one whole-Atlas Lint from one reading of every input" counts the
 * reads, and "carries the loaded text its Findings were decided from" pins the
 * text that is carried.
 */
export declare function loadAndValidateAtlasInput(capturedFiles: readonly CapturedAtlasFile[], budgets: AtlasTextBudgets): AtlasInputValidation;
export {};
