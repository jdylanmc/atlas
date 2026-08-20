import type { Finding } from "../domain/finding.ts";
import type {
  AtlasTextBudgets,
  AtlasTextFile,
  CapturedAtlasFile,
} from "../atlas/load_atlas_text.ts";
import { parseAtlasPages } from "../atlas/parse_atlas_pages.ts";
import { serializeAtlasPages } from "../atlas/serialize_atlas_pages.ts";
import { loadAndValidateAtlasInput } from "./validate_atlas_input.ts";

export interface ValidAtlasLint {
  readonly outcome: "valid";
  readonly pages: readonly AtlasTextFile[];
}

export interface InvalidAtlasLint {
  readonly findings: readonly Finding[];
  readonly outcome: "invalid";
}

/**
 * One Lint result over one whole Atlas. The two outcomes carry disjoint
 * evidence, so an invalid Atlas cannot present canonical pages and a valid one
 * cannot present Findings: a caller reading `pages` has already proven the
 * Atlas valid.
 */
export type AtlasLintResult = ValidAtlasLint | InvalidAtlasLint;

/**
 * Lints one complete captured Atlas: immutable loading, canonical page parsing,
 * and trusted structural validation decide the outcome, and a valid Atlas is
 * normalized and reserialized to its canonical bytes.
 *
 * An Atlas that produces any Finding returns those Findings alone. No page is
 * serialized in that case, so a partially normalized or success-shaped result
 * can never be mistaken for a completed Lint.
 *
 * The captured bytes are loaded exactly once and every later stage reads that
 * one immutable text, so serialization can only ever normalize the same content
 * structural validation accepted, and nothing a caller does to its own bytes
 * afterwards can change what was judged. All stages are pure functions of that
 * text, so identical input yields identical ordered Findings and identical
 * canonical pages.
 */
export function lintAtlas(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): AtlasLintResult {
  const { files, findings } = loadAndValidateAtlasInput(capturedFiles, budgets);
  if (findings.length > 0) {
    return Object.freeze({ findings, outcome: "invalid" as const });
  }

  // Structural validation parsed exactly this text and reported nothing, so
  // parsing it again cannot fail, and serialization asks only for what the
  // parser's envelope contract already guarantees over paths loading has
  // already proven unique.
  const pages = serializeAtlasPages(parseAtlasPages(files));
  return Object.freeze({ outcome: "valid" as const, pages });
}
