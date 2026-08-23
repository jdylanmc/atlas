import { type Static } from "@sinclair/typebox";
export type ReadonlyJsonValue = null | boolean | number | string | readonly ReadonlyJsonValue[] | {
    readonly [key: string]: ReadonlyJsonValue;
};
export declare const AtlasPageEnvelopeSchema: import("@sinclair/typebox").TObject<{
    sdk: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TObject<{
        "atlas-sdk-schema": import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        "created-at": import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        "created-by": import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"agent">, import("@sinclair/typebox").TLiteral<"human">]>>;
            name: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        }>>;
        id: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        "originating-operation": import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>>;
        "local-atlas-schema": import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        tags: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TUnsafe<readonly string[]>>;
        title: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        type: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        "updated-at": import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        "updated-by": import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"agent">, import("@sinclair/typebox").TLiteral<"human">]>>;
            name: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        }>>;
    }>>;
    body: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
    atlas: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TUnsafe<Readonly<Record<string, ReadonlyJsonValue>>>>;
}>;
export type AtlasPageEnvelope = Static<typeof AtlasPageEnvelopeSchema>;
export declare function checkAtlasPageEnvelope(value: unknown): value is AtlasPageEnvelope;
