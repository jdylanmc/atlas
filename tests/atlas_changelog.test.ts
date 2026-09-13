import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readChangelogCorpus } from "./changelog_corpus.ts";
import {
  containsLineBreak,
  isSingleAtlasChangelogEntry,
  renderAtlasChangelog,
  renderAtlasChangelogEntryBlock,
} from "../src/domain/atlas_changelog.ts";

for (const entry of readChangelogCorpus()) {
  test(`adversarial Changelog corpus: ${entry.name}`, () => {
    assert.equal(
      renderAtlasChangelog(
        entry.existingContent,
        entry.date,
        entry.operationId,
        entry.prose,
      ),
      entry.expected,
    );
  });
}

test("SDK Atlas Changelog preserves all four original entries under unique date headings", () => {
  const content = readFileSync(
    new URL("../.atlas/CHANGELOG.md", import.meta.url),
    "utf8",
  );
  const headings: readonly string[] = content.match(/^## .+$/gmu) ?? [];
  assert.ok(headings.includes("## 2026-01-01"));
  assert.ok(headings.includes("## 2026-08-24"));
  assert.equal(new Set(headings).size, headings.length);
  for (const heading of headings) assert.match(heading, /^## \d{4}-\d{2}-\d{2}$/u);
  const original = [
    "- atlas-initialization: Initialized minimal Home Atlas.",
    "- governance-40862aed9719-a3dbf243: Established five founding Principles (unrepresentable invalid states, derivation over plausibility, validity is derived, deterministic core, adversarial-corpus resolution) under Maintainer approval.",
    "- governance-4607a848c045-8be64a05: Established the Adversarial Corpus Gate Atlas Policy under Maintainer approval.",
    "- ingest-95263495f14a-c03400f6: Ingested source:google-markdown-style-guide approved by Dylan McCurry at 2026-08-24T22:30:00Z into 5 Concept(s) with cited Source and Edges.",
  ];
  const prefixes = original.map((line) => line.slice(0, line.indexOf(": ") + 2));
  assert.deepEqual(
    content
      .split("\n")
      .filter((line) => prefixes.some((prefix) => line.startsWith(prefix))),
    original,
  );
});

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
