import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

interface ChangelogCase {
  readonly name: string;
  readonly gate: "changelog";
  readonly expectation: "accept";
  readonly existingContent?: string;
  readonly date: string;
  readonly operationId: string;
  readonly prose: string;
  readonly expected: string;
  readonly exerciseOperations?: true;
}

export function readChangelogCorpus(): readonly ChangelogCase[] {
  const corpus = JSON.parse(
    readFileSync(new URL("./adversarial/changelog.json", import.meta.url), "utf8"),
  ) as {
    readonly schema: 1;
    readonly reviewResolutionRule: string;
    readonly cases: readonly ChangelogCase[];
  };
  assert.equal(corpus.schema, 1);
  assert.match(corpus.reviewResolutionRule, /review finding/u);
  assert.equal(Array.isArray(corpus.cases), true);
  assert.ok(corpus.cases.length > 0);
  assert.equal(new Set(corpus.cases.map(({ name }) => name)).size, corpus.cases.length);
  for (const entry of corpus.cases) {
    assert.equal(entry.gate, "changelog");
    assert.equal(entry.expectation, "accept");
    for (const value of [
      entry.name,
      entry.date,
      entry.operationId,
      entry.prose,
      entry.expected,
    ]) {
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0);
    }
    if (entry.existingContent !== undefined) {
      assert.equal(typeof entry.existingContent, "string");
    }
    if (entry.exerciseOperations !== undefined) {
      assert.equal(entry.exerciseOperations, true);
    }
  }
  return corpus.cases;
}
