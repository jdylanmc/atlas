import assert from "node:assert/strict";
import test from "node:test";
import {
  containsLineBreak,
  isSingleAtlasChangelogEntry,
  renderAtlasChangelog,
  renderAtlasChangelogEntryBlock,
} from "../src/domain/atlas_changelog.ts";

test("containsLineBreak recognizes every line terminator and passes single-line text", () => {
  for (const character of [
    "\n",
    "\r",
    "\u2028",
    "\u2029",
    "\u0085",
    "\u000b",
    "\u000c",
  ]) {
    assert.equal(containsLineBreak(`a${character}b`), true, JSON.stringify(character));
  }
  // Hashes and dashes mid-line are not line breaks: prose may contain them.
  assert.equal(containsLineBreak("a single line - with dashes ## and hashes"), false);
});

test("isSingleAtlasChangelogEntry accepts one heading and one bullet and rejects every other shape", () => {
  assert.equal(
    isSingleAtlasChangelogEntry(
      renderAtlasChangelogEntryBlock("2026-08-22", "governance-op-1", "Did a thing."),
    ),
    true,
  );
  // Too few non-empty lines.
  assert.equal(isSingleAtlasChangelogEntry("## 2026-08-22"), false);
  // Two headings, no bullet: the heading count is wrong.
  assert.equal(isSingleAtlasChangelogEntry("## a\n## b"), false);
  // One heading and a non-bullet line: the bullet count is wrong.
  assert.equal(isSingleAtlasChangelogEntry("## a\nplain text"), false);
  // A forged second entry with a fabricated operation ID.
  assert.equal(
    isSingleAtlasChangelogEntry("## a\n\n- op:1 x\n\n## b\n\n- op:2 y"),
    false,
  );
});

test("renderAtlasChangelog appends to existing history and falls back to a fresh header", () => {
  const fresh = renderAtlasChangelog(
    undefined,
    "2026-08-22",
    "governance-op-1",
    "First.",
  );
  assert.equal(fresh, "# Changelog\n\n## 2026-08-22\n\n- governance-op-1: First.\n");
  const appended = renderAtlasChangelog(
    "# Changelog\n\n## 2026-08-17\n\n- Base.\n",
    "2026-08-22",
    "governance-op-1",
    "Second.",
  );
  assert.match(
    appended,
    /- Base\.\n\n## 2026-08-22\n\n- governance-op-1: Second\.\n$/u,
  );
});
