import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export type AtlasQmdCorpusCase =
  | {
      readonly expectation: "repair";
      readonly gate: "atlas-qmd";
      readonly kind: "database-corruption";
      readonly name: string;
    }
  | {
      readonly expectation: "repair";
      readonly gate: "atlas-qmd";
      readonly kind: "document-map";
      readonly name: string;
      readonly value: "array" | "empty" | "incomplete" | "mismatched" | "null";
    }
  | {
      readonly expectation: "stable-absolute-destination";
      readonly gate: "atlas-qmd";
      readonly kind: "relative-runtime-root";
      readonly name: string;
    };

interface AtlasQmdCorpus {
  readonly cases: readonly AtlasQmdCorpusCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

export function readAtlasQmdCorpus(): AtlasQmdCorpus {
  const corpus = JSON.parse(
    readFileSync(new URL("./adversarial/atlas-qmd.json", import.meta.url), "utf8"),
  ) as AtlasQmdCorpus;
  assert.equal(corpus.schema, 1);
  assert.match(corpus.reviewResolutionRule, /review finding/u);
  assert.ok(corpus.cases.length > 0);
  assert.equal(new Set(corpus.cases.map(({ name }) => name)).size, corpus.cases.length);
  for (const entry of corpus.cases) {
    assert.equal(entry.gate, "atlas-qmd");
    assert.ok(entry.name.length > 0);
    if (entry.kind === "relative-runtime-root") {
      assert.equal(entry.expectation, "stable-absolute-destination");
    } else {
      assert.equal(entry.expectation, "repair");
    }
  }
  return corpus;
}
