import type { AtlasReadinessReport } from "./initialize_operation.ts";

function bullet(value: string): string {
  return `- ${value.replaceAll(/\r\n?|\n/gu, "\n  ")}`;
}

export function renderAtlasReadinessReportMarkdown(
  report: AtlasReadinessReport,
): string {
  const sections: (readonly [string, string])[] = [
    ["Boundary", report.boundary],
    ["Guide", report.guide],
    ["Governance", report.governance],
    ["Founding evidence", report.evidence],
    ["Founding graph", report.foundingGraph],
    ["Integrations", report.integration],
    ["Degradations", report.degradation],
    ["Uninspected areas", report.uninspectedAreas],
    [
      "Lint Stamp",
      [
        "```json",
        JSON.stringify(report.lintStamp, null, 2),
        "```",
        "",
        "Any change to the stamped commit invalidates this stamp. Semantic verdicts",
        "are attested, not reproduced or identified here. The producing Atlas SDK",
        "version is not recorded; deterministic evidence is reproducible only",
        "within one Atlas SDK version.",
      ].join("\n"),
    ],
  ];
  if (report.capabilities !== undefined) {
    sections.push([
      "Capability coverage",
      report.capabilities.length === 0
        ? "No capability entries were reported."
        : report.capabilities
            .map((capability) =>
              [
                `### ${capability.id}`,
                `Selected: ${capability.selected ? "yes" : "no"}; status: ${capability.status}.`,
                capability.evidence.length === 0
                  ? "No evidence was reported."
                  : capability.evidence.map(bullet).join("\n"),
              ].join("\n\n"),
            )
            .join("\n\n"),
    ]);
  }
  if (report.unresolvedDecisions !== undefined) {
    sections.push([
      "Unresolved decisions",
      report.unresolvedDecisions.length === 0
        ? "No unresolved decisions were reported."
        : report.unresolvedDecisions.map(bullet).join("\n"),
    ]);
  }
  sections.push(
    ["Publication handoff", report.publicationHandoff],
    ["Recommended next action", report.nextAction],
  );
  return [
    "# Atlas Readiness Report",
    ...sections.map(([heading, content]) => `## ${heading}\n\n${content}`),
    "",
  ].join("\n\n");
}
