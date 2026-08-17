import {
  FormatRegistry,
  Kind,
  Type,
  TypeRegistry,
  type Static,
} from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const nonBlank = ".*\\S.*";
const dateTimePattern =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?:Z|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u;

FormatRegistry.Set("date-time", (value) => {
  const groups = dateTimePattern.exec(value)?.groups;
  if (groups === undefined) {
    return false;
  }
  const year = Number(groups["year"]);
  const month = Number(groups["month"]);
  const day = Number(groups["day"]);
  const hour = Number(groups["hour"]);
  const minute = Number(groups["minute"]);
  const second = Number(groups["second"]);
  const offsetHour = Number(groups["offsetHour"] ?? 0);
  const offsetMinute = Number(groups["offsetMinute"] ?? 0);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
});

const ActorSchema = Type.Object(
  {
    kind: Type.Readonly(Type.Union([Type.Literal("agent"), Type.Literal("human")])),
    name: Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
  },
  { additionalProperties: false },
);

const AtlasPageMetadataSchema = Type.Object(
  {
    "atlas-schema": Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
    "created-at": Type.Readonly(Type.String({ format: "date-time" })),
    "created-by": Type.Readonly(ActorSchema),
    id: Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
    "originating-operation": Type.Readonly(
      Type.Optional(Type.String({ minLength: 1, pattern: nonBlank })),
    ),
    "realm-schema": Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
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

const jsonObjectKind = "AtlasJsonObject";
const JsonValueSchema = Type.Recursive((value) =>
  Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Unsafe<readonly ReadonlyJsonValue[]>(Type.Array(value)),
    Type.Unsafe<Readonly<Record<string, ReadonlyJsonValue>>>({
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
    atlas: Type.Readonly(AtlasPageMetadataSchema),
    body: Type.Readonly(Type.String()),
    realm: Type.Readonly(
      Type.Unsafe<Readonly<Record<string, ReadonlyJsonValue>>>(
        Type.Record(Type.String(), JsonValueSchema),
      ),
    ),
  },
  {
    $id: "https://atlas.dev/schema/realm-page-envelope.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

export type RealmPageEnvelope = Static<typeof RealmPageEnvelopeSchema>;
