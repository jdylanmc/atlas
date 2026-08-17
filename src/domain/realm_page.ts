import { Type, type Static } from "@sinclair/typebox";

const nonBlank = ".*\\S.*";

export const RealmPageEnvelopeSchema = Type.Object(
  {
    body: Type.String(),
    id: Type.String({ minLength: 1, pattern: nonBlank }),
    schema: Type.String({ minLength: 1, pattern: nonBlank }),
    title: Type.String({ minLength: 1, pattern: nonBlank }),
    type: Type.String({ minLength: 1, pattern: nonBlank }),
  },
  {
    $id: "https://atlas.dev/schema/realm-page-envelope.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: Type.Unknown(),
  },
);

export type RealmPageEnvelope = Static<typeof RealmPageEnvelopeSchema> &
  Readonly<Record<string, unknown>>;
