import { dateTimeMilliseconds } from "./atlas_page.ts";
import type { Finding } from "./finding.ts";

export interface AgentPersona {
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly avatar?: string;
  readonly name: string;
  readonly personaId: string;
  readonly voice: string;
}

export interface AgentPersonaDesignRequest {
  readonly activationConfirmedAt?: string;
  readonly activationConfirmedBy?: string;
  readonly approvedAt?: string;
  readonly approvedBy?: string;
  readonly proposed: Omit<AgentPersona, "approvedAt" | "approvedBy">;
}

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.agent-persona",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const personaRequestKeys = Object.freeze([
  "activationConfirmedAt",
  "activationConfirmedBy",
  "approvedAt",
  "approvedBy",
  "proposed",
] as const);

const proposedPersonaKeys = Object.freeze([
  "avatar",
  "name",
  "personaId",
  "voice",
] as const);

function finding(code: string, message: string, path = ".atlas"): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "error" as const,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function foreignKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): readonly string[] {
  return Object.freeze(Object.keys(value).filter((key) => !allowed.includes(key)));
}

function authorityViolation(keys: readonly string[]): readonly Finding[] {
  return keys.length === 0
    ? Object.freeze([])
    : Object.freeze([
        finding(
          "ATLAS_PERSONA_AUTHORITY_VIOLATION",
          `Agent Persona input contains forbidden authority or foreign keys: ${keys.join(", ")}.`,
        ),
      ]);
}

export function parseAgentPersonaDesignRequest(value: unknown): {
  readonly findings: readonly Finding[];
  readonly request?: AgentPersonaDesignRequest;
} {
  if (!isRecord(value)) {
    return Object.freeze({
      findings: Object.freeze([
        finding(
          "ATLAS_PERSONA_AUTHORITY_VIOLATION",
          "Agent Persona Design input must be an object with only the allowed own properties.",
        ),
      ]),
    });
  }
  const requestForeignKeys = foreignKeys(value, personaRequestKeys);
  const proposed = value["proposed"];
  const proposedRecord = isRecord(proposed) ? proposed : undefined;
  const proposedForeignKeys =
    proposedRecord === undefined
      ? Object.freeze([])
      : foreignKeys(proposedRecord, proposedPersonaKeys);
  const findings = Object.freeze([
    ...authorityViolation(requestForeignKeys),
    ...(proposedRecord !== undefined
      ? authorityViolation(proposedForeignKeys)
      : [
          finding(
            "ATLAS_PERSONA_AUTHORITY_VIOLATION",
            "Agent Persona Design input must include a proposed Persona object.",
          ),
        ]),
  ]);
  if (findings.length > 0) {
    return Object.freeze({ findings });
  }
  const request: AgentPersonaDesignRequest = Object.freeze({
    ...(nonBlankString(value["activationConfirmedAt"])
      ? { activationConfirmedAt: value["activationConfirmedAt"] }
      : {}),
    ...(nonBlankString(value["activationConfirmedBy"])
      ? { activationConfirmedBy: value["activationConfirmedBy"] }
      : {}),
    ...(nonBlankString(value["approvedAt"]) ? { approvedAt: value["approvedAt"] } : {}),
    ...(nonBlankString(value["approvedBy"]) ? { approvedBy: value["approvedBy"] } : {}),
    proposed: Object.freeze({
      ...(nonBlankString(proposedRecord?.["avatar"])
        ? { avatar: proposedRecord["avatar"] }
        : {}),
      name: stringOrEmpty(proposedRecord?.["name"]),
      personaId: stringOrEmpty(proposedRecord?.["personaId"]),
      voice: stringOrEmpty(proposedRecord?.["voice"]),
    }),
  });
  return Object.freeze({ findings: Object.freeze([]), request });
}

export function validatePersonaApproval(
  request: AgentPersonaDesignRequest,
): readonly Finding[] {
  if (
    nonBlankString(request.approvedBy) &&
    dateTimeMilliseconds(request.approvedAt ?? "") !== undefined
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([
    finding(
      "ATLAS_PERSONA_APPROVAL_REQUIRED",
      "Persona Design requires explicit human approval identity and approval instant before the Persona may be written.",
    ),
  ]);
}

export function validatePersonaActivation(
  request: AgentPersonaDesignRequest,
): readonly Finding[] {
  const activationIdentityPresent = nonBlankString(request.activationConfirmedBy);
  const activationInstant = dateTimeMilliseconds(request.activationConfirmedAt ?? "");
  if (!activationIdentityPresent && activationInstant === undefined) {
    return Object.freeze([]);
  }
  const approvalInstant = dateTimeMilliseconds(request.approvedAt ?? "");
  if (
    !activationIdentityPresent ||
    activationInstant === undefined ||
    approvalInstant === undefined ||
    activationInstant < approvalInstant
  ) {
    return Object.freeze([
      finding(
        "ATLAS_PERSONA_ACTIVATION_BEFORE_APPROVAL",
        "Persona activation confirmation must be complete and cannot precede the Persona approval instant.",
      ),
    ]);
  }
  return Object.freeze([]);
}

export function validateAgentPersona(
  persona: Omit<AgentPersona, "approvedAt" | "approvedBy">,
): readonly Finding[] {
  const missing = [persona.personaId, persona.name, persona.voice].some(
    (value) => !nonBlankString(value),
  );
  return missing
    ? Object.freeze([
        finding(
          "ATLAS_PERSONA_AUTHORITY_VIOLATION",
          "Agent Persona requires non-blank personaId, name, and voice values and carries no behavioral authority fields.",
        ),
      ])
    : Object.freeze([]);
}
