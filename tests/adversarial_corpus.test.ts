import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { after } from "node:test";
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
const corpus = parseCorpus(
  JSON.parse(
    readFileSync(
      resolve(ROOT, "tests", "adversarial", "vocabulary-agreement.json"),
      "utf8",
    ),
  ),
);

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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    assert.fail(`${path} must be a string`);
  }
  assert.notEqual(value.trim(), "", `${path} must not be empty`);
  return value;
}

function assertStringArray(value: unknown, path: string): readonly string[] {
  assert.ok(Array.isArray(value), `${path} must be an array`);
  assert.notEqual(value.length, 0, `${path} must not be empty`);
  return (value as readonly unknown[]).map((entry, index) =>
    assertString(entry, `${path}[${String(index)}]`),
  );
}

function parseCorpus(value: unknown): Corpus {
  assert.ok(isRecord(value), "corpus must be an object");
  assert.equal(value["schema"], 1, "corpus schema must be 1");
  const reviewResolutionRule = assertString(
    value["reviewResolutionRule"],
    "reviewResolutionRule",
  );
  assert.ok(Array.isArray(value["cases"]), "cases must be an array");
  assert.notEqual(value["cases"].length, 0, "cases must not be empty");

  let accepts = 0;
  let rejects = 0;
  const names = new Set<string>();
  const cases = (value["cases"] as readonly unknown[]).map(
    (entry, index): CorpusCase => {
      const path = `cases[${String(index)}]`;
      assert.ok(isRecord(entry), `${path} must be an object`);
      const name = assertString(entry["name"], `${path}.name`);
      assert.equal(names.has(name), false, `${path}.name must be unique`);
      names.add(name);
      assert.equal(
        entry["gate"],
        "vocabulary-agreement",
        `${path}.gate is unsupported`,
      );
      assert.ok(isRecord(entry["input"]), `${path}.input must be an object`);
      const input = {
        glossaryAvoidance: assertString(
          entry["input"]["glossaryAvoidance"],
          `${path}.input.glossaryAvoidance`,
        ),
        source: assertString(entry["input"]["source"], `${path}.input.source`),
      };
      if (entry["expectation"] === "accept") {
        accepts += 1;
        assert.equal(entry["codes"], undefined, `${path}.codes must be omitted`);
        assert.equal(entry["messages"], undefined, `${path}.messages must be omitted`);
        return { expectation: "accept", gate: "vocabulary-agreement", input, name };
      }
      assert.equal(
        entry["expectation"],
        "reject",
        `${path}.expectation is unsupported`,
      );
      rejects += 1;
      const parsed: CorpusCase = {
        codes: assertStringArray(entry["codes"], `${path}.codes`),
        expectation: "reject",
        gate: "vocabulary-agreement",
        input,
        name,
      };
      if (entry["messages"] !== undefined) {
        return {
          ...parsed,
          messages: assertStringArray(entry["messages"], `${path}.messages`),
        };
      }
      return parsed;
    },
  );

  assert.notEqual(accepts, 0, "corpus must include an accept case");
  assert.notEqual(rejects, 0, "corpus must include a reject case");
  return { cases, reviewResolutionRule, schema: 1 };
}

let executedCases = 0;

after(() => {
  assert.equal(executedCases, corpus.cases.length);
});

test("the adversarial vocabulary corpus is structurally valid", () => {
  assert.match(corpus.reviewResolutionRule, /review finding/u);
  assert.equal(corpus.schema, 1);
  assert.equal(
    new Set(corpus.cases.map((entry) => entry.name)).size,
    corpus.cases.length,
  );
  assert.ok(corpus.cases.some((entry) => entry.expectation === "accept"));
  assert.ok(corpus.cases.some((entry) => entry.expectation === "reject"));
});

test("an empty adversarial corpus fails validation", () => {
  assert.throws(
    () =>
      parseCorpus({
        cases: [],
        reviewResolutionRule:
          "A review finding is resolved only after this corpus has a case.",
        schema: 1,
      }),
    /cases must not be empty/u,
  );
});

for (const entry of corpus.cases) {
  test(`adversarial vocabulary corpus: ${entry.name}`, () => {
    executedCases += 1;
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
