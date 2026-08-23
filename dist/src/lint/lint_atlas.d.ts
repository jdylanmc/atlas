import type { Finding } from "../domain/finding.ts";
import type { AtlasTextBudgets, AtlasTextFile, CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
export interface ValidAtlasLintResult {
    /**
     * Findings that report on the Atlas without denying its validity: warnings,
     * suggestions, inconclusive verdicts, and skipped checks.
     */
    readonly findings: readonly Finding[];
    /**
     * The records Lint reads as text rather than as pages - the Changelog, the
     * Framework Bundle, and any other non-page Markdown - carried exactly as they
     * were loaded. They have no page envelope to normalize, so normalizing them
     * would rewrite bytes Lint has no contract over.
     */
    readonly opaque: readonly AtlasTextFile[];
    readonly outcome: "valid";
    /** Every Atlas page, normalized and reserialized to its canonical bytes. */
    readonly pages: readonly AtlasTextFile[];
}
export interface InvalidAtlasLintResult {
    readonly findings: readonly Finding[];
    readonly outcome: "invalid";
}
/**
 * One Lint result over one whole Atlas. Only a valid Atlas carries text, so an
 * invalid Atlas can present neither canonical pages nor the records beside
 * them: a caller reading `pages` has already proven the Atlas valid.
 */
export type AtlasLintResult = ValidAtlasLintResult | InvalidAtlasLintResult;
/**
 * Decides whether a set of Findings denies an Atlas its validity. A Finding is
 * an error, a warning, a suggestion, an inconclusive verdict, or a skipped
 * check, and only an error says the Atlas is invalid; every other Finding
 * reports on an Atlas that still holds together.
 */
export declare function deniesAtlasValidity(findings: readonly Finding[]): boolean;
/**
 * Lints one complete captured Atlas: immutable loading, canonical page parsing,
 * and trusted structural validation decide the outcome, and a valid Atlas is
 * normalized and reserialized, its pages to their canonical bytes and its
 * opaque records unchanged.
 *
 * An Atlas any check finds an error in returns those Findings alone. No page is
 * serialized in that case, so a partially normalized or success-shaped result
 * is not representable as a completed Lint - "returns stable Findings without
 * partial or success-shaped output" pins that. Lint is a boundary over
 * untrusted content, so it answers every caller with a verdict: content it
 * cannot read becomes a Finding rather than an exception its caller must
 * survive, pinned by "answers every nesting depth with a verdict rather than an
 * exception".
 *
 * The captured bytes are loaded exactly once and every later stage reads that
 * one immutable text, so serialization normalizes the content structural
 * validation accepted, and what a caller does to its own bytes afterwards does
 * not change what was judged: "decides one whole-Atlas Lint from one reading of
 * every input" pins the reads. Every stage decides from the text alone, and
 * declared bounds keep nesting short of the limits of the process, so identical
 * input yields identical ordered Findings and identical canonical pages on every
 * run, pinned by "produces identical ordered Findings and canonical pages across
 * runs" and "costs no more than the bytes it is given as those bytes double".
 */
export declare function lintAtlas(capturedFiles: readonly CapturedAtlasFile[], budgets: AtlasTextBudgets): AtlasLintResult;
