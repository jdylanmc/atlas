import type { Finding, FindingLocation } from "../domain/finding.ts";
import { sdkFindings } from "./sdk_finding.ts";

export interface CommentTruthTextFile {
  readonly content: string;
  readonly path: string;
}

const finding = sdkFindings("sdk-core.comment-truth");

/** A doc comment claim so absolute it forecloses every future counterexample. */
const absoluteClaimPattern = /\b(never|cannot|can't|always|impossible)\b/giu;

/** A backtick-quoted `tests/*.test.ts` path, the shape a doc comment names the
 * test file that pins its claim with. */
const testFileReferencePattern = /`(tests\/[\w-]+\.test\.ts)`/gu;

/** A line-comment run: one or more consecutive `//` lines. Blank lines and
 * code end a run, so an unrelated comment above unrelated code is not folded
 * into the claim below it. */
const lineCommentRunPattern = /(?:^[ \t]*\/\/[^\n]*\n?)+/gmu;

/** A JSDoc-style block comment, `/** ... *\/` in any position. */
const blockCommentPattern = /\/\*\*[\s\S]*?\*\//gu;

interface CommentBlock {
  readonly line: number;
  readonly text: string;
}

/** Every comment block in `content`, in source order. A block comment and a
 * line-comment run do not overlap, so each character is attributed to at most
 * one block and no claim is read twice. */
function commentBlocks(content: string): readonly CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const claimed: Array<readonly [number, number]> = [];
  const lineOf = (index: number): number => content.slice(0, index).split("\n").length;

  for (const match of content.matchAll(blockCommentPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    claimed.push([start, end]);
    blocks.push({ line: lineOf(start), text: match[0] });
  }
  for (const match of content.matchAll(lineCommentRunPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (
      claimed.some(
        ([claimedStart, claimedEnd]) => start < claimedEnd && end > claimedStart,
      )
    ) {
      continue;
    }
    blocks.push({ line: lineOf(start), text: match[0] });
  }
  return blocks.toSorted((left, right) => left.line - right.line);
}

/**
 * Requires every unqualified absolute claim matched by
 * `absoluteClaimPattern` in a `src/**` doc comment to name, in the same comment, a
 * real `tests/*.test.ts` file that pins it. A claim naming no such file, or
 * naming one that does not exist in `testFiles`, is reported: the comment's
 * confidence has outrun what is actually checked, which is how an
 * uncaught defect can hide behind reassuring prose.
 */
export function validateCommentTruth(
  files: readonly CommentTruthTextFile[],
  testFiles: ReadonlySet<string>,
): readonly Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    for (const block of commentBlocks(file.content)) {
      if (!absoluteClaimPattern.test(block.text)) continue;
      absoluteClaimPattern.lastIndex = 0;
      const pinned = [...block.text.matchAll(testFileReferencePattern)].some((match) =>
        testFiles.has(match[1] as string),
      );
      if (pinned) continue;
      const location: FindingLocation = {
        end: { column: 1, line: block.line + 1 },
        start: { column: 1, line: block.line },
      };
      findings.push(
        finding(
          "ATLAS_COMMENT_TRUTH_UNPINNED_ABSOLUTE_CLAIM",
          `${file.path} makes an absolute claim ("never", "cannot", "always", or "impossible") without naming, in the same comment, a real tests/*.test.ts file that pins it.`,
          file.path,
          location,
        ),
      );
    }
  }
  return Object.freeze(findings);
}
