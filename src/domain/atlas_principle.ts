// A Principle is a human-governed page of individually identified active truths
// (CONTEXT.md:159). Re-anchor, Governance, Ingest, and Lint all need the same
// answer to which truths are active, so this module owns the one renderer-facing
// recognizer instead of letting call sites drift.

export const atlasPrincipleActiveTruthsHeading = "## Active truths";

export interface AtlasPrincipleTruth {
  readonly text: string;
  readonly truthId: string;
}

export interface AtlasPrincipleMalformedTruthLine {
  readonly line: number;
}

const canonicalHeading = /^## /u;
const canonicalTruthBullet = /^- `([^`]+)` (\S.*)$/u;
const truthShapedBullet = /^[\t ]*(?:-|\d{1,9}[.)])\s*`[^`]*`(?:\s.*)?$/u;

function scanAtlasPrincipleActiveTruths(content: string): {
  readonly malformedLines: readonly AtlasPrincipleMalformedTruthLine[];
  readonly truths: readonly AtlasPrincipleTruth[];
} {
  const malformedLines: AtlasPrincipleMalformedTruthLine[] = [];
  const truths: AtlasPrincipleTruth[] = [];
  const lines = content.split(/\r?\n/u);
  let active = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (canonicalHeading.test(line))
      active = line === atlasPrincipleActiveTruthsHeading;
    const match = canonicalTruthBullet.exec(line);
    const truthShaped = truthShapedBullet.test(line);
    if (match === null) {
      if (truthShaped) malformedLines.push(Object.freeze({ line: index + 1 }));
      continue;
    }
    if (!active) {
      malformedLines.push(Object.freeze({ line: index + 1 }));
      continue;
    }
    const textParts = [match[2] as string];
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex] as string;
      if (
        nextLine === "" ||
        canonicalHeading.test(nextLine) ||
        /^- /u.test(nextLine) ||
        truthShapedBullet.test(nextLine)
      ) {
        break;
      }
      if (!/^\s+\S/u.test(nextLine)) break;
      textParts.push(nextLine.trim());
      index = nextIndex;
    }
    truths.push(
      Object.freeze({
        text: textParts.join(" "),
        truthId: match[1] as string,
      }),
    );
  }
  return Object.freeze({
    malformedLines: Object.freeze(malformedLines),
    truths: Object.freeze(truths),
  });
}

/** Extract active Principle truths from the one canonical block shape Atlas SDK
 * recognizes: an exact column-1 H2 heading and column-1 bullets shaped as a
 * dash, a stable truth ID in code formatting, and non-empty same-line text. The
 * heading is not trimmed; trailing whitespace is a different Markdown source
 * form and must be reported by Lint rather than silently normalized by one
 * reader and missed by another. */
export function extractAtlasPrincipleActiveTruths(
  content: string,
): readonly AtlasPrincipleTruth[] {
  return scanAtlasPrincipleActiveTruths(content).truths;
}

export function malformedAtlasPrincipleTruthLines(
  content: string,
): readonly AtlasPrincipleMalformedTruthLine[] {
  return scanAtlasPrincipleActiveTruths(content).malformedLines;
}

export function atlasPrincipleActiveTruthIds(content: string): readonly string[] {
  return Object.freeze(
    extractAtlasPrincipleActiveTruths(content).map((truth) => truth.truthId),
  );
}
