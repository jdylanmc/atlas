// The Atlas Changelog is the curated, human-readable governance audit trail kept
// at `.atlas/CHANGELOG.md` (CONTEXT.md:105). One entry records one merged
// knowledge-changing operation and is identified by its stable operation ID.
//
// This is the single home for rendering and recognizing a Changelog entry, so
// operations that append to the Changelog share one skeleton instead of each
// restating it and drifting. An entry block has one date-only heading and one
// operation bullet; the complete Changelog groups blocks by day. An entry body
// is one line, so multi-line prose that would forge extra headings or bullets — and thus forge
// provenance and operation IDs — is not rendered into an entry here.
//
// The recognizer below checks what this module renders. It is not a structural
// contract on the archetype: CONTEXT.md:105 defines the Atlas Changelog
// without fixing an entry's shape.

import { fromMarkdown } from "mdast-util-from-markdown";
import { dateTimeMilliseconds } from "./atlas_page.ts";

export const atlasChangelogPath = ".atlas/CHANGELOG.md";

// Every character a Markdown renderer, terminal, or Git diff may treat as a line
// break, so recognition and rejection use one comprehensive definition rather
// than only `\n`. `\u2028`/`\u2029` are Unicode line/paragraph separators,
// `\u0085` is NEL, and `\u000b`/`\u000c` are vertical tab and form feed. A string
// of the break characters is used rather than a regular expression so the
// definition stays exhaustive without embedding control characters in a pattern.
const lineBreakCharacters = "\n\r\u000b\u000c\u0085\u2028\u2029";

/** True when the value contains any character that could begin a new line. */
export function containsLineBreak(value: string): boolean {
  for (const character of value) {
    if (lineBreakCharacters.includes(character)) return true;
  }
  return false;
}

// Split on every recognized line break, so recognition matches the rejection at
// the seam. `\r\n` yields an empty segment between, which callers discard by
// filtering empty lines.
function splitLines(value: string): readonly string[] {
  const lines: string[] = [];
  let current = "";
  for (const character of value) {
    if (lineBreakCharacters.includes(character)) {
      lines.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  lines.push(current);
  return lines;
}

function changelogDay(date: string): string {
  const milliseconds = dateTimeMilliseconds(date);
  return milliseconds === undefined
    ? date
    : new Date(milliseconds).toISOString().slice(0, 10);
}

/** Render one Changelog entry block: a single dated heading and a single
 * operation bullet. `prose` is placed mid-line after the operation ID, so a
 * single-line prose does not begin a heading or bullet of its own. */
export function renderAtlasChangelogEntryBlock(
  date: string,
  operationId: string,
  prose: string,
): string {
  const day = changelogDay(date);
  const metadata = day === date ? "" : ` (at: ${date})`;
  return `## ${day}\n\n- ${operationId}: ${prose}${metadata}`;
}

/** True iff the block is exactly one dated heading and one operation bullet with
 * no other non-empty lines — the shape `renderAtlasChangelogEntryBlock` must
 * produce. Multi-line prose breaks this, which is how a forged entry is caught.
 *
 * This is a self-check over bytes Atlas SDK just rendered, not a validator for
 * caller-authored or historical Changelog content. CONTEXT.md:105 defines the
 * Atlas Changelog without fixing an entry's structure, so applying this to any
 * Changelog Atlas SDK did not render would impose a contract the glossary does
 * not state. */
export function isSingleAtlasChangelogEntry(block: string): boolean {
  const nonEmpty = splitLines(block).filter((line) => line.trim() !== "");
  const headings = nonEmpty.filter((line) => line.startsWith("## "));
  const bullets = nonEmpty.filter((line) => line.startsWith("- "));
  return nonEmpty.length === 2 && headings.length === 1 && bullets.length === 1;
}

function trimLineBreaks(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && "\r\n".includes(value.charAt(start))) start += 1;
  while (end > start && "\r\n".includes(value.charAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

function markdownHeadings(content: string) {
  // Heading discovery needs block boundaries, not emphasis resolution.
  // tests/atlas_changelog.test.ts pins delimiter-dense CPU growth.
  const tree = fromMarkdown(content, {
    extensions: [{ disable: { null: ["attention"] } }],
  });
  // Parser-created nodes carry offsets; generic mdast types also allow
  // caller-assembled trees without positions. tests/atlas_changelog.test.ts
  // pins position-sensitive historical text preservation.
  const nodes = tree.children as readonly ((typeof tree.children)[number] & {
    readonly position: {
      readonly start: { readonly offset: number };
      readonly end: { readonly offset: number };
    };
  })[];
  return nodes.filter((node) => node.type === "heading");
}

function joinBlocks(blocks: readonly string[]): string {
  return blocks.filter((block) => block !== "").join("\n\n");
}

function groupChangelogDates(content: string): string {
  const headings = markdownHeadings(content).filter((node) => node.depth <= 2);
  const sections: { heading: string; body: string; subsections: string }[] = [];
  const dates = new Map<string, (typeof sections)[number]>();
  let prefix = content;
  for (const [index, heading] of headings.entries()) {
    if (index === 0) prefix = content.slice(0, heading.position.start.offset);
    const rawHeading = content.slice(
      heading.position.start.offset,
      heading.position.end.offset,
    );
    const next = headings[index + 1];
    const body = trimLineBreaks(
      content.slice(heading.position.end.offset, next?.position.start.offset),
    );
    const section = { heading: rawHeading, body, subsections: "" };
    if (heading.depth === 1) dates.clear();
    const date = rawHeading.startsWith("## ") ? rawHeading.slice(3) : "";
    const day = changelogDay(date);
    if (/^\d{4}-\d{2}-\d{2}$/u.test(day)) {
      section.heading = `## ${day}`;
      const subsections =
        markdownHeadings(body)[0]?.position.start.offset ?? body.length;
      section.body = trimLineBreaks(body.slice(0, subsections));
      section.subsections = trimLineBreaks(body.slice(subsections));
      if (day !== date) {
        section.body = joinBlocks([`Recorded at: ${date}`, section.body]);
      }
      const existing = dates.get(day);
      if (existing !== undefined) {
        existing.body = joinBlocks([existing.body, section.body]);
        existing.subsections = joinBlocks([existing.subsections, section.subsections]);
        continue;
      }
      dates.set(day, section);
    }
    sections.push(section);
  }
  return (
    joinBlocks([
      trimLineBreaks(prefix),
      ...sections.map(({ heading, body, subsections }) =>
        joinBlocks([heading, body, subsections]),
      ),
    ]) + "\n"
  );
}

/** Append an entry within its UTC day, preserving first-seen day order and
 * historical text. Only plain date/date-time headings are normalized. */
export function renderAtlasChangelog(
  existingContent: string | undefined,
  date: string,
  operationId: string,
  prose: string,
): string {
  const header = trimLineBreaks(existingContent ?? "# Changelog\n");
  const entry = renderAtlasChangelogEntryBlock(date, operationId, prose);
  return groupChangelogDates(`${header}\n\n${entry}\n`);
}
