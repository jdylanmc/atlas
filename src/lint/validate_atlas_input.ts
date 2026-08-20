import type { Finding } from "../domain/finding.ts";
import {
  loadAtlasText,
  AtlasLoadError,
  type CapturedAtlasFile,
  type AtlasLoadErrorCode,
  type AtlasTextBudgets,
  type AtlasTextFile,
} from "../atlas/load_atlas_text.ts";
import { validateAtlasStructure } from "./validate_atlas_structure.ts";

const attribution = Object.freeze({
  checkId: "sdk-core.atlas-input",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const loadCodes: Readonly<Record<AtlasLoadErrorCode, string>> = Object.freeze({
  DUPLICATE_PATH: "ATLAS_LOAD_DUPLICATE_PATH",
  FILE_TOO_LARGE: "ATLAS_LOAD_FILE_TOO_LARGE",
  INVALID_BUDGET: "ATLAS_LOAD_INVALID_BUDGET",
  INVALID_PATH: "ATLAS_LOAD_INVALID_PATH",
  INVALID_UTF8: "ATLAS_LOAD_INVALID_UTF8",
  SHARED_BYTES_NOT_ALLOWED: "ATLAS_LOAD_SHARED_BYTES",
  TOTAL_TOO_LARGE: "ATLAS_LOAD_TOTAL_TOO_LARGE",
});

// A loading failure concerns the captured Atlas tree as a whole rather than one
// resolved page, and AtlasLoadError deliberately withholds the offending raw
// path so an unsafe caller path can never leak into a sanitized Finding.
const atlasSubjectPath = ".atlas";

function loadFinding(code: string, message: string): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path: atlasSubjectPath,
    severity: "error",
  });
}

function loadOrFinding(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): readonly AtlasTextFile[] | Finding {
  try {
    // Loading consults a captured file's `bytes` and each budget more than
    // once, so every caller-owned value is read once here and answered from a
    // frozen snapshot from then on. The bytes themselves stay the caller's own
    // objects, since only loading may decide whether they use shared memory and
    // copying them first would answer that question for it.
    const captured = Array.from(capturedFiles, (file) =>
      Object.freeze({ bytes: file.bytes, path: file.path }),
    );
    return loadAtlasText(
      captured,
      Object.freeze({
        maxFileBytes: budgets.maxFileBytes,
        maxTotalBytes: budgets.maxTotalBytes,
      }),
    );
  } catch (error: unknown) {
    if (error instanceof AtlasLoadError) {
      return loadFinding(loadCodes[error.code], error.message);
    }
    // Reading a captured file may fail outright, so a failure loading refuses
    // to describe still becomes a Finding rather than an escaping exception.
    return loadFinding(
      "ATLAS_LOAD_FAILED",
      "Captured Atlas files could not be loaded.",
    );
  }
}

export interface AtlasInputValidation {
  /**
   * The loaded Atlas text, empty when loading itself failed and otherwise the
   * text these Findings were decided from, whether or not the Atlas is valid.
   */
  readonly files: readonly AtlasTextFile[];
  readonly findings: readonly Finding[];
}

const noFiles: readonly AtlasTextFile[] = Object.freeze([]);

/**
 * Loads and structurally validates a complete captured Atlas, converting every
 * loading or parsing failure into a stable, sdk-core attributed Finding so
 * invalid input escapes as neither an uncaught exception nor a success-shaped
 * result. A loading failure short-circuits with one Finding, since the text it
 * would parse cannot be trusted; otherwise the loaded text flows through
 * structural validation, whose deterministic ordering, sanitization, and source
 * evidence contracts are preserved. Identical input bytes yield identical
 * ordered Findings.
 *
 * The loaded text is returned alongside its Findings so a caller composing
 * further stages can carry exactly the immutable text that was validated
 * instead of loading the same captured bytes a second time and risking a
 * different answer. Every value the caller owns is read once, so accessors that
 * answer differently on a later read can neither make loading disagree with
 * itself nor escape as an uncaught exception.
 */
export function loadAndValidateAtlasInput(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): AtlasInputValidation {
  const loaded = loadOrFinding(capturedFiles, budgets);
  if ("code" in loaded) {
    return Object.freeze({ files: noFiles, findings: Object.freeze([loaded]) });
  }
  return Object.freeze({
    files: loaded,
    findings: validateAtlasStructure(loaded),
  });
}

/**
 * Reports the Findings of {@link loadAndValidateAtlasInput} for callers that
 * judge a captured Atlas without carrying its loaded text onward.
 */
export function validateAtlasInput(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): readonly Finding[] {
  return loadAndValidateAtlasInput(capturedFiles, budgets).findings;
}
