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
export function positionIndex(content: string): PositionIndex {
  const lineStarts = [0];
  for (
    let index = content.indexOf("\n");
    index >= 0;
    index = content.indexOf("\n", index + 1)
  ) {
    lineStarts.push(index + 1);
  }

  function positionAt(offset: number): FindingLocation["start"] {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((lineStarts[middle] as number) <= offset) low = middle;
      else high = middle - 1;
    }
    return { column: offset - (lineStarts[low] as number) + 1, line: low + 1 };
  }

  return {
    rangeAt: (start, end) => ({ end: positionAt(end), start: positionAt(start) }),
  };
}
