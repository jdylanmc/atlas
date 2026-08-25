import type { Finding } from "./finding.ts";
import type { AgentDirective } from "./agent_directive.ts";
import type { AgentPersona } from "./agent_persona.ts";

export interface AgentComposition {
  readonly directives: readonly AgentDirective[];
  readonly persona?: AgentPersona;
}

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.agent-composition",
  kind: "sdk-core" as const,
  trusted: true as const,
});

function finding(
  code:
    | "ATLAS_COMPOSITION_EMPTY_DIRECTIVES"
    | "ATLAS_COMPOSITION_PERSONA_AUTHORITY_CONFLICT",
  message: string,
): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path: ".atlas",
    severity: "error" as const,
  });
}

export function validateAgentComposition(
  composition: AgentComposition,
): readonly Finding[] {
  const findings: Finding[] = [];
  if (composition.directives.length === 0) {
    findings.push(
      finding(
        "ATLAS_COMPOSITION_EMPTY_DIRECTIVES",
        "Agent Composition requires one or more authoritative Directives in order.",
      ),
    );
  }
  if (
    composition.persona !== undefined &&
    ["authority", "directive", "precedence", "weight"].some((key) =>
      Object.hasOwn(composition.persona as unknown as Record<string, unknown>, key),
    )
  ) {
    findings.push(
      finding(
        "ATLAS_COMPOSITION_PERSONA_AUTHORITY_CONFLICT",
        "Agent Composition rejects Persona authority metadata because Directives remain authoritative.",
      ),
    );
  }
  return Object.freeze(findings);
}
