import assert from "node:assert/strict";
import test from "node:test";

import { validateAgentComposition } from "../src/domain/agent_composition.ts";
import { sdkBaselineDirectives } from "../src/domain/agent_directive.ts";

test("agent composition requires at least one directive", () => {
  const findings = validateAgentComposition({ directives: Object.freeze([]) });
  assert.equal(findings[0]?.code, "ATLAS_COMPOSITION_EMPTY_DIRECTIVES");
});

test("agent composition rejects persona authority metadata", () => {
  const findings = validateAgentComposition({
    directives: Object.freeze([sdkBaselineDirectives["atlas-guide"]]),
    persona: {
      approvedAt: "2026-08-24T12:00:00Z",
      approvedBy: "Reviewer",
      authority: "override",
      name: "Meridian",
      personaId: "meridian",
      voice: "Calm and direct.",
    } as unknown as never,
  });
  assert.equal(findings[0]?.code, "ATLAS_COMPOSITION_PERSONA_AUTHORITY_CONFLICT");
});
