import type { Finding } from "../domain/finding.ts";
import {
  loadRealmText,
  RealmLoadError,
  type CapturedRealmFile,
  type RealmLoadErrorCode,
  type RealmTextBudgets,
  type RealmTextFile,
} from "../realm/load_realm_text.ts";
import { validateRealmStructure } from "./validate_realm_structure.ts";

const attribution = Object.freeze({
  checkId: "atlas-core.realm-input",
  kind: "atlas-core" as const,
  trusted: true as const,
});

const loadCodes: Readonly<Record<RealmLoadErrorCode, string>> = Object.freeze({
  DUPLICATE_PATH: "ATLAS_REALM_LOAD_DUPLICATE_PATH",
  FILE_TOO_LARGE: "ATLAS_REALM_LOAD_FILE_TOO_LARGE",
  INVALID_BUDGET: "ATLAS_REALM_LOAD_INVALID_BUDGET",
  INVALID_PATH: "ATLAS_REALM_LOAD_INVALID_PATH",
  INVALID_UTF8: "ATLAS_REALM_LOAD_INVALID_UTF8",
  SHARED_BYTES_NOT_ALLOWED: "ATLAS_REALM_LOAD_SHARED_BYTES",
  TOTAL_TOO_LARGE: "ATLAS_REALM_LOAD_TOTAL_TOO_LARGE",
});

// A loading failure concerns the captured Realm tree as a whole rather than one
// resolved page, and RealmLoadError deliberately withholds the offending raw
// path so an unsafe caller path can never leak into a sanitized Finding.
const realmSubjectPath = ".atlas";

function loadFinding(code: string, message: string): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path: realmSubjectPath,
    severity: "error",
  });
}

function loadOrFinding(
  capturedFiles: readonly CapturedRealmFile[],
  budgets: RealmTextBudgets,
): readonly RealmTextFile[] | Finding {
  try {
    return loadRealmText(capturedFiles, budgets);
  } catch (error: unknown) {
    if (error instanceof RealmLoadError) {
      return loadFinding(loadCodes[error.code], error.message);
    }
    /* c8 ignore next 5 -- loadRealmText surfaces failures only as RealmLoadError */
    return loadFinding(
      "ATLAS_REALM_LOAD_FAILED",
      "Captured Realm files could not be loaded.",
    );
  }
}

/**
 * Loads and structurally validates a complete captured Realm, converting every
 * loading or parsing failure into a stable, atlas-core attributed Finding so
 * invalid input escapes as neither an uncaught exception nor a success-shaped
 * result. A loading failure short-circuits with one Finding, since the text it
 * would parse cannot be trusted; otherwise the loaded text flows through
 * structural validation, whose deterministic ordering, sanitization, and source
 * evidence contracts are preserved. Identical input bytes yield identical
 * ordered Findings.
 */
export function validateRealmInput(
  capturedFiles: readonly CapturedRealmFile[],
  budgets: RealmTextBudgets,
): readonly Finding[] {
  const loaded = loadOrFinding(capturedFiles, budgets);
  if ("code" in loaded) {
    return Object.freeze([loaded]);
  }
  return validateRealmStructure(loaded);
}
