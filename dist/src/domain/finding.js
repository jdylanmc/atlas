import { Type } from "@sinclair/typebox";
import Ajv2020Module from "ajv/dist/2020.js";
const SourcePositionSchema = Type.Object({
    column: Type.Readonly(Type.Integer({ minimum: 1 })),
    line: Type.Readonly(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });
const SourceRangeSchema = Type.Object({
    end: Type.Readonly(SourcePositionSchema),
    start: Type.Readonly(SourcePositionSchema),
}, { additionalProperties: false });
const FindingAttributionSchema = Type.Union([
    Type.Object({
        checkId: Type.Readonly(Type.String({ minLength: 1, pattern: ".*\\S.*" })),
        kind: Type.Readonly(Type.Literal("sdk-core")),
        trusted: Type.Readonly(Type.Literal(true)),
    }, { additionalProperties: false }),
    Type.Object({
        checkId: Type.Readonly(Type.String({ minLength: 1, pattern: ".*\\S.*" })),
        kind: Type.Readonly(Type.Literal("atlas-owned")),
        trusted: Type.Readonly(Type.Literal(false)),
    }, { additionalProperties: false }),
]);
export const FindingSchema = Type.Object({
    attribution: Type.Readonly(FindingAttributionSchema),
    code: Type.Readonly(Type.String({ minLength: 1, pattern: "^[A-Z][A-Z0-9_]*$" })),
    "finding-schema": Type.Readonly(Type.Literal("1.0.0")),
    location: Type.Readonly(Type.Optional(SourceRangeSchema)),
    message: Type.Readonly(Type.String({ minLength: 1 })),
    path: Type.Readonly(Type.String({ minLength: 1 })),
    severity: Type.Readonly(Type.Union([
        Type.Literal("error"),
        Type.Literal("warning"),
        Type.Literal("suggestion"),
        Type.Literal("inconclusive"),
        Type.Literal("skipped"),
    ])),
}, {
    $id: "https://atlas.dev/schema/finding.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
});
const Ajv2020 = Ajv2020Module.default;
const validateFinding = new Ajv2020({ strict: true }).compile(FindingSchema);
export function checkFinding(value) {
    return validateFinding(value);
}
