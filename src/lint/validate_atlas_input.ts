import type { Finding } from "../domain/finding.ts";
import {
  loadAtlasText,
  AtlasLoadError,
  type CapturedAtlasFile,
  type AtlasLoadErrorCode,
  type AtlasTextBudgets,
  type AtlasTextFile,
} from "../atlas/load_atlas_text.ts";
import { rethrowProcessLimit } from "../atlas/process_limit.ts";
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

// Loading consults a captured file's `bytes` and each budget more than once, so
// every caller-owned value is read once here and answered from a frozen
// snapshot from then on. The bytes themselves stay the caller's own objects,
// since only loading may decide whether they use shared memory and copying them
// first would answer that question for it.
function captureOnce(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): {
  readonly budgets: AtlasTextBudgets;
  readonly files: readonly CapturedAtlasFile[];
} {
  return {
    budgets: Object.freeze({
      maxFileBytes: budgets.maxFileBytes,
      maxTotalBytes: budgets.maxTotalBytes,
    }),
    files: Array.from(capturedFiles, (file) =>
      Object.freeze({ bytes: file.bytes, path: file.path }),
    ),
  };
}

function loadOrFinding(
  capturedFiles: readonly CapturedAtlasFile[],
  budgets: AtlasTextBudgets,
): readonly AtlasTextFile[] | Finding {
  let captured;
  try {
    captured = captureOnce(capturedFiles, budgets);
  } catch (error: unknown) {
    rethrowProcessLimit(error);
    // The program running the Lint failed to hand over what it captured. That
    // is a defect in that program rather than a judgement about the Atlas, and
    // this code says so, but it still becomes a Finding: the Lint boundary
    // answers every caller with a verdict rather than an exception.
    return loadFinding(
      "ATLAS_CAPTURE_UNREADABLE",
      "Captured Atlas files could not be read from the program running the Lint.",
    );
  }

  try {
    return loadAtlasText(captured.files, captured.budgets);
  } catch (error: unknown) {
    if (error instanceof AtlasLoadError) {
      return loadFinding(loadCodes[error.code], error.message);
    }
    rethrowProcessLimit(error);
    // Loading refused the captured files without describing why, which likewise
    // says nothing about Atlas knowledge and everything about what it was given.
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
 * answer differently on a later read cannot make loading disagree with itself.
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
