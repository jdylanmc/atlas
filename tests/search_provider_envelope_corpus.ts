import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export interface SearchProviderEnvelopeCase {
  readonly expectation: "fallback";
  readonly gate: "search-provider-envelope";
  readonly name: string;
  readonly value: "missing-candidates" | "non-array-candidates" | "null" | "undefined";
}

interface SearchProviderEnvelopeCorpus {
  readonly cases: readonly SearchProviderEnvelopeCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

export function readSearchProviderEnvelopeCorpus(): SearchProviderEnvelopeCorpus {
  const corpus = JSON.parse(
    readFileSync(
      new URL("./adversarial/search-provider-envelopes.json", import.meta.url),
      "utf8",
    ),
  ) as SearchProviderEnvelopeCorpus;
  assert.equal(corpus.schema, 1);
  assert.match(corpus.reviewResolutionRule, /review finding/u);
  assert.ok(corpus.cases.length > 0);
  assert.equal(new Set(corpus.cases.map(({ name }) => name)).size, corpus.cases.length);
  for (const entry of corpus.cases) {
    assert.equal(entry.gate, "search-provider-envelope");
    assert.equal(entry.expectation, "fallback");
    assert.ok(entry.name.length > 0);
    assert.ok(
      ["missing-candidates", "non-array-candidates", "null", "undefined"].includes(
        entry.value,
      ),
    );
  }
  return corpus;
}

export function malformedProviderEnvelope(
  value: SearchProviderEnvelopeCase["value"],
): unknown {
  switch (value) {
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "missing-candidates":
      return Object.freeze({ diagnostics: Object.freeze([]) });
    case "non-array-candidates":
      return Object.freeze({ candidates: "invalid" });
  }
}
