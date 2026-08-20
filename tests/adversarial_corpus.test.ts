import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { CoreArchetypeBindings } from "../src/domain/core_archetype.ts";
import {
  validateVocabularyAgreement,
  type VocabularyTextFile,
} from "../src/lint/validate_vocabulary_agreement.ts";

interface CorpusCase {
  readonly codes?: readonly string[];
  readonly expectation: "accept" | "reject";
  readonly gate: "vocabulary-agreement";
  readonly input: {
    readonly glossaryAvoidance: string;
    readonly source: string;
  };
  readonly messages?: readonly string[];
  readonly name: string;
}

interface Corpus {
  readonly cases: readonly CorpusCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

const ROOT = resolve(import.meta.dirname, "..");
const corpus = JSON.parse(
  readFileSync(
    resolve(ROOT, "tests", "adversarial", "vocabulary-agreement.json"),
    "utf8",
  ),
) as Corpus;

const binding: CoreArchetypeBindings = Object.freeze({
  Anchor: Object.freeze({
    diagnosticStem: "ANCHOR",
    directory: "anchors",
    idPrefix: "anchor",
    pageType: "anchor",
  }),
});

function glossary(avoidance: string): VocabularyTextFile {
  return {
    content: [
      "# Atlas SDK",
      "",
      "**Anchor**:",
      "A page through which an agent enters a region of knowledge.",
      avoidance,
      "",
    ].join("\n"),
    path: "CONTEXT.md",
  };
}

test("the adversarial vocabulary corpus states the review-resolution rule", () => {
  assert.match(corpus.reviewResolutionRule, /review finding/u);
  assert.equal(corpus.schema, 1);
});

for (const entry of corpus.cases) {
  test(`adversarial vocabulary corpus: ${entry.name}`, () => {
    assert.equal(entry.gate, "vocabulary-agreement");
    const findings = validateVocabularyAgreement(
      binding,
      glossary(entry.input.glossaryAvoidance),
      [{ content: entry.input.source, path: "src/lint/adversarial.ts" }],
    );
    const summary = findings.map((finding) => `${finding.code} ${finding.message}`);

    if (entry.expectation === "accept") {
      assert.deepEqual(summary, []);
      return;
    }

    assert.deepEqual(
      findings.map((finding) => finding.code),
      entry.codes,
    );
    for (const text of entry.messages ?? []) {
      assert.ok(
        summary.some((line) => line.includes(text)),
        `${entry.name} did not report ${text}: ${summary.join("\n")}`,
      );
    }
  });
}
