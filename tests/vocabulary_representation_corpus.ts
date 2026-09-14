import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export interface VocabularyRepresentationCase {
  readonly expectation: "unbound-optional-extension";
  readonly gate: "vocabulary-representation";
  readonly name: string;
  readonly reason: string;
  readonly term: "Explore Index" | "Tool Runtime";
}

interface VocabularyRepresentationCorpus {
  readonly cases: readonly VocabularyRepresentationCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

export function readVocabularyRepresentationCorpus(): VocabularyRepresentationCorpus {
  const corpus = JSON.parse(
    readFileSync(
      new URL("./adversarial/vocabulary-representation.json", import.meta.url),
      "utf8",
    ),
  ) as VocabularyRepresentationCorpus;
  assert.equal(corpus.schema, 1);
  assert.match(corpus.reviewResolutionRule, /review finding/u);
  assert.ok(corpus.cases.length > 0);
  assert.equal(new Set(corpus.cases.map(({ name }) => name)).size, corpus.cases.length);
  for (const entry of corpus.cases) {
    assert.equal(entry.gate, "vocabulary-representation");
    assert.equal(entry.expectation, "unbound-optional-extension");
    assert.ok(["Explore Index", "Tool Runtime"].includes(entry.term));
    assert.match(entry.reason, /optional atlas-qmd extension/u);
    assert.match(entry.reason, /no single public core-domain identifier/u);
  }
  return corpus;
}
