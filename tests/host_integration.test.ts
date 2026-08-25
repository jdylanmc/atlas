import assert from "node:assert/strict";
import test from "node:test";

import {
  generateHostIntegrationPointers,
  validateHostIntegrationChangeSet,
} from "../src/domain/host_integration.ts";
import { sdkBaselineDirectives } from "../src/domain/agent_directive.ts";

test("host integration emits thin pointer records only", () => {
  const pointers = generateHostIntegrationPointers(
    {
      directives: Object.freeze([sdkBaselineDirectives["atlas-guide"]]),
      persona: {
        approvedAt: "2026-08-24T12:00:00Z",
        approvedBy: "Reviewer",
        name: "Meridian",
        personaId: "meridian",
        voice: "Calm and direct.",
      },
    },
    ["atlas-entry"],
  );
  assert.ok(pointers.some((pointer) => pointer.kind === "composition"));
  assert.ok(pointers.some((pointer) => pointer.kind === "persona"));
  assert.deepEqual(
    validateHostIntegrationChangeSet([
      {
        content: '{\n  "canonicalPath": '.concat(
          '".atlas/types/persona/meridian.md"\n}\n',
        ),
        path: ".atlas/types/guide/atlas-guide.composition.json",
      },
    ]),
    [],
  );
});

test("host integration rejects duplicated canonical bodies", () => {
  const findings = validateHostIntegrationChangeSet([
    {
      content: "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\n",
      path: ".atlas/types/guide/atlas-guide.composition.json",
    },
  ]);
  assert.equal(findings[0]?.code, "ATLAS_HOST_INTEGRATION_DUPLICATES_BODY");
  assert.deepEqual(
    validateHostIntegrationChangeSet([
      {
        content: "not a pointer body",
        path: ".atlas/concepts/ignored.md",
      },
    ]),
    [],
  );
});
