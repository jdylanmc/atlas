import { type Static } from "@sinclair/typebox";
export declare const FindingSchema: import("@sinclair/typebox").TObject<{
    attribution: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        checkId: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        kind: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TLiteral<"sdk-core">>;
        trusted: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TLiteral<true>>;
    }>, import("@sinclair/typebox").TObject<{
        checkId: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
        kind: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TLiteral<"atlas-owned">>;
        trusted: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TLiteral<false>>;
    }>]>>;
    code: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
    "finding-schema": import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TLiteral<"1.0.0">>;
    location: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        end: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TObject<{
            column: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TInteger>;
            line: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TInteger>;
        }>>;
        start: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TObject<{
            column: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TInteger>;
            line: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TInteger>;
        }>>;
    }>>>;
    message: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
    path: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TString>;
    severity: import("@sinclair/typebox").TReadonly<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"error">, import("@sinclair/typebox").TLiteral<"warning">, import("@sinclair/typebox").TLiteral<"suggestion">, import("@sinclair/typebox").TLiteral<"inconclusive">, import("@sinclair/typebox").TLiteral<"skipped">]>>;
}>;
export type Finding = Static<typeof FindingSchema>;
/** The source range a Finding points at, owned by the Finding contract. */
export type FindingLocation = NonNullable<Finding["location"]>;
export declare function checkFinding(value: unknown): value is Finding;
