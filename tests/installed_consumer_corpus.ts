import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

interface InstalledConsumerCase {
  readonly name: string;
  readonly gate: "installed-consumer";
  readonly expectation: "accept";
  readonly query: string;
  readonly expectedRootAnchorId: string;
  readonly expectedAtlasPaths: readonly string[];
  readonly unmergedLintCode: string;
}

interface InstalledConsumerCorpus {
  readonly schema: 1;
  readonly reviewResolutionRule: string;
  readonly cases: readonly InstalledConsumerCase[];
}

export function readInstalledConsumerCorpus(): InstalledConsumerCorpus {
  const corpus = JSON.parse(
    readFileSync(
      new URL("./adversarial/installed-consumer.json", import.meta.url),
      "utf8",
    ),
  ) as InstalledConsumerCorpus;
  assert.equal(corpus.schema, 1);
  assert.match(corpus.reviewResolutionRule, /review finding/u);
  assert.equal(Array.isArray(corpus.cases), true);
  assert.ok(corpus.cases.length > 0);
  assert.equal(new Set(corpus.cases.map(({ name }) => name)).size, corpus.cases.length);
  for (const entry of corpus.cases) {
    assert.equal(entry.gate, "installed-consumer");
    assert.equal(entry.expectation, "accept");
    for (const value of [
      entry.name,
      entry.query,
      entry.expectedRootAnchorId,
      entry.unmergedLintCode,
    ]) {
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0);
    }
    assert.equal(Array.isArray(entry.expectedAtlasPaths), true);
    assert.ok(entry.expectedAtlasPaths.length > 0);
    for (const path of entry.expectedAtlasPaths) {
      assert.equal(typeof path, "string");
      assert.match(path, /^\.atlas\//u);
    }
  }
  return corpus;
}
