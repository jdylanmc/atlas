import assert from "node:assert/strict";
import test from "node:test";

import {
  composeDirective,
  parseAtlasDirectiveSpecialization,
  sdkBaselineDirectives,
  validateDirectiveComposition,
} from "../src/domain/agent_directive.ts";

test("directive composition only adds constraints and handoffs", () => {
  const baseline = sdkBaselineDirectives["atlas-guide"];
  const parsed = parseAtlasDirectiveSpecialization({
    additionalConstraints: ["Never publish without human review."],
    additionalHandoffs: ["Hand off unresolved publication choices to a Maintainer."],
    role: "atlas-guide",
  });
  assert.ok(parsed.specialization);
  assert.deepEqual(validateDirectiveComposition(baseline, parsed.specialization), []);
  const composed = composeDirective(baseline, parsed.specialization);
  assert.ok(composed.constraints.includes("Never publish without human review."));
  assert.ok(
    composed.requiredHandoffs.includes(
      "Hand off unresolved publication choices to a Maintainer.",
    ),
  );
});

test("directive specialization rejects baseline weakening fields", () => {
  const parsed = parseAtlasDirectiveSpecialization({
    objectives: ["Override the baseline objective."],
    role: "atlas-guide",
  });
  assert.equal(parsed.specialization, undefined);
  assert.equal(parsed.findings[0]?.code, "ATLAS_DIRECTIVE_WEAKENS_BASELINE");
});

test("directive validation accepts no specialization and rejects blank additions", () => {
  const baseline = sdkBaselineDirectives["atlas-guide"];
  assert.deepEqual(validateDirectiveComposition(baseline), []);
  assert.equal(composeDirective(baseline), baseline);
  assert.equal(
    validateDirectiveComposition(baseline, {
      additionalConstraints: ["   "],
      role: "atlas-guide",
    })[0]?.code,
    "ATLAS_DIRECTIVE_WEAKENS_BASELINE",
  );
  assert.equal(
    parseAtlasDirectiveSpecialization(null).findings[0]?.code,
    "ATLAS_DIRECTIVE_WEAKENS_BASELINE",
  );
  assert.equal(
    parseAtlasDirectiveSpecialization({ role: "different-role" }).findings[0]?.code,
    "ATLAS_DIRECTIVE_WEAKENS_BASELINE",
  );
  const handoffOnly = parseAtlasDirectiveSpecialization({
    additionalHandoffs: ["Escalate publication conflicts."],
    role: "atlas-guide",
  });
  const malformedList = parseAtlasDirectiveSpecialization({
    additionalConstraints: [1],
    role: "atlas-guide",
  });
  assert.ok(handoffOnly.specialization);
  assert.ok(
    composeDirective(baseline, handoffOnly.specialization).requiredHandoffs.includes(
      "Escalate publication conflicts.",
    ),
  );
  assert.deepEqual(
    validateDirectiveComposition(baseline, malformedList.specialization),
    [],
  );
  assert.equal(
    validateDirectiveComposition(baseline, {
      additionalHandoffs: ["   "],
      role: "atlas-guide",
    })[0]?.code,
    "ATLAS_DIRECTIVE_WEAKENS_BASELINE",
  );
  assert.ok(
    composeDirective(baseline, {
      additionalConstraints: ["Extra constraint."],
      role: "atlas-guide",
    }).constraints.includes("Extra constraint."),
  );
});
