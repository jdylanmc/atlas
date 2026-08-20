import { Type, type Static } from "@sinclair/typebox";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const nonBlank = ".*\\S.*";

const ActorSchema = Type.Object(
  {
    kind: Type.Readonly(Type.Union([Type.Literal("agent"), Type.Literal("human")])),
    name: Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
  },
  { additionalProperties: false },
);

const SdkPageMetadataSchema = Type.Object(
  {
    "atlas-sdk-schema": Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
    "created-at": Type.Readonly(Type.String({ format: "date-time" })),
    "created-by": Type.Readonly(ActorSchema),
    id: Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
    "originating-operation": Type.Readonly(
      Type.Optional(Type.String({ minLength: 1, pattern: nonBlank })),
    ),
    "local-atlas-schema": Type.Readonly(
      Type.String({ minLength: 1, pattern: nonBlank }),
    ),
    tags: Type.Readonly(
      Type.Unsafe<readonly string[]>(
        Type.Array(Type.String({ minLength: 1, pattern: nonBlank })),
      ),
    ),
    title: Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
    type: Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
    "updated-at": Type.Readonly(Type.String({ format: "date-time" })),
    "updated-by": Type.Readonly(ActorSchema),
  },
  { additionalProperties: false },
);

export type ReadonlyJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ReadonlyJsonValue[]
  | { readonly [key: string]: ReadonlyJsonValue };

const JsonValueSchema = Type.Recursive((value) =>
  Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Unsafe<readonly ReadonlyJsonValue[]>(Type.Array(value)),
    Type.Unsafe<Readonly<Record<string, ReadonlyJsonValue>>>(
      Type.Record(Type.String(), value),
    ),
  ]),
);

export const AtlasPageEnvelopeSchema = Type.Object(
  {
    sdk: Type.Readonly(SdkPageMetadataSchema),
    body: Type.Readonly(Type.String()),
    atlas: Type.Readonly(
      Type.Unsafe<Readonly<Record<string, ReadonlyJsonValue>>>(
        Type.Record(Type.String(), JsonValueSchema),
      ),
    ),
  },
  {
    $id: "https://atlas.dev/schema/atlas-page-envelope.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

export type AtlasPageEnvelope = Static<typeof AtlasPageEnvelopeSchema>;

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validateAtlasPageEnvelope = ajv.compile(AtlasPageEnvelopeSchema);

function isJsonCompatible(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonCompatible);
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isJsonCompatible);
}

export function checkAtlasPageEnvelope(value: unknown): value is AtlasPageEnvelope {
  return isJsonCompatible(value) && validateAtlasPageEnvelope(value);
}
