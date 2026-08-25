import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAgentPersonaDesignRequest,
  validateAgentPersona,
  validatePersonaActivation,
  validatePersonaApproval,
} from "../src/domain/agent_persona.ts";

test("agent persona rejects injected authority keys on raw input", () => {
  const raw = JSON.parse(`{
    "approvedBy": "Reviewer",
    "approvedAt": "2026-08-24T12:00:00Z",
    "proposed": {
      "personaId": "meridian",
      "name": "Meridian",
      "voice": "Calm and direct.",
      "authority": "override"
    }
  }`) as unknown;
  const parsed = parseAgentPersonaDesignRequest(raw);
  assert.equal(parsed.request, undefined);
  assert.equal(parsed.findings[0]?.code, "ATLAS_PERSONA_AUTHORITY_VIOLATION");
});

test("agent persona approval and activation are validated independently", () => {
  const parsed = parseAgentPersonaDesignRequest({
    activationConfirmedAt: "2026-08-24T11:59:00Z",
    activationConfirmedBy: "Reviewer",
    approvedAt: "2026-08-24T12:00:00Z",
    approvedBy: "Reviewer",
    proposed: {
      name: "Meridian",
      personaId: "meridian",
      voice: "Calm and direct.",
    },
  });
  assert.ok(parsed.request);
  assert.deepEqual(validateAgentPersona(parsed.request.proposed), []);
  assert.deepEqual(validatePersonaApproval(parsed.request), []);
  assert.equal(
    validatePersonaActivation(parsed.request)[0]?.code,
    "ATLAS_PERSONA_ACTIVATION_BEFORE_APPROVAL",
  );
});

test("agent persona requires approval before writing", () => {
  const parsed = parseAgentPersonaDesignRequest({
    proposed: {
      name: "Meridian",
      personaId: "meridian",
      voice: "Calm and direct.",
    },
  });
  assert.ok(parsed.request);
  assert.equal(
    validatePersonaApproval(parsed.request)[0]?.code,
    "ATLAS_PERSONA_APPROVAL_REQUIRED",
  );
});

test("agent persona validation accepts valid activation and rejects blank identities", () => {
  const parsed = parseAgentPersonaDesignRequest({
    activationConfirmedAt: "2026-08-24T12:01:00Z",
    activationConfirmedBy: "Reviewer",
    approvedAt: "2026-08-24T12:00:00Z",
    approvedBy: "Reviewer",
    proposed: {
      name: "Meridian",
      personaId: "meridian",
      voice: "Calm and direct.",
    },
  });
  assert.ok(parsed.request);
  assert.deepEqual(validatePersonaActivation(parsed.request), []);
  assert.deepEqual(
    validatePersonaActivation({
      proposed: parsed.request.proposed,
    }),
    [],
  );
  assert.equal(
    validateAgentPersona({
      name: "Meridian",
      personaId: "",
      voice: "Calm and direct.",
    })[0]?.code,
    "ATLAS_PERSONA_AUTHORITY_VIOLATION",
  );
  assert.equal(
    parseAgentPersonaDesignRequest(null).findings[0]?.code,
    "ATLAS_PERSONA_AUTHORITY_VIOLATION",
  );
  assert.equal(
    parseAgentPersonaDesignRequest({ approvedBy: "Reviewer" }).findings[0]?.code,
    "ATLAS_PERSONA_AUTHORITY_VIOLATION",
  );
  const coerced = parseAgentPersonaDesignRequest({
    approvedAt: "2026-08-24T12:00:00Z",
    approvedBy: "Reviewer",
    proposed: {
      avatar: "avatar.svg",
      name: 5,
      personaId: "meridian",
      voice: "Calm and direct.",
    },
  });
  assert.ok(coerced.request);
  assert.equal(coerced.request.proposed.avatar, "avatar.svg");
  assert.equal(coerced.request.proposed.name, "");
  assert.deepEqual(validatePersonaApproval(coerced.request), []);
  assert.deepEqual(
    validatePersonaApproval({
      approvedAt: "2026-08-24T12:00:00Z",
      approvedBy: "Reviewer",
      proposed: coerced.request.proposed,
    }),
    [],
  );
  assert.deepEqual(
    validatePersonaActivation({
      activationConfirmedAt: "2026-08-24T12:01:00Z",
      activationConfirmedBy: "Reviewer",
      approvedAt: "2026-08-24T12:00:00Z",
      approvedBy: "Reviewer",
      proposed: coerced.request.proposed,
    }),
    [],
  );
  assert.equal(
    validatePersonaActivation({
      activationConfirmedAt: "2026-08-24T12:01:00Z",
      activationConfirmedBy: "Reviewer",
      approvedAt: "not-a-date",
      approvedBy: "Reviewer",
      proposed: coerced.request.proposed,
    })[0]?.code,
    "ATLAS_PERSONA_ACTIVATION_BEFORE_APPROVAL",
  );
  assert.equal(
    validatePersonaApproval({
      approvedBy: "Reviewer",
      proposed: coerced.request.proposed,
    })[0]?.code,
    "ATLAS_PERSONA_APPROVAL_REQUIRED",
  );
  assert.equal(
    validatePersonaActivation({
      activationConfirmedAt: "2026-08-24T12:01:00Z",
      activationConfirmedBy: "Reviewer",
      approvedBy: "Reviewer",
      proposed: coerced.request.proposed,
    })[0]?.code,
    "ATLAS_PERSONA_ACTIVATION_BEFORE_APPROVAL",
  );
});
