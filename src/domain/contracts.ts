export const CORE_SCHEMA_VERSION = "1.0.0";
export const FINDING_SCHEMA = "atlas.finding/v1";
export const OPERATION_RESULT_SCHEMA = "atlas.operation-result/v1";
export const OPERATION_HANDOFF_SCHEMA = "atlas.operation-handoff/v1";
export const REALM_MANIFEST_SCHEMA = "atlas.realm-manifest/v1";
export const REALM_LAWS_SCHEMA = "atlas.realm-laws/v1";
export const MAX_REALM_FILE_BYTES = 1024 * 1024;
export const MAX_REALM_FILES = 4096;
export const MAX_REALM_TOTAL_BYTES = 16 * 1024 * 1024;

export const CORE_ARCHETYPES = [
  "lore",
  "insight",
  "pillar",
  "bonfire",
  "thread",
] as const;

export type CoreArchetype = (typeof CORE_ARCHETYPES)[number];
export type FindingSeverity =
  "error" | "warning" | "suggestion" | "inconclusive" | "skipped";

export interface SourceLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly lineBase: 1;
  readonly columnBase: 1;
  readonly columnEncoding: "unicode-code-point";
}

export interface Finding {
  readonly schema: typeof FINDING_SCHEMA;
  readonly check: {
    readonly id: string;
    readonly origin: "trusted-atlas";
  };
  readonly severity: FindingSeverity;
  readonly code: string;
  readonly message: string;
  readonly location: SourceLocation;
  readonly remediation: string;
}

export interface Actor {
  readonly kind: "human" | "agent" | "system";
  readonly name: string;
}

export interface AuditStamp {
  readonly at: string;
  readonly by: Actor;
}

export interface AtlasEnvelope {
  readonly id: string;
  readonly type: CoreArchetype;
  readonly schema: typeof CORE_SCHEMA_VERSION;
  readonly realmSchema: string;
  readonly title: string;
  readonly created: AuditStamp;
  readonly updated: AuditStamp;
  readonly tags: readonly string[];
  readonly "originating-operation"?: string;
}

export interface RealmManifest {
  readonly schema: typeof REALM_MANIFEST_SCHEMA;
  readonly realm: {
    readonly id: string;
    readonly title: string;
  };
  readonly atlasSchema: typeof CORE_SCHEMA_VERSION;
  readonly realmSchema: string;
}

export interface OperationHandoff {
  readonly schema: typeof OPERATION_HANDOFF_SCHEMA;
  readonly operationId: string;
  readonly operation: "weave";
  readonly homeRealm: {
    readonly id: string | null;
    readonly title: string | null;
  };
  readonly baseSnapshot: {
    readonly kind: "realm-content";
    readonly digest: string;
  };
  readonly summary: string;
  readonly unresolvedDecisions: readonly string[];
  readonly validation: {
    readonly state: "valid" | "blocked" | "failed";
    readonly errors: number;
    readonly warnings: number;
  };
  readonly reviewLink: null;
  readonly recommendedNextAction: string;
}

interface OperationResultBase {
  readonly schema: typeof OPERATION_RESULT_SCHEMA;
  readonly operation: "weave";
  readonly operationId: string;
  readonly findings: readonly Finding[];
  readonly handoff: OperationHandoff;
}

export interface CompletedOperationResult extends OperationResultBase {
  readonly status: "completed";
  readonly output: {
    readonly realm: {
      readonly id: string;
      readonly title: string;
      readonly atlasSchema: string;
      readonly realmSchema: string;
      readonly digest: string;
    };
    readonly serialization: {
      readonly files: number;
      readonly bytes: number;
      readonly digest: string;
    };
  };
}

export interface BlockedOperationResult extends OperationResultBase {
  readonly status: "blocked";
}

export interface FailedOperationResult extends OperationResultBase {
  readonly status: "failed";
  readonly failure: {
    readonly code: string;
    readonly message: string;
  };
}

export type OperationResult =
  CompletedOperationResult | BlockedOperationResult | FailedOperationResult;

const STRING_SCHEMA = Object.freeze({ type: "string" });
const NONEMPTY_STRING_SCHEMA = Object.freeze({ type: "string", minLength: 1 });
const AUDIT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["at", "by"]),
  properties: Object.freeze({
    at: Object.freeze({ type: "string", format: "date-time" }),
    by: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["kind", "name"]),
      properties: Object.freeze({
        kind: Object.freeze({ enum: Object.freeze(["human", "agent", "system"]) }),
        name: NONEMPTY_STRING_SCHEMA,
      }),
    }),
  }),
});
const HUMAN_AUDIT_SCHEMA = Object.freeze({
  ...AUDIT_SCHEMA,
  properties: Object.freeze({
    ...AUDIT_SCHEMA.properties,
    by: Object.freeze({
      ...AUDIT_SCHEMA.properties.by,
      properties: Object.freeze({
        ...AUDIT_SCHEMA.properties.by.properties,
        kind: Object.freeze({ const: "human" }),
      }),
    }),
  }),
});
const FINDING_JSON_SCHEMA = Object.freeze({
  $id: FINDING_SCHEMA,
  type: "object",
  additionalProperties: false,
  required: Object.freeze([
    "schema",
    "check",
    "severity",
    "code",
    "message",
    "location",
    "remediation",
  ]),
  properties: Object.freeze({
    schema: Object.freeze({ const: FINDING_SCHEMA }),
    check: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["id", "origin"]),
      properties: Object.freeze({
        id: NONEMPTY_STRING_SCHEMA,
        origin: Object.freeze({ const: "trusted-atlas" }),
      }),
    }),
    severity: Object.freeze({
      enum: Object.freeze([
        "error",
        "warning",
        "suggestion",
        "inconclusive",
        "skipped",
      ]),
    }),
    code: NONEMPTY_STRING_SCHEMA,
    message: NONEMPTY_STRING_SCHEMA,
    location: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze([
        "path",
        "line",
        "column",
        "lineBase",
        "columnBase",
        "columnEncoding",
      ]),
      properties: Object.freeze({
        path: NONEMPTY_STRING_SCHEMA,
        line: Object.freeze({
          type: "integer",
          minimum: 1,
          description: "One-based source line.",
        }),
        column: Object.freeze({
          type: "integer",
          minimum: 1,
          description: "One-based Unicode code-point column.",
        }),
        lineBase: Object.freeze({ const: 1 }),
        columnBase: Object.freeze({ const: 1 }),
        columnEncoding: Object.freeze({ const: "unicode-code-point" }),
      }),
    }),
    remediation: NONEMPTY_STRING_SCHEMA,
  }),
});
const HANDOFF_JSON_SCHEMA = Object.freeze({
  $id: OPERATION_HANDOFF_SCHEMA,
  type: "object",
  additionalProperties: false,
  required: Object.freeze([
    "schema",
    "operationId",
    "operation",
    "homeRealm",
    "baseSnapshot",
    "summary",
    "unresolvedDecisions",
    "validation",
    "reviewLink",
    "recommendedNextAction",
  ]),
  properties: Object.freeze({
    schema: Object.freeze({ const: OPERATION_HANDOFF_SCHEMA }),
    operationId: NONEMPTY_STRING_SCHEMA,
    operation: Object.freeze({ const: "weave" }),
    homeRealm: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["id", "title"]),
      properties: Object.freeze({
        id: Object.freeze({ type: Object.freeze(["string", "null"]) }),
        title: Object.freeze({ type: Object.freeze(["string", "null"]) }),
      }),
    }),
    baseSnapshot: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["kind", "digest"]),
      properties: Object.freeze({
        kind: Object.freeze({ const: "realm-content" }),
        digest: NONEMPTY_STRING_SCHEMA,
      }),
    }),
    summary: NONEMPTY_STRING_SCHEMA,
    unresolvedDecisions: Object.freeze({ type: "array", items: STRING_SCHEMA }),
    validation: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["state", "errors", "warnings"]),
      properties: Object.freeze({
        state: Object.freeze({ enum: Object.freeze(["valid", "blocked", "failed"]) }),
        errors: Object.freeze({ type: "integer", minimum: 0 }),
        warnings: Object.freeze({ type: "integer", minimum: 0 }),
      }),
    }),
    reviewLink: Object.freeze({ const: null }),
    recommendedNextAction: NONEMPTY_STRING_SCHEMA,
  }),
});
const FINDING_EMBEDDED_SCHEMA = Object.freeze({
  type: FINDING_JSON_SCHEMA.type,
  additionalProperties: FINDING_JSON_SCHEMA.additionalProperties,
  required: FINDING_JSON_SCHEMA.required,
  properties: FINDING_JSON_SCHEMA.properties,
});
const HANDOFF_EMBEDDED_SCHEMA = Object.freeze({
  type: HANDOFF_JSON_SCHEMA.type,
  additionalProperties: HANDOFF_JSON_SCHEMA.additionalProperties,
  required: HANDOFF_JSON_SCHEMA.required,
  properties: HANDOFF_JSON_SCHEMA.properties,
});
const RESULT_BASE_PROPERTIES = Object.freeze({
  schema: Object.freeze({ const: OPERATION_RESULT_SCHEMA }),
  operation: Object.freeze({ const: "weave" }),
  operationId: NONEMPTY_STRING_SCHEMA,
  findings: Object.freeze({
    type: "array",
    items: Object.freeze({ $ref: "#/$defs/finding" }),
  }),
  handoff: Object.freeze({ $ref: "#/$defs/handoff" }),
});

export const PUBLIC_SCHEMAS = Object.freeze({
  finding: FINDING_JSON_SCHEMA,
  manifest: Object.freeze({
    $id: REALM_MANIFEST_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: Object.freeze(["schema", "realm", "atlas-schema", "realm-schema"]),
    properties: Object.freeze({
      schema: Object.freeze({ const: REALM_MANIFEST_SCHEMA }),
      realm: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["id", "title"]),
        properties: Object.freeze({
          id: NONEMPTY_STRING_SCHEMA,
          title: NONEMPTY_STRING_SCHEMA,
        }),
      }),
      "atlas-schema": Object.freeze({ const: CORE_SCHEMA_VERSION }),
      "realm-schema": NONEMPTY_STRING_SCHEMA,
    }),
  }),
  laws: Object.freeze({
    $id: REALM_LAWS_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: Object.freeze([
      "schema",
      "atlas-schema",
      "realm-schema",
      "laws",
      "approved",
    ]),
    properties: Object.freeze({
      schema: Object.freeze({ const: REALM_LAWS_SCHEMA }),
      "atlas-schema": Object.freeze({ const: CORE_SCHEMA_VERSION }),
      "realm-schema": NONEMPTY_STRING_SCHEMA,
      laws: Object.freeze({ type: "array", items: Object.freeze({ type: "object" }) }),
      approved: HUMAN_AUDIT_SCHEMA,
    }),
  }),
  page: Object.freeze({
    $id: "atlas.realm-page/v1",
    type: "object",
    additionalProperties: false,
    required: Object.freeze(["atlas", "realm", "body"]),
    properties: Object.freeze({
      atlas: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze([
          "id",
          "type",
          "schema",
          "realm-schema",
          "title",
          "created",
          "updated",
          "tags",
        ]),
        properties: Object.freeze({
          id: NONEMPTY_STRING_SCHEMA,
          type: Object.freeze({ enum: Object.freeze([...CORE_ARCHETYPES]) }),
          schema: Object.freeze({ const: CORE_SCHEMA_VERSION }),
          "realm-schema": NONEMPTY_STRING_SCHEMA,
          title: NONEMPTY_STRING_SCHEMA,
          created: AUDIT_SCHEMA,
          updated: AUDIT_SCHEMA,
          tags: Object.freeze({ type: "array", items: STRING_SCHEMA }),
          "originating-operation": NONEMPTY_STRING_SCHEMA,
        }),
      }),
      realm: Object.freeze({ type: "object" }),
      body: STRING_SCHEMA,
    }),
    allOf: Object.freeze([
      Object.freeze({
        if: Object.freeze({
          type: "object",
          properties: Object.freeze({
            atlas: Object.freeze({
              type: "object",
              properties: Object.freeze({
                type: Object.freeze({ const: "bonfire" }),
              }),
            }),
          }),
        }),
        then: Object.freeze({
          type: "object",
          properties: Object.freeze({
            realm: Object.freeze({
              type: "object",
              required: Object.freeze(["root", "catalog"]),
              properties: Object.freeze({
                root: Object.freeze({ type: "boolean" }),
                catalog: Object.freeze({
                  type: "array",
                  items: NONEMPTY_STRING_SCHEMA,
                }),
              }),
            }),
          }),
        }),
      }),
      Object.freeze({
        if: Object.freeze({
          type: "object",
          properties: Object.freeze({
            atlas: Object.freeze({
              type: "object",
              properties: Object.freeze({
                type: Object.freeze({ const: "insight" }),
              }),
            }),
          }),
        }),
        then: Object.freeze({
          type: "object",
          properties: Object.freeze({
            realm: Object.freeze({
              type: "object",
              required: Object.freeze(["heresy"]),
              properties: Object.freeze({
                heresy: Object.freeze({ type: "boolean" }),
              }),
            }),
          }),
        }),
      }),
      Object.freeze({
        if: Object.freeze({
          type: "object",
          properties: Object.freeze({
            atlas: Object.freeze({
              type: "object",
              properties: Object.freeze({
                type: Object.freeze({ const: "lore" }),
              }),
            }),
          }),
        }),
        then: Object.freeze({
          type: "object",
          properties: Object.freeze({
            realm: Object.freeze({
              type: "object",
              required: Object.freeze([
                "source",
                "authority",
                "gathered-at",
                "refresh-after",
              ]),
              properties: Object.freeze({
                source: Object.freeze({
                  type: "object",
                  required: Object.freeze(["kind"]),
                  properties: Object.freeze({
                    kind: NONEMPTY_STRING_SCHEMA,
                  }),
                }),
                authority: NONEMPTY_STRING_SCHEMA,
                "gathered-at": Object.freeze({ type: "string", format: "date-time" }),
                "refresh-after": Object.freeze({
                  type: "string",
                  format: "date-time",
                }),
              }),
            }),
          }),
        }),
      }),
      Object.freeze({
        if: Object.freeze({
          type: "object",
          properties: Object.freeze({
            atlas: Object.freeze({
              type: "object",
              properties: Object.freeze({
                type: Object.freeze({ const: "pillar" }),
              }),
            }),
          }),
        }),
        then: Object.freeze({
          type: "object",
          properties: Object.freeze({
            realm: Object.freeze({
              type: "object",
              required: Object.freeze(["approved"]),
              properties: Object.freeze({
                approved: Object.freeze({ type: "boolean" }),
              }),
            }),
          }),
        }),
      }),
      Object.freeze({
        if: Object.freeze({
          type: "object",
          properties: Object.freeze({
            atlas: Object.freeze({
              type: "object",
              properties: Object.freeze({
                type: Object.freeze({ const: "thread" }),
              }),
            }),
          }),
        }),
        then: Object.freeze({
          type: "object",
          properties: Object.freeze({
            realm: Object.freeze({
              type: "object",
              required: Object.freeze(["endpoints", "relationships"]),
              properties: Object.freeze({
                endpoints: Object.freeze({
                  type: "array",
                  minItems: 2,
                  maxItems: 2,
                  uniqueItems: true,
                  items: NONEMPTY_STRING_SCHEMA,
                }),
                relationships: Object.freeze({
                  type: "array",
                  minItems: 1,
                  items: NONEMPTY_STRING_SCHEMA,
                }),
              }),
            }),
          }),
        }),
      }),
    ]),
  }),
  operationHandoff: HANDOFF_JSON_SCHEMA,
  operationResult: Object.freeze({
    $id: OPERATION_RESULT_SCHEMA,
    $defs: Object.freeze({
      finding: FINDING_EMBEDDED_SCHEMA,
      handoff: HANDOFF_EMBEDDED_SCHEMA,
    }),
    oneOf: Object.freeze([
      Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze([
          "schema",
          "status",
          "operation",
          "operationId",
          "findings",
          "handoff",
          "output",
        ]),
        properties: Object.freeze({
          ...RESULT_BASE_PROPERTIES,
          status: Object.freeze({ const: "completed" }),
          output: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: Object.freeze(["realm", "serialization"]),
            properties: Object.freeze({
              realm: Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze([
                  "id",
                  "title",
                  "atlasSchema",
                  "realmSchema",
                  "digest",
                ]),
                properties: Object.freeze({
                  id: NONEMPTY_STRING_SCHEMA,
                  title: NONEMPTY_STRING_SCHEMA,
                  atlasSchema: NONEMPTY_STRING_SCHEMA,
                  realmSchema: NONEMPTY_STRING_SCHEMA,
                  digest: NONEMPTY_STRING_SCHEMA,
                }),
              }),
              serialization: Object.freeze({
                type: "object",
                additionalProperties: false,
                required: Object.freeze(["files", "bytes", "digest"]),
                properties: Object.freeze({
                  files: Object.freeze({ type: "integer", minimum: 0 }),
                  bytes: Object.freeze({ type: "integer", minimum: 0 }),
                  digest: NONEMPTY_STRING_SCHEMA,
                }),
              }),
            }),
          }),
        }),
      }),
      Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze([
          "schema",
          "status",
          "operation",
          "operationId",
          "findings",
          "handoff",
        ]),
        properties: Object.freeze({
          ...RESULT_BASE_PROPERTIES,
          status: Object.freeze({ const: "blocked" }),
        }),
      }),
      Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze([
          "schema",
          "status",
          "operation",
          "operationId",
          "findings",
          "handoff",
          "failure",
        ]),
        properties: Object.freeze({
          ...RESULT_BASE_PROPERTIES,
          status: Object.freeze({ const: "failed" }),
          failure: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: Object.freeze(["code", "message"]),
            properties: Object.freeze({
              code: NONEMPTY_STRING_SCHEMA,
              message: NONEMPTY_STRING_SCHEMA,
            }),
          }),
        }),
      }),
    ]),
  }),
});

export function compareText(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) as number);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) as number);
  const commonLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

export function compareFindings(left: Finding, right: Finding): number {
  return (
    compareText(left.location.path, right.location.path) ||
    left.location.line - right.location.line ||
    left.location.column - right.location.column ||
    compareText(left.code, right.code) ||
    compareText(left.check.id, right.check.id) ||
    compareText(left.severity, right.severity) ||
    compareText(left.message, right.message) ||
    compareText(left.remediation, right.remediation) ||
    compareText(left.schema, right.schema) ||
    compareText(left.check.origin, right.check.origin) ||
    left.location.lineBase - right.location.lineBase ||
    left.location.columnBase - right.location.columnBase ||
    compareText(left.location.columnEncoding, right.location.columnEncoding)
  );
}
