import type { Finding } from "../src/domain/finding.ts";
import type { AtlasTextFile } from "../src/atlas/load_atlas_text.ts";
import { validateAtlasStructure } from "../src/lint/validate_atlas_structure.ts";

declare const finding: Finding;
// @ts-expect-error Finding fields are readonly.
finding.message = "changed";
// @ts-expect-error Nested source positions are readonly.
finding.location?.start.line = 2;
const findingHasNoStatus: "status" extends keyof Finding ? false : true = true;
void findingHasNoStatus;

declare const files: readonly AtlasTextFile[];
// @ts-expect-error Parsed results cannot bypass parsing of captured text.
validateAtlasStructure(files, []);
