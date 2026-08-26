import type { Finding } from "./finding.ts";

export type AgentRole = "atlas-guide";

export interface AgentDirective {
  readonly allowedActions: readonly string[];
  readonly constraints: readonly string[];
  readonly objectives: readonly string[];
  readonly requiredHandoffs: readonly string[];
  readonly responsibilities: readonly string[];
  readonly role: AgentRole;
}

export interface AtlasDirectiveSpecialization {
  readonly additionalConstraints?: readonly string[];
  readonly additionalHandoffs?: readonly string[];
  readonly role: AgentRole;
}

const trustedAttribution = Object.freeze({
  checkId: "sdk-core.agent-directive",
  kind: "sdk-core" as const,
  trusted: true as const,
});

export const sdkBaselineDirectives = Object.freeze({
  "atlas-guide": Object.freeze({
    allowedActions: Object.freeze([
      "guide navigation through Anchors and Concepts",
      "draft Atlas Changelog entries",
      "propose provisional terminology for unnamed concepts",
    ]),
    constraints: Object.freeze([
      "Directive semantics override any Persona presentation.",
      "Do not weaken Atlas SDK contracts, Atlas Policies, or active Principle truths.",
    ]),
    objectives: Object.freeze([
      "Guide navigation through the Home Atlas and connected knowledge with explicit evidence.",
    ]),
    requiredHandoffs: Object.freeze([
      "Escalate unresolved governance or evidence conflicts to a human Maintainer.",
    ]),
    responsibilities: Object.freeze([
      "Narrate Re-anchor checkpoints and steward Atlas knowledge under human governance.",
    ]),
    role: "atlas-guide" as const,
  }),
}) satisfies Readonly<Record<AgentRole, AgentDirective>>;

const specializationKeys = Object.freeze([
  "additionalConstraints",
  "additionalHandoffs",
  "role",
] as const);

function finding(message: string): Finding {
  return Object.freeze({
    attribution: trustedAttribution,
    code: "ATLAS_DIRECTIVE_WEAKENS_BASELINE",
    "finding-schema": "1.0.0",
    message,
    path: ".atlas",
    severity: "error" as const,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonBlankStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
  );
  return strings.length === value.length ? Object.freeze(strings) : undefined;
}

export function parseAtlasDirectiveSpecialization(value: unknown): {
  readonly findings: readonly Finding[];
  readonly specialization?: AtlasDirectiveSpecialization;
} {
  if (!isRecord(value)) {
    return Object.freeze({
      findings: Object.freeze([
        finding(
          "Directive specialization must be an object that can only add constraints and required handoffs.",
        ),
      ]),
    });
  }
  const foreignKeys = Object.keys(value).filter(
    (key) => !specializationKeys.includes(key as (typeof specializationKeys)[number]),
  );
  if (foreignKeys.length > 0) {
    return Object.freeze({
      findings: Object.freeze([
        finding(
          `Directive specialization may not redefine baseline fields; forbidden keys: ${foreignKeys.join(", ")}.`,
        ),
      ]),
    });
  }
  if (value["role"] !== "atlas-guide") {
    return Object.freeze({
      findings: Object.freeze([
        finding(
          "Directive specialization must target the SDK baseline role atlas-guide.",
        ),
      ]),
    });
  }
  const additionalConstraints = asNonBlankStrings(value["additionalConstraints"]);
  const additionalHandoffs = asNonBlankStrings(value["additionalHandoffs"]);
  const specialization: AtlasDirectiveSpecialization = Object.freeze({
    ...(additionalConstraints === undefined ? {} : { additionalConstraints }),
    ...(additionalHandoffs === undefined ? {} : { additionalHandoffs }),
    role: "atlas-guide",
  });
  return Object.freeze({ findings: Object.freeze([]), specialization });
}

export function composeDirective(
  baseline: AgentDirective,
  specialization?: AtlasDirectiveSpecialization,
): AgentDirective {
  if (specialization === undefined) {
    return baseline;
  }
  return Object.freeze({
    ...baseline,
    constraints: Object.freeze([
      ...baseline.constraints,
      ...(specialization.additionalConstraints ?? []),
    ]),
    requiredHandoffs: Object.freeze([
      ...baseline.requiredHandoffs,
      ...(specialization.additionalHandoffs ?? []),
    ]),
  });
}

export function validateDirectiveComposition(
  baseline: AgentDirective,
  specialization?: AtlasDirectiveSpecialization,
): readonly Finding[] {
  if (specialization === undefined) {
    return Object.freeze([]);
  }
  const findings: Finding[] = [];
  for (const field of [
    ...(specialization.additionalConstraints ?? []),
    ...(specialization.additionalHandoffs ?? []),
  ]) {
    if (field.trim() === "") {
      findings.push(
        finding("Directive specialization additions must be non-blank strings."),
      );
      break;
    }
  }
  return Object.freeze(findings);
}
