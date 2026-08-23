import { type AtlasPageEnvelope } from "../domain/atlas_page.ts";
import type { AtlasTextFile } from "./load_atlas_text.ts";
export type AtlasTextClassification = "page" | "opaque";
export interface SourceLines {
    readonly endLine: number;
    readonly startLine: number;
}
export interface AtlasFrontmatterSpan {
    readonly end: number;
    readonly start: number;
}
export interface AtlasPageSource {
    readonly body: SourceLines;
    readonly frontmatter: SourceLines;
    readonly path: string;
}
export interface ParsedAtlasPage {
    readonly page: AtlasPageEnvelope;
    readonly source: AtlasPageSource;
}
export type AtlasPageParseErrorCode = "FRONTMATTER_TOO_DEEP" | "FRONTMATTER_TOO_LARGE" | "INVALID_PAGE_ENVELOPE" | "MALFORMED_FRONTMATTER" | "MISSING_FRONTMATTER";
export declare class AtlasPageParseError extends Error {
    readonly code: AtlasPageParseErrorCode;
    readonly path: string;
    readonly sourceLine: number;
    constructor(code: AtlasPageParseErrorCode, path: string, sourceLine: number);
}
export declare const maxFrontmatterDepth = 64;
export declare const maxFrontmatterCharacters: number;
/**
 * Answers where the frontmatter of a captured Atlas page begins and ends, so a
 * later stage locating a value inside it reads the page the same way the parse
 * did instead of describing the delimiter a second time. "reports the same
 * frontmatter span the parse read" pins the two against each other.
 */
export declare function atlasFrontmatterSpan(content: string): AtlasFrontmatterSpan | undefined;
export declare function classifyAtlasTextPath(path: string): AtlasTextClassification;
/**
 * Reads one captured Atlas page, answering with the parse failure rather than
 * raising it, so a caller does not have to tell a failure of the page from a
 * failure of the process running the read. "a failure of the running process is
 * never answered for as a page failure" pins the difference.
 */
export declare function parseAtlasPage(file: AtlasTextFile): ParsedAtlasPage | AtlasPageParseError;
export declare function parseAtlasPages(files: readonly AtlasTextFile[]): readonly ParsedAtlasPage[];
