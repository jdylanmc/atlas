import type { Finding } from "../domain/finding.ts";

const providerAttribution = Object.freeze({
  checkId: "sdk-core.explore-provider",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const maxProviderDiagnostics = 32;

export interface ExploreCandidate {
  readonly objectId: string;
  readonly score: number;
}

export interface ExploreSearchDocument {
  readonly body: string;
  readonly id: string;
  readonly path: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly type: string;
}

export interface SearchProviderDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "inconclusive" | "warning";
}

export interface SearchProviderRanking {
  readonly candidates: readonly ExploreCandidate[];
  readonly diagnostics?: readonly SearchProviderDiagnostic[];
}

export interface SearchProvider {
  readonly rank: (
    documents: readonly ExploreSearchDocument[],
    query: string,
    budgets: {
      readonly maxQueryCharacters: number;
      readonly maxTerms: number;
    },
  ) => readonly ExploreCandidate[] | SearchProviderRanking;
}

function isCandidateArray(value: unknown): value is readonly ExploreCandidate[] {
  return Array.isArray(value);
}

function diagnostic(
  code: string,
  message: string,
  severity: Finding["severity"],
): Finding {
  return Object.freeze({
    attribution: providerAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path: ".atlas",
    severity,
  });
}

function providerDiagnostics(value: unknown): readonly Finding[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const findings: Finding[] = [];
  for (const rawEntry of value.slice(0, maxProviderDiagnostics) as unknown[]) {
    const entry =
      rawEntry !== null && typeof rawEntry === "object"
        ? (rawEntry as Readonly<Record<string, unknown>>)
        : undefined;
    const code = entry?.["code"];
    const message = entry?.["message"];
    const severity = entry?.["severity"];
    if (
      entry === undefined ||
      typeof code !== "string" ||
      !/^ATLAS_[A-Z0-9_]+$/u.test(code) ||
      typeof message !== "string" ||
      message.trim() === "" ||
      (severity !== "warning" && severity !== "inconclusive")
    ) {
      findings.push(
        diagnostic(
          "ATLAS_EXPLORE_PROVIDER_DIAGNOSTIC_INVALID",
          "Search Provider returned a diagnostic Explore could not use.",
          "warning",
        ),
      );
      continue;
    }
    findings.push(diagnostic(code, message, severity));
  }
  return Object.freeze(findings);
}

export function validateSearchProviderRanking(
  value: unknown,
  validObjectIds: ReadonlySet<string>,
): {
  readonly diagnostics: readonly Finding[];
  readonly ranked: readonly ExploreCandidate[];
} {
  const ranking =
    value !== null && typeof value === "object"
      ? (value as Readonly<Record<string, unknown>>)
      : undefined;
  const suppliedCandidates: readonly unknown[] | undefined = isCandidateArray(value)
    ? value
    : ranking !== undefined && Array.isArray(ranking["candidates"])
      ? (ranking["candidates"] as readonly unknown[])
      : undefined;
  if (suppliedCandidates === undefined) {
    throw new TypeError("Search Provider must return candidates.");
  }

  const diagnostics: Finding[] = [
    ...providerDiagnostics(
      isCandidateArray(value) ? undefined : ranking?.["diagnostics"],
    ),
  ];
  const valid: ExploreCandidate[] = [];
  const seen = new Set<string>();
  for (const rawCandidate of suppliedCandidates.slice(0, validObjectIds.size + 1)) {
    const candidate =
      rawCandidate !== null && typeof rawCandidate === "object"
        ? (rawCandidate as Readonly<Record<string, unknown>>)
        : undefined;
    const objectId = candidate?.["objectId"];
    const score = candidate?.["score"];
    if (
      candidate === undefined ||
      typeof objectId !== "string" ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score <= 0 ||
      !validObjectIds.has(objectId) ||
      seen.has(objectId)
    ) {
      diagnostics.push(
        diagnostic(
          "ATLAS_EXPLORE_PROVIDER_CANDIDATE_INVALID",
          "Search Provider returned a candidate Explore could not use.",
          "warning",
        ),
      );
      continue;
    }
    seen.add(objectId);
    valid.push(Object.freeze({ objectId, score }));
  }
  if (suppliedCandidates.length > validObjectIds.size + 1) {
    diagnostics.push(
      diagnostic(
        "ATLAS_EXPLORE_PROVIDER_CANDIDATE_INVALID",
        "Search Provider returned more candidates than Explore could use.",
        "warning",
      ),
    );
  }
  return {
    diagnostics: Object.freeze(diagnostics.slice(0, maxProviderDiagnostics)),
    ranked: Object.freeze(valid),
  };
}
