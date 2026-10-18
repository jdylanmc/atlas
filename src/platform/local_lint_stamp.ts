import {
  AtlasLoadError,
  loadAtlasTextWithByteLengths,
  defaultAtlasTextBudgets,
} from "../atlas/load_atlas_text.ts";
import type { Finding } from "../domain/finding.ts";
import { captureLocalAtlasSnapshot } from "./local_atlas_snapshot.ts";

export type LintStampVerification =
  | {
      readonly state: "verified";
      readonly atlasCommit: string;
      readonly atlasContentDigest: string;
      readonly findings: readonly Finding[];
    }
  | {
      readonly state: "rejected";
      readonly findings: readonly Finding[];
    };

function rejected(code: string, message: string): LintStampVerification {
  return Object.freeze({
    state: "rejected" as const,
    findings: Object.freeze([
      Object.freeze({
        attribution: Object.freeze({
          checkId: "sdk-core.lint-stamp",
          kind: "sdk-core" as const,
          trusted: true as const,
        }),
        code,
        "finding-schema": "1.0.0",
        message,
        path: ".atlas",
        severity: "error" as const,
      }),
    ]),
  });
}

/**
 * Verifies content identity, not attestation authenticity or semantic verdicts.
 * Accepts emitted JSON or its parsed object. tests/lint_stamp_verification.test.ts
 * pins named-commit verification without checkout or changes to Git state.
 */
export function verifyLocalAtlasLintStamp(
  repository: string,
  input: unknown,
): LintStampVerification {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error;
      return rejected("ATLAS_LINT_STAMP_INVALID", "The Lint Stamp must be valid JSON.");
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return rejected("ATLAS_LINT_STAMP_INVALID", "The Lint Stamp must be an object.");
  }
  const stamp: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!("value" in descriptor)) {
      return rejected(
        "ATLAS_LINT_STAMP_INVALID",
        "The Lint Stamp must contain data fields, not accessors.",
      );
    }
    Object.defineProperty(stamp, key, { value: descriptor.value, enumerable: true });
  }
  if (stamp["lint-stamp-schema"] !== "1.1.0") {
    return rejected(
      "ATLAS_LINT_STAMP_UNSUPPORTED",
      "Only Lint Stamp schema 1.1.0 carries supported Atlas content evidence. Obtain a new stamp through Initialization.",
    );
  }
  const commit = stamp["atlasCommit"];
  const digest = stamp["atlasContentDigest"];
  const keys = [
    "lint-stamp-schema",
    "atlasCommit",
    "atlasContentDigest",
    "evidenceRevision",
  ];
  if (
    Object.keys(stamp).length !== keys.length ||
    Object.keys(stamp).some((key) => !keys.includes(key)) ||
    typeof commit !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit) ||
    stamp["evidenceRevision"] !== commit ||
    typeof digest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(digest)
  ) {
    return rejected(
      "ATLAS_LINT_STAMP_INVALID",
      "The Lint Stamp must contain a full commit object ID, matching evidence revision, and a SHA-256 Atlas content digest.",
    );
  }
  const capture = captureLocalAtlasSnapshot(repository, undefined, commit);
  if (capture.state === "failed") {
    return rejected("ATLAS_LINT_STAMP_SNAPSHOT_UNAVAILABLE", capture.reason);
  }
  if (capture.snapshot.capturedFiles.length === 0) {
    return rejected(
      "ATLAS_LINT_STAMP_SNAPSHOT_UNAVAILABLE",
      "The named commit has no Atlas in the selected Atlas Host Directory.",
    );
  }
  let actualDigest: string;
  try {
    actualDigest = loadAtlasTextWithByteLengths(
      capture.snapshot.capturedFiles,
      defaultAtlasTextBudgets,
    ).atlasContentDigest;
  } catch (error: unknown) {
    if (!(error instanceof AtlasLoadError)) throw error;
    return rejected("ATLAS_LINT_STAMP_SNAPSHOT_UNAVAILABLE", error.message);
  }
  if (actualDigest !== digest) {
    return rejected(
      "ATLAS_LINT_STAMP_CONTENT_MISMATCH",
      "The named commit's Atlas paths or bytes differ from the validated content recorded by the Lint Stamp.",
    );
  }
  return Object.freeze({
    state: "verified" as const,
    atlasCommit: commit,
    atlasContentDigest: actualDigest,
    findings: Object.freeze([]),
  });
}
