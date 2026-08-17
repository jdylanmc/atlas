import {
  OPERATION_HANDOFF_SCHEMA,
  OPERATION_RESULT_SCHEMA,
  type FailedOperationResult,
  type Finding,
  type OperationHandoff,
  type OperationResult,
} from "../domain/contracts.ts";
import { loadRealm, type RealmLoadResult, type SourceFile } from "../realm/load.ts";

function operationId(digest: string): string {
  return `weave:${digest.replace(/^sha256:/, "").slice(0, 24)}`;
}

function counts(findings: readonly Finding[]): { errors: number; warnings: number } {
  return {
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
  };
}

function handoff(
  result: RealmLoadResult,
  state: "valid" | "blocked",
): OperationHandoff {
  const validation = counts(result.findings);
  const manifest = result.valid ? result.view.manifest : result.manifest;
  const digest = result.valid ? result.view.digest : result.digest;
  return Object.freeze({
    schema: OPERATION_HANDOFF_SCHEMA,
    operationId: operationId(digest),
    operation: "weave",
    homeRealm: Object.freeze({
      id: manifest?.realm.id ?? null,
      title: manifest?.realm.title ?? null,
    }),
    baseSnapshot: Object.freeze({ kind: "realm-content", digest }),
    summary:
      state === "valid"
        ? "Trusted deterministic Weave completed with no error Findings."
        : "Trusted deterministic Weave blocked on structural error Findings.",
    unresolvedDecisions: Object.freeze([]),
    validation: Object.freeze({ state, ...validation }),
    reviewLink: null,
    recommendedNextAction:
      state === "valid"
        ? "Use the validated immutable Realm View for the next Atlas operation."
        : "Repair the attributed Findings and rerun the full Weave.",
  });
}

export function weaveRealm(
  files: readonly SourceFile[],
  combineDigest: (files: readonly SourceFile[]) => string,
): OperationResult {
  const result = loadRealm(files, combineDigest);
  if (!result.valid) {
    return Object.freeze({
      schema: OPERATION_RESULT_SCHEMA,
      status: "blocked",
      operation: "weave",
      operationId: operationId(result.digest),
      findings: result.findings,
      handoff: handoff(result, "blocked"),
    });
  }
  const encoder = new TextEncoder();
  const bytes = result.view.canonicalFiles.reduce(
    (total, file) => total + encoder.encode(file.text).byteLength,
    0,
  );
  return Object.freeze({
    schema: OPERATION_RESULT_SCHEMA,
    status: "completed",
    operation: "weave",
    operationId: operationId(result.view.digest),
    findings: result.findings,
    output: Object.freeze({
      realm: Object.freeze({
        id: result.view.manifest.realm.id,
        title: result.view.manifest.realm.title,
        atlasSchema: result.view.manifest.atlasSchema,
        realmSchema: result.view.manifest.realmSchema,
        digest: result.view.digest,
      }),
      serialization: Object.freeze({
        files: result.view.canonicalFiles.length,
        bytes,
        digest: result.view.digest,
      }),
    }),
    handoff: handoff(result, "valid"),
  });
}

export function failedWeaveResult(message: string): FailedOperationResult {
  const digest = "unavailable";
  return Object.freeze({
    schema: OPERATION_RESULT_SCHEMA,
    status: "failed",
    operation: "weave",
    operationId: operationId(digest),
    findings: Object.freeze([]),
    failure: Object.freeze({ code: "ATLAS_WEAVE_UNEXPECTED_FAILURE", message }),
    handoff: Object.freeze({
      schema: OPERATION_HANDOFF_SCHEMA,
      operationId: operationId(digest),
      operation: "weave",
      homeRealm: Object.freeze({ id: null, title: null }),
      baseSnapshot: Object.freeze({ kind: "realm-content", digest }),
      summary: "Weave failed closed because the Realm could not be loaded.",
      unresolvedDecisions: Object.freeze([]),
      validation: Object.freeze({ state: "failed", errors: 0, warnings: 0 }),
      reviewLink: null,
      recommendedNextAction:
        "Resolve the reported runtime failure before retrying Weave.",
    }),
  });
}
