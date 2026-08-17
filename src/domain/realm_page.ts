import { Kind, Type, TypeRegistry, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const nonBlank = ".*\\S.*";
const isoTimestamp =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$";

const ActorSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("agent"), Type.Literal("human")]),
    name: Type.String({ minLength: 1, pattern: nonBlank }),
  },
  { additionalProperties: false },
);

const AtlasPageMetadataSchema = Type.Object(
  {
    "atlas-schema": Type.String({ minLength: 1, pattern: nonBlank }),
    "created-at": Type.String({ pattern: isoTimestamp }),
    "created-by": ActorSchema,
    id: Type.String({ minLength: 1, pattern: nonBlank }),
    "originating-operation": Type.Optional(
      Type.String({ minLength: 1, pattern: nonBlank }),
    ),
    "realm-schema": Type.String({ minLength: 1, pattern: nonBlank }),
    tags: Type.Array(Type.String({ minLength: 1, pattern: nonBlank })),
    title: Type.String({ minLength: 1, pattern: nonBlank }),
    type: Type.String({ minLength: 1, pattern: nonBlank }),
    "updated-at": Type.String({ pattern: isoTimestamp }),
    "updated-by": ActorSchema,
  },
  { additionalProperties: false },
);

const jsonObjectKind = "AtlasJsonObject";

const JsonValueSchema = Type.Recursive((value) =>
  Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Array(value),
    Type.Unsafe<Record<string, Static<typeof value>>>({
      [Kind]: jsonObjectKind,
      additionalProperties: value,
      type: "object",
    }),
  ]),
);

if (!TypeRegistry.Has(jsonObjectKind)) {
  TypeRegistry.Set(jsonObjectKind, (_schema, value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return false;
    }
    return Object.values(value as Record<string, unknown>).every((entry) =>
      Value.Check(JsonValueSchema, entry),
    );
  });
}

export const RealmPageEnvelopeSchema = Type.Object(
  {
    atlas: AtlasPageMetadataSchema,
    body: Type.String(),
    realm: Type.Record(Type.String(), JsonValueSchema),
  },
  {
    $id: "https://atlas.dev/schema/realm-page-envelope.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type RealmPageEnvelope = DeepReadonly<Static<typeof RealmPageEnvelopeSchema>>;
