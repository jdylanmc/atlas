import type { Finding } from "../domain/finding.ts";
import {
  loadAtlasText,
  AtlasLoadError,
  type CapturedAtlasFile,
  type AtlasLoadErrorCode,
  type AtlasTextFile,
} from "../atlas/load_atlas_text.ts";
import { rethrowProcessLimit } from "../atlas/process_limit.ts";
import type { ParsedAtlasPage } from "../atlas/parse_atlas_pages.ts";
import { validateAtlasStructureWithPages } from "./validate_atlas_structure.ts";

interface LoadedInput {
  readonly files: readonly AtlasTextFile[];
}

const attribution = Object.freeze({
  checkId: "sdk-core.atlas-input",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const loadCodes: Readonly<Record<AtlasLoadErrorCode, string>> = Object.freeze({
  DUPLICATE_PATH: "ATLAS_LOAD_DUPLICATE_PATH",
  INVALID_PATH: "ATLAS_LOAD_INVALID_PATH",
  INVALID_UTF8: "ATLAS_LOAD_INVALID_UTF8",
  NON_CANONICAL_LINE_TERMINATOR: "ATLAS_LOAD_NON_CANONICAL_LINE_TERMINATOR",
  SHARED_BYTES_NOT_ALLOWED: "ATLAS_LOAD_SHARED_BYTES",
});

// A loading failure concerns the captured Atlas tree as a whole rather than one
// resolved page, and AtlasLoadError deliberately withholds the offending raw
// path so an unsafe caller path does not leak into a sanitized Finding.
// "sanitizes loading failures without leaking the offending raw path" pins it.
// A non-canonical line terminator is the exception: it is found only after
// every path has been normalized, so each offending file is named and located.
const atlasSubjectPath = ".atlas";

function loadFinding(
  code: string,
  message: string,
  path = atlasSubjectPath,
  location?: Finding["location"],
): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    ...(location === undefined ? {} : { location }),
    message,
    path,
    severity: "error",
  });
}

function loadErrorFindings(error: AtlasLoadError): readonly Finding[] {
  if (error.lineTerminators.length === 0) {
    return Object.freeze([loadFinding(loadCodes[error.code], error.message)]);
  }
  return Object.freeze(
    error.lineTerminators.map(({ column, line, path }) =>
      loadFinding(
        loadCodes.NON_CANONICAL_LINE_TERMINATOR,
        "Atlas file contains a non-canonical line terminator: a carriage return without a following line feed, or a Unicode line or paragraph separator. Use LF or CRLF line endings.",
        path,
        Object.freeze({
          end: Object.freeze({ column: column + 1, line }),
          start: Object.freeze({ column, line }),
        }),
      ),
    ),
  );
}

// Loading consults a captured file's `bytes` more than once, so every
// caller-owned value is read once here and answered from a frozen snapshot from
// then on. The bytes themselves stay the caller's own objects, since only
// loading may decide whether they use shared memory and copying them first
// would answer that question for it.
function captureOnce(
  capturedFiles: readonly CapturedAtlasFile[],
): readonly CapturedAtlasFile[] {
  return Array.from(capturedFiles, (file) =>
    Object.freeze({ bytes: file.bytes, path: file.path }),
  );
}

function loadOrFindings(
  capturedFiles: readonly CapturedAtlasFile[],
): LoadedInput | readonly Finding[] {
  let captured;
  try {
    captured = captureOnce(capturedFiles);
  } catch (error: unknown) {
    rethrowProcessLimit(error);
    // The program running the Lint failed to hand over what it captured. That
    // is a defect in that program rather than a judgement about the Atlas, and
    // this code says so, but it still becomes a Finding: the Lint boundary
    // answers every caller with a verdict rather than an exception.
    return Object.freeze([
      loadFinding(
        "ATLAS_CAPTURE_UNREADABLE",
        "Captured Atlas files could not be read from the program running the Lint.",
      ),
    ]);
  }

  try {
    return Object.freeze({ files: loadAtlasText(captured) });
  } catch (error: unknown) {
    if (error instanceof AtlasLoadError) return loadErrorFindings(error);
    rethrowProcessLimit(error);
    // Loading refused the captured files without describing why, which likewise
    // says nothing about Atlas knowledge and everything about what it was given.
    return Object.freeze([
      loadFinding("ATLAS_LOAD_FAILED", "Captured Atlas files could not be loaded."),
    ]);
  }
}

const atlasInputValidationBrand: unique symbol = Symbol("atlas-input-validation");

export interface AtlasInputValidation {
  readonly [atlasInputValidationBrand]: true;
  /**
   * The loaded Atlas text, empty when loading itself failed and otherwise the
   * text these Findings were decided from, whether or not the Atlas is valid.
   */
  readonly files: readonly AtlasTextFile[];
  readonly findings: readonly Finding[];
  /** Whether loading succeeded, so later stages may read `files`. */
  readonly loaded: boolean;
  readonly pages: readonly ParsedAtlasPage[];
  readonly validationState: "invalid" | "valid";
}

const noFiles: readonly AtlasTextFile[] = Object.freeze([]);
const noPages: readonly ParsedAtlasPage[] = Object.freeze([]);

function validationState(findings: readonly Finding[]): "invalid" | "valid" {
  return findings.some((finding) => finding.severity === "error") ? "invalid" : "valid";
}

/**
 * Loads and structurally validates a complete captured Atlas, converting every
 * loading failure, and every parsing failure the parser describes, into a
 * stable, sdk-core attributed Finding so invalid input escapes as neither an
 * uncaught exception nor a success-shaped result. A loading failure
 * short-circuits, since the text it would parse is not trustworthy; otherwise
 * the loaded text flows through structural validation. Deterministic ordering,
 * sanitization, and source evidence contracts are preserved. Identical input
 * bytes yield identical ordered Findings.
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
export function loadAndValidateAtlasInput(
  capturedFiles: readonly CapturedAtlasFile[],
): AtlasInputValidation {
  const loaded = loadOrFindings(capturedFiles);
  if (!("files" in loaded)) {
    return Object.freeze({
      [atlasInputValidationBrand]: true as const,
      files: noFiles,
      findings: loaded,
      loaded: false,
      pages: noPages,
      validationState: "invalid" as const,
    });
  }
  const structure = validateAtlasStructureWithPages(loaded.files);
  return Object.freeze({
    [atlasInputValidationBrand]: true as const,
    files: loaded.files,
    findings: structure.findings,
    loaded: true,
    pages: structure.pages,
    validationState: validationState(structure.findings),
  });
}
