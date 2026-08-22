import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { captureAtlasHostDirectory, CaptureBudgetError } from "../scripts/atlas.ts";
import { buildAtlasView } from "../src/atlas/atlas_view.ts";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import type { CoreArchetypeBindings } from "../src/domain/core_archetype.ts";
import { loadAndValidateAtlasInput } from "../src/lint/validate_atlas_input.ts";
import { runLintOperation } from "../src/operations/lint_operation.ts";
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
const atlasCliCorpus = parseAtlasCliCorpus(
  JSON.parse(
    readFileSync(resolve(ROOT, "tests", "adversarial", "atlas-cli.json"), "utf8"),
  ),
);
const corpus = parseCorpus(
  JSON.parse(
    readFileSync(
      resolve(ROOT, "tests", "adversarial", "vocabulary-agreement.json"),
      "utf8",
    ),
  ),
);

interface AtlasCliCommandCase {
  readonly arguments: readonly string[];
  readonly expectedCode: string;
  readonly expectedDegradationState?: "degraded" | "not-degraded";
  readonly expectedExit: number;
  readonly forbidPayloadLint?: true;
  readonly gate: "atlas-cli";
  readonly kind: "command";
  readonly name: string;
  readonly recommendedNextActionExcludes?: string;
  readonly stderrIncludes?: string;
}

interface AtlasCliSourceBoundaryCase {
  readonly forbiddenImports: readonly string[];
  readonly gate: "atlas-cli";
  readonly kind: "source-boundary";
  readonly name: string;
  readonly path: string;
}

interface AtlasCliSourceContractCase {
  readonly forbiddenText: string;
  readonly gate: "atlas-cli";
  readonly kind: "source-contract";
  readonly name: string;
  readonly path: string;
  readonly requiredText: string;
}

interface AtlasCliAtlasViewMutationCase {
  readonly expectedSlug: string;
  readonly expectedSnapshot: string;
  readonly gate: "atlas-cli";
  readonly kind: "atlas-view-mutation";
  readonly mutatedSlug: string;
  readonly mutatedSnapshot: string;
  readonly name: string;
}

interface AtlasCliCaptureBudgetCase {
  readonly budgets: {
    readonly maxFileBytes: number;
    readonly maxFiles: number;
    readonly maxTotalBytes: number;
    readonly maxTraversalDepth: number;
  };
  readonly expectedCode: string;
  readonly files: readonly {
    readonly path: string;
    readonly text: string;
  }[];
  readonly gate: "atlas-cli";
  readonly kind: "capture-budget";
  readonly maxBytesRead: number;
  readonly name: string;
}

type AtlasCliCase =
  | AtlasCliAtlasViewMutationCase
  | AtlasCliCaptureBudgetCase
  | AtlasCliCommandCase
  | AtlasCliSourceBoundaryCase
  | AtlasCliSourceContractCase;

interface AtlasCliCorpus {
  readonly cases: readonly AtlasCliCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

const adversarialEncoder = new TextEncoder();

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

function assertBoolean(value: unknown, path: string): true | undefined {
  if (value === undefined) return undefined;
  assert.equal(value, true, `${path} must be true when present`);
  return true;
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== "number") {
    assert.fail(`${path} must be a number`);
  }
  return value;
}

function parseAtlasCliCorpus(value: unknown): AtlasCliCorpus {
  assert.ok(isRecord(value), "atlas-cli corpus must be an object");
  assert.equal(value["schema"], 1, "atlas-cli corpus schema must be 1");
  const reviewResolutionRule = assertString(
    value["reviewResolutionRule"],
    "atlas-cli.reviewResolutionRule",
  );
  assert.ok(Array.isArray(value["cases"]), "atlas-cli cases must be an array");
  assert.notEqual(value["cases"].length, 0, "atlas-cli cases must not be empty");
  const names = new Set<string>();
  const cases = (value["cases"] as readonly unknown[]).map(
    (entry, index): AtlasCliCase => {
      const path = `atlas-cli.cases[${String(index)}]`;
      assert.ok(isRecord(entry), `${path} must be an object`);
      const name = assertString(entry["name"], `${path}.name`);
      assert.equal(names.has(name), false, `${path}.name must be unique`);
      names.add(name);
      assert.equal(entry["gate"], "atlas-cli", `${path}.gate is unsupported`);
      if (entry["kind"] === "command") {
        const parsed: AtlasCliCommandCase = {
          arguments: assertStringArray(entry["arguments"], `${path}.arguments`),
          expectedCode: assertString(entry["expectedCode"], `${path}.expectedCode`),
          expectedExit: assertNumber(entry["expectedExit"], `${path}.expectedExit`),
          gate: "atlas-cli",
          kind: "command",
          name,
        };
        const optional: {
          expectedDegradationState?: "degraded" | "not-degraded";
          forbidPayloadLint?: true;
          recommendedNextActionExcludes?: string;
          stderrIncludes?: string;
        } = {};
        if (entry["expectedDegradationState"] !== undefined) {
          optional.expectedDegradationState = assertString(
            entry["expectedDegradationState"],
            `${path}.expectedDegradationState`,
          ) as "degraded" | "not-degraded";
        }
        if (entry["forbidPayloadLint"] !== undefined) {
          assertBoolean(entry["forbidPayloadLint"], `${path}.forbidPayloadLint`);
          optional.forbidPayloadLint = true;
        }
        if (entry["recommendedNextActionExcludes"] !== undefined) {
          optional.recommendedNextActionExcludes = assertString(
            entry["recommendedNextActionExcludes"],
            `${path}.recommendedNextActionExcludes`,
          );
        }
        if (entry["stderrIncludes"] !== undefined) {
          optional.stderrIncludes = assertString(
            entry["stderrIncludes"],
            `${path}.stderrIncludes`,
          );
        }
        return { ...parsed, ...optional };
      }
      if (entry["kind"] === "capture-budget") {
        assert.ok(Array.isArray(entry["files"]), `${path}.files must be an array`);
        return {
          budgets: {
            maxFileBytes: assertNumber(
              (entry["budgets"] as Readonly<Record<string, unknown>> | undefined)?.[
                "maxFileBytes"
              ],
              `${path}.budgets.maxFileBytes`,
            ),
            maxFiles: assertNumber(
              (entry["budgets"] as Readonly<Record<string, unknown>> | undefined)?.[
                "maxFiles"
              ],
              `${path}.budgets.maxFiles`,
            ),
            maxTotalBytes: assertNumber(
              (entry["budgets"] as Readonly<Record<string, unknown>> | undefined)?.[
                "maxTotalBytes"
              ],
              `${path}.budgets.maxTotalBytes`,
            ),
            maxTraversalDepth: assertNumber(
              (entry["budgets"] as Readonly<Record<string, unknown>> | undefined)?.[
                "maxTraversalDepth"
              ],
              `${path}.budgets.maxTraversalDepth`,
            ),
          },
          expectedCode: assertString(entry["expectedCode"], `${path}.expectedCode`),
          files: (entry["files"] as readonly unknown[]).map((file, fileIndex) => {
            assert.ok(isRecord(file), `${path}.files[${String(fileIndex)}]`);
            return {
              path: assertString(file["path"], `${path}.files.path`),
              text: assertString(file["text"], `${path}.files.text`),
            };
          }),
          gate: "atlas-cli",
          kind: "capture-budget",
          maxBytesRead: assertNumber(entry["maxBytesRead"], `${path}.maxBytesRead`),
          name,
        };
      }
      if (entry["kind"] === "source-contract") {
        return {
          forbiddenText: assertString(entry["forbiddenText"], `${path}.forbiddenText`),
          gate: "atlas-cli",
          kind: "source-contract",
          name,
          path: assertString(entry["path"], `${path}.path`),
          requiredText: assertString(entry["requiredText"], `${path}.requiredText`),
        };
      }
      if (entry["kind"] === "atlas-view-mutation") {
        return {
          expectedSlug: assertString(entry["expectedSlug"], `${path}.expectedSlug`),
          expectedSnapshot: assertString(
            entry["expectedSnapshot"],
            `${path}.expectedSnapshot`,
          ),
          gate: "atlas-cli",
          kind: "atlas-view-mutation",
          mutatedSlug: assertString(entry["mutatedSlug"], `${path}.mutatedSlug`),
          mutatedSnapshot: assertString(
            entry["mutatedSnapshot"],
            `${path}.mutatedSnapshot`,
          ),
          name,
        };
      }
      assert.equal(entry["kind"], "source-boundary", `${path}.kind is unsupported`);
      return {
        forbiddenImports: assertStringArray(
          entry["forbiddenImports"],
          `${path}.forbiddenImports`,
        ),
        gate: "atlas-cli",
        kind: "source-boundary",
        name,
        path: assertString(entry["path"], `${path}.path`),
      };
    },
  );
  return { cases, reviewResolutionRule, schema: 1 };
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
  assert.equal(executedCases, corpus.cases.length + atlasCliCorpus.cases.length);
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

test("the adversarial atlas-cli corpus is structurally valid", () => {
  assert.match(atlasCliCorpus.reviewResolutionRule, /review finding/u);
  assert.equal(atlasCliCorpus.schema, 1);
  assert.equal(
    new Set(atlasCliCorpus.cases.map((entry) => entry.name)).size,
    atlasCliCorpus.cases.length,
  );
  assert.ok(atlasCliCorpus.cases.some((entry) => entry.kind === "command"));
  assert.ok(atlasCliCorpus.cases.some((entry) => entry.kind === "capture-budget"));
  assert.ok(atlasCliCorpus.cases.some((entry) => entry.kind === "source-boundary"));
  assert.ok(atlasCliCorpus.cases.some((entry) => entry.kind === "source-contract"));
  assert.ok(atlasCliCorpus.cases.some((entry) => entry.kind === "atlas-view-mutation"));
});

function adversarialCaptured(path: string, content: string): CapturedAtlasFile {
  return { bytes: adversarialEncoder.encode(content), path };
}

function adversarialPage(): CapturedAtlasFile {
  return adversarialCaptured(
    ".atlas/index.md",
    [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      "  local-atlas-schema: 1.0.0",
      "  id: anchor:root",
      "  type: anchor",
      "  title: Root",
      '  created-at: "2026-08-17T00:00:00Z"',
      "  created-by: { kind: human, name: Fixture Author }",
      '  updated-at: "2026-08-17T00:00:00Z"',
      "  updated-by: { kind: human, name: Fixture Author }",
      "  tags: []",
      "atlas: {}",
      "---",
      "# Root",
    ].join("\n"),
  );
}

function exerciseAtlasViewMutation(entry: AtlasCliAtlasViewMutationCase): void {
  const validation = loadAndValidateAtlasInput([adversarialPage()], {
    maxFileBytes: 8192,
    maxTotalBytes: 65536,
  });
  const identity = {
    atlas: { reference: "local-home-atlas", state: "known" as const },
    role: "home" as const,
    slug: entry.expectedSlug,
    snapshot: { reference: entry.expectedSnapshot, state: "known" as const },
  };
  const atlasView = buildAtlasView({ identity, validation });

  identity.slug = entry.mutatedSlug;
  identity.snapshot.reference = entry.mutatedSnapshot;

  const snapshot = atlasView.snapshots[0];
  const file = atlasView.files[0];
  const object = atlasView.objects[0];
  const digest = atlasView.fileDigests[0];
  assert.ok(snapshot);
  assert.ok(file);
  assert.ok(object);
  assert.ok(digest);
  assert.equal(snapshot.slug, entry.expectedSlug);
  assert.equal(snapshot.snapshot.reference, entry.expectedSnapshot);
  assert.equal(file.snapshot.slug, entry.expectedSlug);
  assert.equal(object.sourceLocation.snapshot.slug, entry.expectedSlug);
  assert.equal(digest.snapshot.slug, entry.expectedSlug);
  assert.equal(digest.snapshot.snapshot.reference, entry.expectedSnapshot);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.snapshot), true);
  assert.equal(Object.isFrozen(object.page.sdk), true);
}

for (const entry of atlasCliCorpus.cases) {
  test(`adversarial atlas-cli corpus: ${entry.name}`, () => {
    executedCases += 1;
    if (entry.kind === "capture-budget") {
      const workspace = resolve(ROOT, ".test-workspaces", "adversarial-atlas-cli");
      rmSync(workspace, { force: true, recursive: true });
      mkdirSync(resolve(workspace, ".atlas"), { recursive: true });
      for (const file of entry.files) {
        writeFileSync(resolve(workspace, file.path), file.text);
      }
      let bytesRead = 0;
      try {
        captureAtlasHostDirectory(workspace, entry.budgets, (path) => {
          const bytes = readFileSync(path);
          bytesRead += bytes.byteLength;
          return bytes;
        });
        assert.fail("expected capture budget failure");
      } catch (error: unknown) {
        assert.ok(error instanceof CaptureBudgetError);
        assert.ok(bytesRead <= entry.maxBytesRead, String(bytesRead));
        const result = runLintOperation(error.capturedFiles, entry.budgets);
        assert.equal(result.payload.state, "completed");
        assert.equal(result.payload.lint.findings[0]?.code, entry.expectedCode);
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
      return;
    }
    if (entry.kind === "source-boundary") {
      const source = readFileSync(resolve(ROOT, entry.path), "utf8");
      for (const forbidden of entry.forbiddenImports) {
        assert.equal(source.includes(forbidden), false, forbidden);
      }
      return;
    }
    if (entry.kind === "source-contract") {
      const source = readFileSync(resolve(ROOT, entry.path), "utf8");
      assert.equal(source.includes(entry.requiredText), true, entry.requiredText);
      assert.equal(source.includes(entry.forbiddenText), false, entry.forbiddenText);
      return;
    }
    if (entry.kind === "atlas-view-mutation") {
      exerciseAtlasViewMutation(entry);
      return;
    }

    const command = spawnSync(
      process.execPath,
      [resolve(ROOT, "scripts", "atlas.ts"), ...entry.arguments],
      { cwd: ROOT, encoding: "buffer" },
    );
    assert.equal(command.error, undefined);
    assert.equal(command.status, entry.expectedExit);
    const result = JSON.parse(command.stdout.toString("utf8")) as Readonly<
      Record<string, unknown>
    >;
    const handoff = result["handoff"] as Readonly<Record<string, unknown>>;
    const validationState = handoff["validationState"] as Readonly<
      Record<string, unknown>
    >;
    const findings = validationState["findings"] as readonly Readonly<
      Record<string, unknown>
    >[];
    assert.equal(findings[0]?.["code"], entry.expectedCode);
    if (entry.forbidPayloadLint === true) {
      const payload = result["payload"] as Readonly<Record<string, unknown>>;
      assert.equal(payload["state"], "not-completed");
      assert.equal("lint" in payload, false);
    }
    if (entry.expectedDegradationState !== undefined) {
      const degradationState = handoff["degradationState"] as Readonly<
        Record<string, unknown>
      >;
      assert.equal(degradationState["state"], entry.expectedDegradationState);
    }
    if (entry.recommendedNextActionExcludes !== undefined) {
      assert.equal(
        String(handoff["recommendedNextAction"]).includes(
          entry.recommendedNextActionExcludes,
        ),
        false,
      );
    }
    if (entry.stderrIncludes !== undefined) {
      assert.ok(
        command.stderr.toString("utf8").includes(entry.stderrIncludes),
        command.stderr.toString("utf8"),
      );
    }
  });
}

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
      [],
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
