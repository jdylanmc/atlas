import { Type, type Static } from "@sinclair/typebox";

const nonBlank = ".*\\S.*";

const AtlasPageMetadataSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, pattern: nonBlank }),
    "realm-schema": Type.String({ minLength: 1, pattern: nonBlank }),
    schema: Type.String({ minLength: 1, pattern: nonBlank }),
    title: Type.String({ minLength: 1, pattern: nonBlank }),
    type: Type.String({ minLength: 1, pattern: nonBlank }),
  },
  { additionalProperties: false },
);

export const RealmPageEnvelopeSchema = Type.Object(
  {
    atlas: AtlasPageMetadataSchema,
    body: Type.String(),
    realm: Type.Record(Type.String(), Type.Unknown()),
  },
  {
    $id: "https://atlas.dev/schema/realm-page-envelope.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type RealmPageEnvelope = Readonly<{
  atlas: Readonly<Static<typeof AtlasPageMetadataSchema>>;
  body: Static<typeof RealmPageEnvelopeSchema>["body"];
  realm: Readonly<Record<string, JsonValue>>;
}>;
