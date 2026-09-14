import type { ParsedAtlasPage } from "../atlas/parse_atlas_pages.ts";
import { dateTimeMilliseconds } from "../domain/atlas_page.ts";
import type { Finding } from "../domain/finding.ts";
import { sdkFindings } from "./sdk_finding.ts";

const finding = sdkFindings("sdk-core.source-freshness");

export function sourceFreshnessFindings(
  pages: readonly ParsedAtlasPage[],
  asOf: string | undefined,
): readonly Finding[] {
  if (asOf === undefined) return Object.freeze([]);
  const observed = dateTimeMilliseconds(asOf);
  if (observed === undefined) {
    return Object.freeze([
      finding(
        "ATLAS_LINT_AS_OF_INVALID",
        "Lint observation time must be a comparable date-time with an explicit timezone.",
        ".atlas",
      ),
    ]);
  }
  const findings: Finding[] = [];
  for (const { page, source } of pages) {
    if (page.sdk.type !== "source") continue;
    const revisionTime = page.atlas["revision-time"];
    const window = page.atlas["refresh-window-days"];
    const revised =
      typeof revisionTime === "string" ? dateTimeMilliseconds(revisionTime) : undefined;
    if (revised === undefined || typeof window !== "number" || window < 0) {
      findings.push(
        finding(
          "ATLAS_SOURCE_FRESHNESS_UNAVAILABLE",
          "Source freshness was not assessed: a comparable persisted revision-time and a finite non-negative refresh-window-days are required.",
          source.path,
          undefined,
          "skipped",
        ),
      );
      continue;
    }
    if (revised > observed) {
      findings.push(
        finding(
          "ATLAS_SOURCE_REVISION_AFTER_OBSERVATION",
          "Source Revision Time is later than the supplied observation time; freshness is inconclusive.",
          source.path,
          undefined,
          "inconclusive",
        ),
      );
      continue;
    }
    if ((observed - revised) / 86_400_000 > window) {
      findings.push(
        finding(
          "ATLAS_SOURCE_STALE",
          "Source revision is older than its persisted refresh window at the supplied observation time; supporting knowledge can be re-Ingested.",
          source.path,
          undefined,
          "warning",
        ),
      );
    }
  }
  return Object.freeze(findings);
}
