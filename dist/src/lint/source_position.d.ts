import type { FindingLocation } from "../domain/finding.ts";
export interface PositionIndex {
    /** The Finding location of the offset range `[start, end)`. */
    readonly rangeAt: (start: number, end: number) => FindingLocation;
}
/**
 * Indexes where each line of one text begins, so any number of Finding
 * locations resolve from it in logarithmic time. Indexing a text once and
 * reusing that index keeps a large source file linear in its own length.
 */
export declare function positionIndex(content: string): PositionIndex;
