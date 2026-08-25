import { compareCodePoints } from "./domain_support.ts";
import type { Finding } from "./finding.ts";
import type { AgentComposition } from "./agent_composition.ts";

export interface HostIntegrationPointer {
  readonly canonicalPath: string;
  readonly kind: "composition" | "directive" | "persona" | "skill";
  readonly targetPath: string;
}

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.host-integration",
  kind: "sdk-core" as const,
  trusted: true as const,
});

function finding(message: string, path = ".atlas"): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code: "ATLAS_HOST_INTEGRATION_DUPLICATES_BODY",
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "error" as const,
  });
}

export function generateHostIntegrationPointers(
  composition: AgentComposition,
  skills: readonly string[],
): readonly HostIntegrationPointer[] {
  const pointers: HostIntegrationPointer[] = [];
  for (const directive of composition.directives) {
    pointers.push(
      Object.freeze({
        canonicalPath: `.atlas/types/directive/${directive.role}.md`,
        kind: "directive",
        targetPath: `.atlas/types/guide/${directive.role}.directive.json`,
      }),
    );
  }
  if (composition.persona !== undefined) {
    pointers.push(
      Object.freeze({
        canonicalPath: `.atlas/types/persona/${composition.persona.personaId}.md`,
        kind: "persona",
        targetPath: `.atlas/types/guide/${composition.persona.personaId}.persona.json`,
      }),
    );
  }
  pointers.push(
    Object.freeze({
      canonicalPath: `.atlas/types/agent-composition/atlas-guide.md`,
      kind: "composition",
      targetPath: ".atlas/types/guide/atlas-guide.composition.json",
    }),
  );
  for (const skill of skills) {
    pointers.push(
      Object.freeze({
        canonicalPath: `.atlas/types/skill/${skill}.md`,
        kind: "skill",
        targetPath: `.atlas/types/guide/skills/${skill}.json`,
      }),
    );
  }
  return Object.freeze(
    pointers.sort((left, right) =>
      compareCodePoints(left.targetPath, right.targetPath),
    ),
  );
}

export function validateHostIntegrationChangeSet(
  changes: readonly { readonly content: string; readonly path: string }[],
): readonly Finding[] {
  const findings: Finding[] = [];
  for (const change of changes) {
    if (!change.path.startsWith(".atlas/types/guide/")) {
      continue;
    }
    const lines = change.content.trim().split(/\r?\n/u);
    if (lines.length > 8 || !change.content.includes("canonicalPath")) {
      findings.push(
        finding(
          "Host Integration pointer files must stay thin and reference-only; they may not duplicate canonical artifact bodies.",
          change.path,
        ),
      );
    }
  }
  return Object.freeze(findings);
}
