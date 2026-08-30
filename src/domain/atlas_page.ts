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

export const AtlasDateTimeSchema = Type.String({ format: "date-time" });

// A newer Atlas SDK may add an SDK-owned field an older one predates. ADR-0002
// requires the older SDK to map what it recognizes and continue rather than
// refuse the whole page, so this block accepts an unrecognized key instead of
// rejecting it. Every recognized key below still gets its declared shape
// checked; only a key outside this set skips validation. Lint reports an
// unrecognized key as a Finding, so it is surfaced rather than passed over in
// silence, and the serializer reproduces it byte for byte because
// canonicalization walks every own key a parsed page holds rather than this
// schema's fixed list.
const SdkPageMetadataSchema = Type.Object(
  {
    "atlas-sdk-schema": Type.Readonly(Type.String({ minLength: 1, pattern: nonBlank })),
    "created-at": Type.Readonly(AtlasDateTimeSchema),
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
    "updated-at": Type.Readonly(AtlasDateTimeSchema),
    "updated-by": Type.Readonly(ActorSchema),
  },
  { additionalProperties: true },
);

// The one recognized-key set the SDK-owned block schema declares, so Lint can
// tell a field this SDK does not recognize from one it does without restating
// the field list a second time.
export const sdkPageMetadataKeys: ReadonlySet<string> = Object.freeze(
  new Set(Object.keys(SdkPageMetadataSchema.properties)),
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
const validateAtlasDateTime = ajv.compile(AtlasDateTimeSchema);

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

export function checkAtlasDateTime(value: unknown): value is string {
  return typeof value === "string" && validateAtlasDateTime(value);
}

// A date-time must be comparable, not merely well-formed. RFC 3339 admits leap
// seconds such as 1990-12-31T23:59:60Z, which the schema accepts but Date.parse
// does not represent, and the schema's date-time format rejects date-only strings.
// Returning the raw parse would hand NaN to any freshness, ordering, or audit
// comparison, where every comparison is false and the check passes silently.
// Anything that does not parse to a finite instant is refused here so callers
// fail closed. This is the one shared rule; operations consume it rather than
// restating it.
export function dateTimeMilliseconds(value: string): number | undefined {
  if (!checkAtlasDateTime(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function checkAtlasPageEnvelope(value: unknown): value is AtlasPageEnvelope {
  return isJsonCompatible(value) && validateAtlasPageEnvelope(value);
}
