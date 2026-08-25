// The Atlas Changelog is the curated, human-readable governance audit trail kept
// at `.atlas/CHANGELOG.md` (CONTEXT.md:105). One entry records one merged
// knowledge-changing operation and is identified by its stable operation ID.
//
// This is the single home for rendering and recognizing a Changelog entry, so
// operations that append to the Changelog share one skeleton instead of each
// restating it and drifting. An entry is a single dated heading and a single
// operation bullet by construction: a Changelog entry body is one line, so any
// multi-line prose that would forge extra headings or bullets — and thus forge
// provenance and operation IDs — is not rendered into an entry here.
//
// The recognizer below checks what this module renders. It is not a structural
// contract on the archetype: CONTEXT.md:105 defines the Atlas Changelog
// without fixing an entry's shape.

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

/** Render one Changelog entry block: a single dated heading and a single
 * operation bullet. `prose` is placed mid-line after the operation ID, so a
 * single-line prose does not begin a heading or bullet of its own. */
export function renderAtlasChangelogEntryBlock(
  date: string,
  operationId: string,
  prose: string,
): string {
  return `## ${date}\n\n- ${operationId}: ${prose}`;
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

/** Append one stamped entry to the existing Changelog, preserving prior history.
 * A newcomer reads the whole file top to bottom, so the newest entry is appended
 * after the existing content rather than replacing it. */
export function renderAtlasChangelog(
  existingContent: string | undefined,
  date: string,
  operationId: string,
  prose: string,
): string {
  const header = (existingContent ?? "# Changelog\n").trimEnd();
  const entry = renderAtlasChangelogEntryBlock(date, operationId, prose);
  return `${header}\n\n${entry}\n`;
}
