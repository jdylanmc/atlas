import { classifyAtlasTextPath, parseAtlasPages } from "../atlas/parse_atlas_pages.js";
import { serializeAtlasPages } from "../atlas/serialize_atlas_pages.js";
import { loadAndValidateAtlasInput } from "./validate_atlas_input.js";
// The Lint boundary answers every caller with a verdict, so a failure no stage
// described - a defect in Atlas SDK itself, or a limit of the process running
// it - is reported rather than raised. The Finding says the Lint did not
// complete instead of describing knowledge no stage read, and it names the
// Atlas alone, so nothing about the failure leaks through it. Building it once
// means reporting it needs no memory the failure may have exhausted. "reports a
// Lint it could not complete as one whole-Atlas Finding" pins both.
const lintFailedResult = Object.freeze({
    findings: Object.freeze([
        Object.freeze({
            attribution: Object.freeze({
                checkId: "sdk-core.atlas-lint",
                kind: "sdk-core",
                trusted: true,
            }),
            code: "ATLAS_LINT_FAILED",
            "finding-schema": "1.0.0",
            message: "Atlas could not be linted.",
            path: ".atlas",
            severity: "error",
        }),
    ]),
    outcome: "invalid",
});
/**
 * Decides whether a set of Findings denies an Atlas its validity. A Finding is
 * an error, a warning, a suggestion, an inconclusive verdict, or a skipped
 * check, and only an error says the Atlas is invalid; every other Finding
 * reports on an Atlas that still holds together.
 */
export function deniesAtlasValidity(findings) {
    return findings.some((finding) => finding.severity === "error");
}
function decideAtlasLint(capturedFiles, budgets) {
    const { files, findings } = loadAndValidateAtlasInput(capturedFiles, budgets);
    if (deniesAtlasValidity(findings)) {
        return Object.freeze({ findings, outcome: "invalid" });
    }
    // Structural validation parsed exactly this text and denied it nothing, so
    // parsing it again reaches the same pages, and serialization asks only for
    // what the parser's envelope contract already guarantees over paths loading
    // has already proven unique. Anything those stages still refuse is answered
    // at the boundary rather than raised.
    const pages = serializeAtlasPages(parseAtlasPages(files));
    return Object.freeze({
        findings,
        opaque: Object.freeze(files.filter((file) => classifyAtlasTextPath(file.path) === "opaque")),
        outcome: "valid",
        pages,
    });
}
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
export function lintAtlas(capturedFiles, budgets) {
    try {
        return decideAtlasLint(capturedFiles, budgets);
    }
    catch {
        return lintFailedResult;
    }
}
