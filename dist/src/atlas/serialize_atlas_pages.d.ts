import type { AtlasTextFile } from "./load_atlas_text.ts";
import type { ParsedAtlasPage } from "./parse_atlas_pages.ts";
export type AtlasPageSerializeErrorCode = "DUPLICATE_PAGE_PATH" | "INVALID_PAGE_ENVELOPE" | "UNREPRESENTABLE_VALUE";
export declare class AtlasPageSerializeError extends Error {
    readonly code: AtlasPageSerializeErrorCode;
    readonly path: string;
    constructor(code: AtlasPageSerializeErrorCode, path: string);
}
export declare function serializeAtlasPages(pages: readonly ParsedAtlasPage[]): readonly AtlasTextFile[];
