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
    return loadAtlasText(capturedFiles, budgets);
  } catch (error: unknown) {
    if (error instanceof AtlasLoadError) {
      return loadFinding(loadCodes[error.code], error.message);
    }
    /* c8 ignore next 5 -- loadAtlasText surfaces failures only as AtlasLoadError */
    return loadFinding(
      "ATLAS_LOAD_FAILED",
      "Captured Atlas files could not be loaded.",
    );
  }
}

/**
 * Loads and structurally validates a complete captured Atlas, converting every
 * loading or parsing failure into a stable, sdk-core attributed Finding so
 * invalid input escapes as neither an uncaught exception nor a success-shaped
 * result. A loading failure short-circuits with one Finding, since the text it
 * would parse cannot be trusted; otherwise the loaded text flows through
 * structural validation, whose deterministic ordering, sanitization, and source
 * evidence contracts are preserved. Identical input bytes yield identical
 * ordered Findings.
 */
export function validateAtlasInput(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): readonly Finding[] {
  const loaded = loadOrFinding(capturedFiles, budgets);
  if ("code" in loaded) {
    return Object.freeze([loaded]);
  }
  return validateAtlasStructure(loaded);
}
