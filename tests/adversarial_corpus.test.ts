import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import test, { after } from "node:test";
import { captureAtlasHostDirectory, CaptureBudgetError } from "../scripts/atlas.ts";
import { lintCommandCaptureBudgets } from "../src/interfaces/lint_command.ts";
import {
  AgentContract,
  assertRoasterName,
  buildContracts,
  buildRoasterContracts,
  commandSync,
  composeRoaster,
  LocalSource,
  ROASTER_TOOL_SET,
  validateRoasterContracts,
} from "../scripts/cacophony_agents.ts";
import { exploreCommandBudgets } from "../src/interfaces/explore_command.ts";
import { ingestCommandInputBudgets } from "../src/interfaces/ingest_command.ts";
import { buildAtlasView } from "../src/atlas/atlas_view.ts";
import { parseAtlasPage, parseAtlasPages } from "../src/atlas/parse_atlas_pages.ts";
import { serializeAtlasPages } from "../src/atlas/serialize_atlas_pages.ts";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import type { Finding } from "../src/domain/finding.ts";
import type { CoreArchetypeBindings } from "../src/domain/core_archetype.ts";
import { loadAndValidateAtlasInput } from "../src/lint/validate_atlas_input.ts";
import { validateAtlasStructure } from "../src/lint/validate_atlas_structure.ts";
import {
  atlasInitializationFiles,
  initialAtlasInitializationWorkflowState,
  runAtlasInitializationWorkflow,
} from "../src/operations/initialize_operation.ts";
import { runLintOperation } from "../src/operations/lint_operation.ts";
import {
  reconcileCandidateGraph,
  runAtlasIngestWorkflow,
  validateAtlasIngestChangeSet,
  validateCandidateGraph,
  type AtlasIngestCandidateEdge,
  type AtlasIngestCandidateGraph,
  type AtlasIngestChange,
  type AtlasIngestChangeSet,
  type AtlasIngestRequest,
  type AtlasIngestRuntime,
  type AtlasIngestWorkflowState,
} from "../src/operations/ingest_operation.ts";
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
    readonly glossaryTerm?: string;
    readonly source: string;
    readonly unboundTerms?: readonly string[];
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
const lintStampCorpus = parseLintStampCorpus(
  JSON.parse(
    readFileSync(resolve(ROOT, "tests", "adversarial", "lint-stamp.json"), "utf8"),
  ),
);
const structuralValidationCorpus = parseStructuralValidationCorpus(
  JSON.parse(
    readFileSync(
      resolve(ROOT, "tests", "adversarial", "structural-validation.json"),
      "utf8",
    ),
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
const ingestCorpus = parseIngestCorpus(
  JSON.parse(
    readFileSync(resolve(ROOT, "tests", "adversarial", "ingest.json"), "utf8"),
  ),
);
const cacophonyRoasterCorpus = parseCacophonyRoasterCorpus(
  JSON.parse(
    readFileSync(
      resolve(ROOT, "tests", "adversarial", "cacophony-roasters.json"),
      "utf8",
    ),
  ),
);

type IngestCaseKind =
  | "graph"
  | "graph-principle"
  | "graph-policy"
  | "workflow"
  | "change-set"
  | "emission"
  | "source-reuse";

interface CacophonyRoasterEligibleRosterCase {
  readonly excludedRoasters: readonly string[];
  readonly expectation: "accept";
  readonly expectedRoasters: readonly string[];
  readonly gate: "cacophony-roasters";
  readonly kind: "eligible-roster";
  readonly name: string;
}

interface CacophonyRoasterReservedNameCase {
  readonly expectation: "reject";
  readonly gate: "cacophony-roasters";
  readonly kind: "reserved-name";
  readonly messageIncludes: string;
  readonly name: string;
  readonly nameUnderTest: string;
}

interface CacophonyRoasterToolsCase {
  readonly expectation: "reject";
  readonly gate: "cacophony-roasters";
  readonly kind: "tools";
  readonly messageIncludes: string;
  readonly name: string;
  readonly tools: readonly string[];
}

interface CacophonyRoasterUnexpectedPathCase {
  readonly expectation: "reject";
  readonly gate: "cacophony-roasters";
  readonly kind: "unexpected-path";
  readonly messageIncludes: string;
  readonly name: string;
  readonly path: string;
}

interface CacophonyRoasterKnownCleanupCase {
  readonly agent: string;
  readonly expectation: "accept";
  readonly gate: "cacophony-roasters";
  readonly kind: "known-cleanup";
  readonly name: string;
}

interface CacophonyRoasterFieldsDistinctCase {
  readonly expectation: "accept";
  readonly gate: "cacophony-roasters";
  readonly kind: "roaster-fields-distinct";
  readonly name: string;
}

interface CacophonyRoasterMissingLensCase {
  readonly agent: string;
  readonly expectation: "reject";
  readonly gate: "cacophony-roasters";
  readonly kind: "missing-lens";
  readonly messageIncludes: string;
  readonly name: string;
}

interface CacophonyRoasterMisplacedLensCase {
  readonly agent: string;
  readonly expectation: "reject";
  readonly gate: "cacophony-roasters";
  readonly kind: "misplaced-lens";
  readonly messageIncludes: string;
  readonly name: string;
}

type CacophonyRoasterCase =
  | CacophonyRoasterEligibleRosterCase
  | CacophonyRoasterKnownCleanupCase
  | CacophonyRoasterMisplacedLensCase
  | CacophonyRoasterFieldsDistinctCase
  | CacophonyRoasterMissingLensCase
  | CacophonyRoasterReservedNameCase
  | CacophonyRoasterToolsCase
  | CacophonyRoasterUnexpectedPathCase;

interface CacophonyRoasterCorpus {
  readonly cases: readonly CacophonyRoasterCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

interface IngestCorpusCase {
  readonly expectation: "accept" | "reject";
  readonly expectedCode?: string;
  readonly expectedCodes?: readonly string[];
  readonly gate: "ingest";
  readonly kind: IngestCaseKind;
  readonly mutation: string;
  readonly name: string;
}

interface IngestCorpus {
  readonly cases: readonly IngestCorpusCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

interface AtlasCliCommandCase {
  readonly arguments: readonly string[];
  readonly expectedCode: string;
  readonly expectedDegradationState?: "degraded" | "not-degraded";
  readonly expectedExit: number;
  readonly fixtureAtlasHostRepository?: true;
  readonly forbidPayloadLint?: true;
  readonly gate: "atlas-cli";
  readonly generatedExploreAtlasOverFileBudget?: true;
  readonly generatedOversizedExploreQuery?: true;
  readonly generatedOversizedIngestRequest?: true;
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

interface AtlasCliCaptureSecurityHardlinkCase {
  readonly entryPath: string;
  readonly expectedMessage: string;
  readonly gate: "atlas-cli";
  readonly kind: "capture-security";
  readonly name: string;
  readonly outsideFile: {
    readonly path: string;
    readonly text: string;
  };
  readonly scenario: "hardlink";
}

interface AtlasCliCaptureSecuritySymlinkSwapCase {
  readonly entryPath: string;
  readonly gate: "atlas-cli";
  readonly kind: "capture-security";
  readonly name: string;
  readonly originalText: string;
  readonly outsideFile: {
    readonly path: string;
    readonly text: string;
  };
  readonly scenario: "symlink-swap";
}

type AtlasCliCaptureSecurityCase =
  AtlasCliCaptureSecurityHardlinkCase | AtlasCliCaptureSecuritySymlinkSwapCase;

type AtlasCliCase =
  | AtlasCliAtlasViewMutationCase
  | AtlasCliCaptureBudgetCase
  | AtlasCliCaptureSecurityCase
  | AtlasCliCommandCase
  | AtlasCliSourceBoundaryCase
  | AtlasCliSourceContractCase;

interface AtlasCliCorpus {
  readonly cases: readonly AtlasCliCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

type LintStampCase =
  | LintStampEmittedKeyShapeCase
  | LintStampInlineLiteralSourceCase
  | LintStampSourceBypassEmittedShapeCase;

interface LintStampEmittedKeyShapeCase {
  readonly expectation: "accept" | "reject";
  readonly extraKeys?: readonly string[];
  readonly gate: "lint-stamp";
  readonly kind: "emitted-key-shape";
  readonly name: string;
}

interface LintStampInlineLiteralSourceCase {
  readonly expectation: "accept" | "reject";
  readonly gate: "lint-stamp";
  readonly input?: {
    readonly source: string;
  };
  readonly kind: "inline-literal-source";
  readonly literalFields?: readonly string[];
  readonly name: string;
  readonly sourcePath?: string;
}

interface LintStampSourceBypassEmittedShapeCase {
  readonly expectation: "reject";
  readonly extraKeys: readonly string[];
  readonly gate: "lint-stamp";
  readonly inlineLiteralFields: readonly string[];
  readonly input: {
    readonly source: string;
  };
  readonly kind: "source-bypass-emitted-shape";
  readonly name: string;
}

interface LintStampCorpus {
  readonly allowedKeys: readonly string[];
  readonly cases: readonly LintStampCase[];
  readonly literalFields: readonly string[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

interface StructuralValidationTruthsCase {
  readonly body: string;
  readonly expectation: "accept" | "reject";
  readonly expectedCode?: string;
  readonly gate: "structural-validation";
  readonly kind: "principle-active-truths";
  readonly name: string;
}

interface StructuralValidationSdkFieldCase {
  readonly expectation: "accept";
  readonly field: string;
  readonly gate: "structural-validation";
  readonly kind: "sdk-unrecognized-field";
  readonly name: string;
  readonly value: string;
}

type StructuralValidationCase =
  StructuralValidationTruthsCase | StructuralValidationSdkFieldCase;

interface StructuralValidationCorpus {
  readonly cases: readonly StructuralValidationCase[];
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

function glossary(avoidance: string, extraTerm?: string): VocabularyTextFile {
  return {
    content: [
      "# Atlas SDK",
      "",
      "**Anchor**:",
      "A page through which an agent enters a region of knowledge.",
      avoidance,
      "",
      ...(extraTerm === undefined ? [] : [extraTerm, ""]),
    ].join("\n"),
    path: "CONTEXT.md",
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class OverlayAtlasSource extends LocalSource {
  readonly overrides: Readonly<Record<string, string>>;
  readonly base: LocalSource;

  constructor(base: LocalSource, overrides: Readonly<Record<string, string>>) {
    super(ROOT);
    this.base = base;
    this.overrides = overrides;
  }

  override listFiles(prefix: string): string[] {
    const pathPrefix = `${prefix}/`;
    return [
      ...new Set([
        ...this.base.listFiles(prefix),
        ...Object.keys(this.overrides).filter(
          (path) => path === prefix || path.startsWith(pathPrefix),
        ),
      ]),
    ].sort();
  }

  override readText(path: string): string {
    return this.overrides[path] ?? this.base.readText(path);
  }
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    assert.fail(`${path} must be a string`);
  }
  assert.notEqual(value.trim(), "", `${path} must not be empty`);
  return value;
}

function assertStringArray(value: unknown, path: string): readonly string[] {
  const entries = assertPossiblyEmptyStringArray(value, path);
  assert.notEqual(entries.length, 0, `${path} must not be empty`);
  return entries;
}

function assertPossiblyEmptyStringArray(
  value: unknown,
  path: string,
): readonly string[] {
  assert.ok(Array.isArray(value), `${path} must be an array`);
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

function parseStructuralValidationCorpus(value: unknown): StructuralValidationCorpus {
  assert.ok(isRecord(value), "structural-validation corpus must be an object");
  assert.equal(value["schema"], 1, "structural-validation corpus schema must be 1");
  const reviewResolutionRule = assertString(
    value["reviewResolutionRule"],
    "structural-validation.reviewResolutionRule",
  );
  assert.ok(
    Array.isArray(value["cases"]),
    "structural-validation cases must be an array",
  );
  assert.notEqual(
    value["cases"].length,
    0,
    "structural-validation cases must not be empty",
  );
  const names = new Set<string>();
  let accepts = 0;
  let rejects = 0;
  const cases = (value["cases"] as readonly unknown[]).map(
    (entry, index): StructuralValidationCase => {
      const path = `structural-validation.cases[${String(index)}]`;
      assert.ok(isRecord(entry), `${path} must be an object`);
      const name = assertString(entry["name"], `${path}.name`);
      assert.equal(names.has(name), false, `${path}.name must be unique`);
      names.add(name);
      assert.equal(
        entry["gate"],
        "structural-validation",
        `${path}.gate is unsupported`,
      );
      const kind = entry["kind"];
      assert.ok(
        kind === "principle-active-truths" || kind === "sdk-unrecognized-field",
        `${path}.kind is unsupported`,
      );
      if (kind === "sdk-unrecognized-field") {
        assert.equal(
          entry["expectation"],
          "accept",
          `${path}.expectation must be accept for sdk-unrecognized-field`,
        );
        accepts += 1;
        return {
          expectation: "accept",
          field: assertString(entry["field"], `${path}.field`),
          gate: "structural-validation",
          kind,
          name,
          value: assertString(entry["value"], `${path}.value`),
        };
      }
      const expectation = entry["expectation"];
      assert.ok(
        expectation === "accept" || expectation === "reject",
        `${path}.expectation is unsupported`,
      );
      if (expectation === "accept") {
        accepts += 1;
        assert.equal(entry["expectedCode"], undefined, `${path}.expectedCode`);
        return {
          body: assertString(entry["body"], `${path}.body`),
          expectation,
          gate: "structural-validation",
          kind,
          name,
        };
      }
      rejects += 1;
      return {
        body: assertString(entry["body"], `${path}.body`),
        expectation,
        expectedCode: assertString(entry["expectedCode"], `${path}.expectedCode`),
        gate: "structural-validation",
        kind,
        name,
      };
    },
  );
  assert.notEqual(
    accepts,
    0,
    "structural-validation corpus must include an accept case",
  );
  assert.notEqual(
    rejects,
    0,
    "structural-validation corpus must include a reject case",
  );
  return { cases, reviewResolutionRule, schema: 1 };
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
          fixtureAtlasHostRepository?: true;
          forbidPayloadLint?: true;
          generatedExploreAtlasOverFileBudget?: true;
          generatedOversizedExploreQuery?: true;
          generatedOversizedIngestRequest?: true;
          recommendedNextActionExcludes?: string;
          stderrIncludes?: string;
        } = {};
        if (entry["expectedDegradationState"] !== undefined) {
          optional.expectedDegradationState = assertString(
            entry["expectedDegradationState"],
            `${path}.expectedDegradationState`,
          ) as "degraded" | "not-degraded";
        }
        if (entry["fixtureAtlasHostRepository"] !== undefined) {
          assertBoolean(
            entry["fixtureAtlasHostRepository"],
            `${path}.fixtureAtlasHostRepository`,
          );
          optional.fixtureAtlasHostRepository = true;
        }
        if (entry["forbidPayloadLint"] !== undefined) {
          assertBoolean(entry["forbidPayloadLint"], `${path}.forbidPayloadLint`);
          optional.forbidPayloadLint = true;
        }
        if (entry["generatedExploreAtlasOverFileBudget"] !== undefined) {
          assertBoolean(
            entry["generatedExploreAtlasOverFileBudget"],
            `${path}.generatedExploreAtlasOverFileBudget`,
          );
          optional.generatedExploreAtlasOverFileBudget = true;
        }
        if (entry["generatedOversizedExploreQuery"] !== undefined) {
          assertBoolean(
            entry["generatedOversizedExploreQuery"],
            `${path}.generatedOversizedExploreQuery`,
          );
          optional.generatedOversizedExploreQuery = true;
        }
        if (entry["generatedOversizedIngestRequest"] !== undefined) {
          assertBoolean(
            entry["generatedOversizedIngestRequest"],
            `${path}.generatedOversizedIngestRequest`,
          );
          optional.generatedOversizedIngestRequest = true;
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
      if (entry["kind"] === "capture-security") {
        const scenario = entry["scenario"];
        const outsideFile = entry["outsideFile"];
        assert.ok(isRecord(outsideFile), `${path}.outsideFile must be an object`);
        const entryPath = assertString(entry["entryPath"], `${path}.entryPath`);
        const parsedOutsideFile = {
          path: assertString(outsideFile["path"], `${path}.outsideFile.path`),
          text: assertString(outsideFile["text"], `${path}.outsideFile.text`),
        };
        if (scenario === "hardlink") {
          return {
            entryPath,
            expectedMessage: assertString(
              entry["expectedMessage"],
              `${path}.expectedMessage`,
            ),
            gate: "atlas-cli",
            kind: "capture-security",
            name,
            outsideFile: parsedOutsideFile,
            scenario: "hardlink",
          };
        }
        assert.equal(
          scenario,
          "symlink-swap",
          `${path}.scenario must be symlink-swap or hardlink`,
        );
        return {
          entryPath,
          gate: "atlas-cli",
          kind: "capture-security",
          name,
          originalText: assertString(entry["originalText"], `${path}.originalText`),
          outsideFile: parsedOutsideFile,
          scenario: "symlink-swap",
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

function parseLintStampCorpus(value: unknown): LintStampCorpus {
  assert.ok(isRecord(value), "lint-stamp corpus must be an object");
  assert.equal(value["schema"], 1, "lint-stamp corpus schema must be 1");
  const reviewResolutionRule = assertString(
    value["reviewResolutionRule"],
    "lint-stamp.reviewResolutionRule",
  );
  const allowedKeys = assertStringArray(value["allowedKeys"], "lint-stamp.allowedKeys");
  const literalFields = assertStringArray(
    value["literalFields"],
    "lint-stamp.literalFields",
  );
  assert.ok(Array.isArray(value["cases"]), "lint-stamp cases must be an array");
  assert.notEqual(value["cases"].length, 0, "lint-stamp cases must not be empty");
  const names = new Set<string>();
  let accepts = 0;
  let rejects = 0;
  const cases = (value["cases"] as readonly unknown[]).map(
    (entry, index): LintStampCase => {
      const path = `lint-stamp.cases[${String(index)}]`;
      assert.ok(isRecord(entry), `${path} must be an object`);
      const name = assertString(entry["name"], `${path}.name`);
      assert.equal(names.has(name), false, `${path}.name must be unique`);
      names.add(name);
      assert.equal(entry["gate"], "lint-stamp", `${path}.gate is unsupported`);
      if (entry["kind"] === "emitted-key-shape") {
        if (entry["expectation"] === "accept") {
          accepts += 1;
          assert.equal(entry["extraKeys"], undefined, `${path}.extraKeys`);
          return {
            expectation: "accept",
            gate: "lint-stamp",
            kind: "emitted-key-shape",
            name,
          };
        }
        assert.equal(
          entry["expectation"],
          "reject",
          `${path}.expectation is unsupported`,
        );
        rejects += 1;
        return {
          expectation: "reject",
          extraKeys: assertStringArray(entry["extraKeys"], `${path}.extraKeys`),
          gate: "lint-stamp",
          kind: "emitted-key-shape",
          name,
        };
      }
      if (entry["kind"] === "source-bypass-emitted-shape") {
        assert.equal(entry["expectation"], "reject", `${path}.expectation`);
        assert.ok(isRecord(entry["input"]), `${path}.input must be an object`);
        rejects += 1;
        return {
          expectation: "reject",
          extraKeys: assertStringArray(entry["extraKeys"], `${path}.extraKeys`),
          gate: "lint-stamp",
          inlineLiteralFields: assertPossiblyEmptyStringArray(
            entry["inlineLiteralFields"],
            `${path}.inlineLiteralFields`,
          ),
          input: {
            source: assertString(entry["input"]["source"], `${path}.input.source`),
          },
          kind: "source-bypass-emitted-shape",
          name,
        };
      }
      assert.equal(
        entry["kind"],
        "inline-literal-source",
        `${path}.kind is unsupported`,
      );
      assert.ok(
        entry["input"] !== undefined || entry["sourcePath"] !== undefined,
        `${path} must provide input or sourcePath`,
      );
      assert.ok(
        entry["input"] === undefined || entry["sourcePath"] === undefined,
        `${path} must not provide both input and sourcePath`,
      );
      const input = entry["input"];
      const parsedInput =
        input === undefined
          ? undefined
          : (() => {
              assert.ok(isRecord(input), `${path}.input must be an object`);
              return { source: assertString(input["source"], `${path}.input.source`) };
            })();
      const parsed = {
        expectation: entry["expectation"] as "accept" | "reject",
        gate: "lint-stamp" as const,
        kind: "inline-literal-source" as const,
        name,
        ...(parsedInput === undefined ? {} : { input: parsedInput }),
        ...(entry["sourcePath"] === undefined
          ? {}
          : { sourcePath: assertString(entry["sourcePath"], `${path}.sourcePath`) }),
      };
      if (entry["expectation"] === "accept") {
        accepts += 1;
        assert.equal(entry["literalFields"], undefined, `${path}.literalFields`);
        return parsed;
      }
      assert.equal(
        entry["expectation"],
        "reject",
        `${path}.expectation is unsupported`,
      );
      rejects += 1;
      return {
        ...parsed,
        literalFields: assertStringArray(
          entry["literalFields"],
          `${path}.literalFields`,
        ),
      };
    },
  );
  assert.notEqual(accepts, 0, "lint-stamp corpus must include an accept case");
  assert.notEqual(rejects, 0, "lint-stamp corpus must include a reject case");
  return { allowedKeys, cases, literalFields, reviewResolutionRule, schema: 1 };
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
        ...(entry["input"]["glossaryTerm"] === undefined
          ? {}
          : {
              glossaryTerm: assertString(
                entry["input"]["glossaryTerm"],
                `${path}.input.glossaryTerm`,
              ),
            }),
        source: assertString(entry["input"]["source"], `${path}.input.source`),
        ...(entry["input"]["unboundTerms"] === undefined
          ? {}
          : {
              unboundTerms: assertStringArray(
                entry["input"]["unboundTerms"],
                `${path}.input.unboundTerms`,
              ),
            }),
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

function parseCacophonyRoasterCorpus(value: unknown): CacophonyRoasterCorpus {
  assert.ok(isRecord(value), "cacophony-roasters corpus must be an object");
  assert.equal(value["schema"], 1, "cacophony-roasters corpus schema must be 1");
  const reviewResolutionRule = assertString(
    value["reviewResolutionRule"],
    "cacophony-roasters.reviewResolutionRule",
  );
  assert.ok(Array.isArray(value["cases"]), "cacophony-roasters cases must be an array");
  assert.notEqual(
    value["cases"].length,
    0,
    "cacophony-roasters cases must not be empty",
  );
  const names = new Set<string>();
  let accepts = 0;
  let rejects = 0;
  const cases = (value["cases"] as readonly unknown[]).map(
    (entry, index): CacophonyRoasterCase => {
      const path = `cacophony-roasters.cases[${String(index)}]`;
      assert.ok(isRecord(entry), `${path} must be an object`);
      const name = assertString(entry["name"], `${path}.name`);
      assert.equal(names.has(name), false, `${path}.name must be unique`);
      names.add(name);
      assert.equal(entry["gate"], "cacophony-roasters", `${path}.gate is unsupported`);
      const kind = assertString(entry["kind"], `${path}.kind`);
      if (kind === "eligible-roster") {
        assert.equal(entry["expectation"], "accept", `${path}.expectation`);
        accepts += 1;
        return {
          excludedRoasters: assertStringArray(
            entry["excludedRoasters"],
            `${path}.excludedRoasters`,
          ),
          expectation: "accept",
          expectedRoasters: assertStringArray(
            entry["expectedRoasters"],
            `${path}.expectedRoasters`,
          ),
          gate: "cacophony-roasters",
          kind,
          name,
        };
      }
      if (kind === "known-cleanup") {
        assert.equal(entry["expectation"], "accept", `${path}.expectation`);
        accepts += 1;
        return {
          agent: assertString(entry["agent"], `${path}.agent`),
          expectation: "accept",
          gate: "cacophony-roasters",
          kind,
          name,
        };
      }
      if (kind === "roaster-fields-distinct") {
        assert.equal(entry["expectation"], "accept", `${path}.expectation`);
        accepts += 1;
        return {
          expectation: "accept",
          gate: "cacophony-roasters",
          kind,
          name,
        };
      }
      assert.equal(entry["expectation"], "reject", `${path}.expectation`);
      rejects += 1;
      if (kind === "reserved-name") {
        return {
          expectation: "reject",
          gate: "cacophony-roasters",
          kind,
          messageIncludes: assertString(
            entry["messageIncludes"],
            `${path}.messageIncludes`,
          ),
          name,
          nameUnderTest: assertString(entry["nameUnderTest"], `${path}.nameUnderTest`),
        };
      }
      if (kind === "unexpected-path") {
        return {
          expectation: "reject",
          gate: "cacophony-roasters",
          kind,
          messageIncludes: assertString(
            entry["messageIncludes"],
            `${path}.messageIncludes`,
          ),
          name,
          path: assertString(entry["path"], `${path}.path`),
        };
      }
      if (kind === "missing-lens" || kind === "misplaced-lens") {
        return {
          agent: assertString(entry["agent"], `${path}.agent`),
          expectation: "reject",
          gate: "cacophony-roasters",
          kind,
          messageIncludes: assertString(
            entry["messageIncludes"],
            `${path}.messageIncludes`,
          ),
          name,
        };
      }
      assert.equal(kind, "tools", `${path}.kind is unsupported`);
      return {
        expectation: "reject",
        gate: "cacophony-roasters",
        kind,
        messageIncludes: assertString(
          entry["messageIncludes"],
          `${path}.messageIncludes`,
        ),
        name,
        tools: assertStringArray(entry["tools"], `${path}.tools`),
      };
    },
  );
  assert.notEqual(accepts, 0, "cacophony-roasters corpus must include an accept case");
  assert.notEqual(rejects, 0, "cacophony-roasters corpus must include a reject case");
  return { cases, reviewResolutionRule, schema: 1 };
}

function validateRoasterTools(tools: readonly string[]): void {
  if (
    tools.length !== ROASTER_TOOL_SET.length ||
    tools.some((tool, index) => tool !== ROASTER_TOOL_SET[index])
  ) {
    throw new Error("repository roaster tools must be exactly read and search");
  }
}

function parseIngestCorpus(value: unknown): IngestCorpus {
  assert.ok(isRecord(value), "ingest corpus must be an object");
  assert.equal(value["schema"], 1, "ingest corpus schema must be 1");
  const reviewResolutionRule = assertString(
    value["reviewResolutionRule"],
    "ingest.reviewResolutionRule",
  );
  assert.ok(Array.isArray(value["cases"]), "ingest cases must be an array");
  assert.notEqual(value["cases"].length, 0, "ingest cases must not be empty");
  const names = new Set<string>();
  let accepts = 0;
  let rejects = 0;
  const cases = (value["cases"] as readonly unknown[]).map(
    (entry, index): IngestCorpusCase => {
      const path = `ingest.cases[${String(index)}]`;
      assert.ok(isRecord(entry), `${path} must be an object`);
      const name = assertString(entry["name"], `${path}.name`);
      assert.equal(names.has(name), false, `${path}.name must be unique`);
      names.add(name);
      assert.equal(entry["gate"], "ingest", `${path}.gate is unsupported`);
      const kind = assertString(entry["kind"], `${path}.kind`);
      const kinds = new Set<IngestCaseKind>([
        "graph",
        "graph-principle",
        "graph-policy",
        "workflow",
        "change-set",
        "emission",
        "source-reuse",
      ]);
      assert.ok(kinds.has(kind as IngestCaseKind), `${path}.kind is unsupported`);
      const mutation = assertString(entry["mutation"], `${path}.mutation`);
      if (entry["expectation"] === "accept") {
        accepts += 1;
        assert.equal(entry["expectedCode"], undefined, `${path}.expectedCode`);
        return {
          expectation: "accept",
          gate: "ingest",
          kind: kind as IngestCaseKind,
          mutation,
          name,
        };
      }
      assert.equal(
        entry["expectation"],
        "reject",
        `${path}.expectation is unsupported`,
      );
      rejects += 1;
      // A reject case names either exactly one sole blocking code or the exact
      // set of blocking codes, so a case cannot pass on an incidental Finding.
      const codesValue = entry["expectedCodes"];
      if (codesValue !== undefined) {
        assert.ok(Array.isArray(codesValue), `${path}.expectedCodes must be an array`);
        return {
          expectation: "reject",
          expectedCodes: Object.freeze(
            (codesValue as readonly unknown[]).map((code, codeIndex) =>
              assertString(code, `${path}.expectedCodes[${String(codeIndex)}]`),
            ),
          ),
          gate: "ingest",
          kind: kind as IngestCaseKind,
          mutation,
          name,
        };
      }
      return {
        expectation: "reject",
        expectedCode: assertString(entry["expectedCode"], `${path}.expectedCode`),
        gate: "ingest",
        kind: kind as IngestCaseKind,
        mutation,
        name,
      };
    },
  );
  assert.notEqual(accepts, 0, "ingest corpus must include an accept case");
  assert.notEqual(rejects, 0, "ingest corpus must include a reject case");
  return { cases, reviewResolutionRule, schema: 1 };
}

let executedCases = 0;

after(() => {
  assert.equal(
    executedCases,
    corpus.cases.length +
      atlasCliCorpus.cases.length +
      lintStampCorpus.cases.length +
      structuralValidationCorpus.cases.length +
      ingestCorpus.cases.length +
      cacophonyRoasterCorpus.cases.length,
  );
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
  assert.ok(atlasCliCorpus.cases.some((entry) => entry.kind === "capture-security"));
});

test("the adversarial lint-stamp corpus is structurally valid", () => {
  assert.match(lintStampCorpus.reviewResolutionRule, /review finding/u);
  assert.equal(lintStampCorpus.schema, 1);
  assert.notEqual(lintStampCorpus.allowedKeys.length, 0);
  assert.notEqual(lintStampCorpus.literalFields.length, 0);
  assert.equal(
    new Set(lintStampCorpus.cases.map((entry) => entry.name)).size,
    lintStampCorpus.cases.length,
  );
  assert.ok(lintStampCorpus.cases.some((entry) => entry.expectation === "accept"));
  assert.ok(lintStampCorpus.cases.some((entry) => entry.expectation === "reject"));
  assert.ok(lintStampCorpus.cases.some((entry) => entry.kind === "emitted-key-shape"));
  assert.ok(
    lintStampCorpus.cases.some((entry) => entry.kind === "inline-literal-source"),
  );
  assert.ok(
    lintStampCorpus.cases.some((entry) => entry.kind === "source-bypass-emitted-shape"),
  );
});

test("the adversarial structural-validation corpus is structurally valid", () => {
  assert.match(structuralValidationCorpus.reviewResolutionRule, /review finding/u);
  assert.equal(structuralValidationCorpus.schema, 1);
  assert.equal(
    new Set(structuralValidationCorpus.cases.map((entry) => entry.name)).size,
    structuralValidationCorpus.cases.length,
  );
  assert.ok(
    structuralValidationCorpus.cases.some((entry) => entry.expectation === "accept"),
  );
  assert.ok(
    structuralValidationCorpus.cases.some((entry) => entry.expectation === "reject"),
  );
});

test("the adversarial cacophony-roasters corpus is structurally valid", () => {
  assert.match(cacophonyRoasterCorpus.reviewResolutionRule, /review finding/u);
  assert.equal(cacophonyRoasterCorpus.schema, 1);
  assert.equal(
    new Set(cacophonyRoasterCorpus.cases.map((entry) => entry.name)).size,
    cacophonyRoasterCorpus.cases.length,
  );
  assert.ok(
    cacophonyRoasterCorpus.cases.some((entry) => entry.expectation === "accept"),
  );
  assert.ok(
    cacophonyRoasterCorpus.cases.some((entry) => entry.expectation === "reject"),
  );
});

function structuralAtlasPage(
  path: string,
  id: string,
  type: string,
  title: string,
  body: string,
) {
  return Object.freeze({
    content: [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      "  local-atlas-schema: 1.0.0",
      `  id: ${id}`,
      `  type: ${type}`,
      `  title: ${title}`,
      '  created-at: "2026-08-24T00:00:00Z"',
      '  updated-at: "2026-08-24T00:00:00Z"',
      "  created-by: { kind: human, name: Fixture Maintainer }",
      "  updated-by: { kind: human, name: Fixture Maintainer }",
      "  tags: []",
      "atlas: {}",
      "---",
      body,
    ].join("\n"),
    path,
  });
}

const structuralRoot = structuralAtlasPage(
  ".atlas/index.md",
  "anchor:root",
  "anchor",
  "Root",
  "# Root\n",
);

// Builds a page carrying one extra SDK-owned key this SDK does not
// recognize, so the sdk-unrecognized-field corpus case can prove both that
// the page still parses and that the field survives a round trip, rather
// than only asserting a Finding code in isolation.
function structuralAtlasPageWithSdkField(
  path: string,
  id: string,
  field: string,
  value: string,
) {
  const withoutField = structuralAtlasPage(path, id, "concept", "Page", "# Page\n");
  return Object.freeze({
    content: withoutField.content.replace(
      "  title: Page",
      `  title: Page\n  ${field}: ${value}`,
    ),
    path,
  });
}

function adversarialCaptured(path: string, content: string): CapturedAtlasFile {
  return { bytes: adversarialEncoder.encode(content), path };
}

function adversarialGit(repository: string, args: readonly string[]): void {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function createAdversarialAtlasRepository(repository: string): void {
  rmSync(repository, { force: true, recursive: true });
  mkdirSync(repository, { recursive: true });
  adversarialGit(repository, ["init", "-b", "main"]);
  adversarialGit(repository, ["config", "user.name", "Fixture"]);
  adversarialGit(repository, ["config", "user.email", "fixture@example.invalid"]);
  cpSync(
    resolve(ROOT, "tests", "fixtures", "complete-atlas", ".atlas"),
    resolve(repository, ".atlas"),
    { recursive: true },
  );
  writeFileSync(resolve(repository, "README.md"), "# host\n", "utf8");
  adversarialGit(repository, ["add", ".atlas", "README.md"]);
  adversarialGit(repository, ["commit", "-m", "Initial Atlas"]);
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

for (const entry of cacophonyRoasterCorpus.cases) {
  test(`adversarial cacophony-roasters corpus: ${entry.name}`, () => {
    executedCases += 1;
    assert.equal(entry.gate, "cacophony-roasters");
    if (entry.kind === "eligible-roster") {
      const roasters = buildRoasterContracts(
        buildContracts(new LocalSource(ROOT), { verifyGenerated: false }),
      );
      const names = Object.values(roasters)
        .map((roaster) => roaster.name)
        .sort();
      assert.deepEqual(names, [...entry.expectedRoasters].sort());
      for (const excluded of entry.excludedRoasters) {
        assert.equal(names.includes(excluded), false);
      }
      return;
    }
    if (entry.kind === "roaster-fields-distinct") {
      const roasters = buildRoasterContracts(
        buildContracts(new LocalSource(ROOT), { verifyGenerated: false }),
      );
      for (const roaster of Object.values(roasters)) {
        const description = /^description: (.+)$/m.exec(roaster.instructionsFile)?.[1];
        const purpose = /^purpose: (.+)$/m.exec(roaster.instructionsFile)?.[1];
        const roastLens = /^roast-lens: (.+)$/m.exec(roaster.agentFile)?.[1];
        assert.ok(description);
        assert.ok(purpose);
        assert.ok(roastLens);
        assert.equal(new Set([description, purpose, roastLens]).size, 3);
      }
      return;
    }
    if (entry.kind === "reserved-name") {
      assert.throws(
        () => assertRoasterName(entry.nameUnderTest),
        new RegExp(entry.messageIncludes, "u"),
      );
      return;
    }
    if (entry.kind === "unexpected-path") {
      const roasters = buildRoasterContracts(
        buildContracts(new LocalSource(ROOT), { verifyGenerated: false }),
      );
      assert.throws(
        () =>
          validateRoasterContracts(
            new OverlayAtlasSource(new LocalSource(ROOT), {
              [entry.path]: "---\nname: rogue-roaster\n---\n",
            }),
            roasters,
          ),
        new RegExp(entry.messageIncludes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      );
      return;
    }
    if (entry.kind === "known-cleanup") {
      const workspace = resolve(ROOT, ".test-workspaces", `adversarial-${entry.name}`);
      rmSync(workspace, { force: true, recursive: true });
      try {
        cpSync(resolve(ROOT, ".cacophony"), resolve(workspace, ".cacophony"), {
          recursive: true,
        });
        mkdirSync(resolve(workspace, "agents", `${entry.agent}-roaster`), {
          recursive: true,
        });
        writeFileSync(
          resolve(workspace, "agents", `${entry.agent}-roaster.agent.md`),
          `---\nname: ${entry.agent}-roaster\n---\n`,
        );
        writeFileSync(
          resolve(workspace, "agents", `${entry.agent}-roaster`, "directive.md"),
          "retired generated output\n",
        );
        commandSync(workspace);
        const source = new LocalSource(workspace);
        assert.throws(
          () => source.readText(`agents/${entry.agent}-roaster.agent.md`),
          /regular file/,
        );
        assert.deepEqual(source.listFiles(`agents/${entry.agent}-roaster`), []);
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
      return;
    }
    if (entry.kind === "missing-lens" || entry.kind === "misplaced-lens") {
      const contracts = buildContracts(new LocalSource(ROOT), {
        verifyGenerated: false,
      });
      const value = contracts[entry.agent];
      assert.ok(value);
      const lensBlock = /\n## Roast lens\n\n[^\n]+\n/u.exec(value.directive.body)?.[0];
      assert.ok(lensBlock);
      const withoutLens = value.directive.body.replace(lensBlock, "\n");
      const body =
        entry.kind === "missing-lens"
          ? withoutLens
          : withoutLens.replace("\n## Evidence", `${lensBlock}\n## Evidence`);
      const directive = {
        path: value.directive.path,
        metadata: value.directive.metadata,
        body,
      };
      assert.throws(
        () =>
          composeRoaster(
            new AgentContract({
              compatibilityAgent: value.compatibilityAgent,
              personaId: value.personaId,
              directiveIds: value.directiveIds,
              persona: value.persona,
              directives: [directive],
              composed: value.composed,
            }),
          ),
        new RegExp(entry.messageIncludes, "u"),
      );
      return;
    }
    assert.throws(
      () => validateRoasterTools(entry.tools),
      new RegExp(entry.messageIncludes, "u"),
    );
  });
}

for (const entry of structuralValidationCorpus.cases) {
  test(`adversarial structural-validation corpus: ${entry.name}`, () => {
    executedCases += 1;
    assert.equal(entry.gate, "structural-validation");
    if (entry.kind === "sdk-unrecognized-field") {
      const page = structuralAtlasPageWithSdkField(
        ".atlas/concepts/extended.md",
        "concept:extended",
        entry.field,
        entry.value,
      );
      const findings = validateAtlasStructure([structuralRoot, page]);
      assert.deepEqual(
        findings.map(({ code, path, severity }) => ({ code, path, severity })),
        [
          {
            code: "ATLAS_PAGE_SDK_FIELD_UNRECOGNIZED",
            path: page.path,
            severity: "warning",
          },
        ],
      );

      // The Finding alone would tolerate a serializer that silently drops the
      // field on rewrite. Round-tripping through the parser and serializer
      // proves the unrecognized key survives byte for byte instead.
      const [parsed] = parseAtlasPages([page]);
      assert.ok(parsed);
      const first = serializeAtlasPages([parsed]);
      const reparsed = parseAtlasPages(first);
      assert.deepEqual(reparsed[0]?.page, parsed.page);
      assert.deepEqual(serializeAtlasPages(reparsed), first);
      return;
    }
    const findings = validateAtlasStructure([
      structuralRoot,
      structuralAtlasPage(
        ".atlas/principles/principle.md",
        "principle:principle",
        "principle",
        "Principle",
        entry.body,
      ),
    ]);
    if (entry.expectation === "accept") {
      assert.deepEqual(findings, []);
      return;
    }
    assert.ok(
      findings.some((finding) => finding.code === entry.expectedCode),
      findings.map((finding) => finding.code).join(", "),
    );
  });
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
        captureAtlasHostDirectory(workspace, entry.budgets, (fd) => {
          const bytes = readFileSync(fd);
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
    if (entry.kind === "capture-security") {
      const workspace = resolve(
        ROOT,
        ".test-workspaces",
        "adversarial-atlas-cli-security",
      );
      rmSync(workspace, { force: true, recursive: true });
      mkdirSync(resolve(workspace, ".atlas"), { recursive: true });
      const outsidePath = resolve(workspace, entry.outsideFile.path);
      writeFileSync(outsidePath, entry.outsideFile.text);
      const entryAbsolutePath = resolve(workspace, entry.entryPath);
      mkdirSync(dirname(entryAbsolutePath), { recursive: true });
      try {
        if (entry.scenario === "hardlink") {
          linkSync(outsidePath, entryAbsolutePath);
          assert.throws(
            () => captureAtlasHostDirectory(workspace, lintCommandCaptureBudgets),
            new RegExp(entry.expectedMessage, "u"),
          );
          return;
        }
        // symlink-swap: the entry starts as a genuine regular file so the
        // capture opens and fstats the real inode; the injected readFile
        // hook then simulates an attacker racing in a symlink to an
        // out-of-tree secret at the exact same path *after* that open, and
        // before the descriptor is read. A descriptor-bound read is immune
        // to this because it never re-resolves the path.
        writeFileSync(entryAbsolutePath, entry.originalText);
        const captured = captureAtlasHostDirectory(
          workspace,
          lintCommandCaptureBudgets,
          (fd) => {
            rmSync(entryAbsolutePath, { force: true });
            symlinkSync(outsidePath, entryAbsolutePath);
            return readFileSync(fd);
          },
        );
        assert.equal(captured.length, 1);
        assert.equal(
          Buffer.from(captured[0]?.bytes ?? new Uint8Array()).toString("utf8"),
          entry.originalText,
        );
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

    const workspace = resolve(
      ROOT,
      ".test-workspaces",
      "adversarial-atlas-cli-command",
      entry.name.replace(/[^a-z0-9]+/giu, "-"),
    );
    rmSync(workspace, { force: true, recursive: true });
    mkdirSync(workspace, { recursive: true });
    const arguments_ = [...entry.arguments];
    if (entry.fixtureAtlasHostRepository === true) {
      const repository = resolve(workspace, "repository");
      createAdversarialAtlasRepository(repository);
      for (const [index, argument] of arguments_.entries()) {
        if (argument === "{atlasHostDirectory}") arguments_[index] = repository;
      }
    }
    if (entry.generatedExploreAtlasOverFileBudget === true) {
      const repository = resolve(workspace, "repository");
      createAdversarialAtlasRepository(repository);
      mkdirSync(resolve(repository, ".atlas", "many"), { recursive: true });
      for (let index = 0; index <= exploreCommandBudgets.maxFiles; index += 1) {
        writeFileSync(resolve(repository, ".atlas", "many", `${String(index)}.md`), "");
      }
      adversarialGit(repository, ["add", ".atlas/many"]);
      adversarialGit(repository, ["commit", "-m", "Add many Atlas files"]);
      for (const [index, argument] of arguments_.entries()) {
        if (argument === "{atlasHostDirectory}") arguments_[index] = repository;
      }
    }
    if (entry.generatedOversizedExploreQuery === true) {
      for (const [index, argument] of arguments_.entries()) {
        if (argument === "{oversizedExploreQuery}") {
          arguments_[index] = "x".repeat(exploreCommandBudgets.maxQueryCharacters + 1);
        }
      }
    }
    if (entry.generatedOversizedIngestRequest === true) {
      const requestPath = resolve(workspace, "oversized-request.json");
      writeFileSync(
        requestPath,
        `{"padding":"${"x".repeat(ingestCommandInputBudgets.maxFileBytes)}"}`,
        "utf8",
      );
      for (const [index, argument] of arguments_.entries()) {
        if (argument === "{oversizedIngestRequest}") arguments_[index] = requestPath;
      }
    }

    const command = spawnSync(
      process.execPath,
      [resolve(ROOT, "scripts", "atlas.ts"), ...arguments_],
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

function actualLintStamp(): Readonly<Record<string, unknown>> {
  const state = initialAtlasInitializationWorkflowState({
    baseSnapshotDigest: "base-digest",
    proposalBranch: "atlas-initialization-adversarial",
    targetBranch: "main",
    targetHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const commit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const result = runAtlasInitializationWorkflow(state, {
    commitProposal: () => ({ commit, receipt: commit }),
    createProposalWorktree: () => ({ receipt: "created" }),
    currentBaseSnapshotDigest: () => state.baseSnapshotDigest,
    currentTargetHead: () => state.targetHead,
    lintProposal: () => ({
      lint: runLintOperation(atlasInitializationFiles(state), {
        maxFileBytes: 4096,
        maxTotalBytes: 65536,
      }),
      receipt: commit,
    }),
    writeChangeSet: () => ({ receipt: "written" }),
  });
  assert.equal(result.completion, "completed");
  assert.ok(result.payload.atlasReadinessReport !== undefined);
  return { ...result.payload.atlasReadinessReport.lintStamp };
}

function lintStampShapeExtraKeys(
  stamp: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
): readonly string[] {
  const allowed = new Set(allowedKeys);
  return Object.keys(stamp).filter((key) => !allowed.has(key));
}

function stampWithExtraKeys(
  extraKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    "lint-stamp-schema": "1.0.0",
    atlasCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evidenceRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...Object.fromEntries(extraKeys.map((key) => [key, "fabricated"])),
  });
}

function lintStampLiteralFields(
  source: string,
  fields: readonly string[],
): readonly string[] {
  const literalFields: string[] = [];
  for (const field of fields) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const literalAssignment = new RegExp(
      `(?:^|[^A-Za-z0-9_$])${escaped}\\s*:\\s*(?:\\r?\\n\\s*)?(?:["'\`]|\\[)`,
      "u",
    );
    if (literalAssignment.test(source)) literalFields.push(field);
  }
  return literalFields;
}

for (const entry of lintStampCorpus.cases) {
  test(`adversarial lint-stamp corpus: ${entry.name}`, () => {
    executedCases += 1;
    assert.equal(entry.gate, "lint-stamp");
    if (entry.kind === "emitted-key-shape") {
      const stamp =
        entry.expectation === "accept"
          ? actualLintStamp()
          : stampWithExtraKeys(entry.extraKeys ?? []);
      const extraKeys = lintStampShapeExtraKeys(stamp, lintStampCorpus.allowedKeys);
      if (entry.expectation === "accept") {
        assert.deepEqual(Object.keys(stamp), lintStampCorpus.allowedKeys);
        assert.deepEqual(extraKeys, []);
        return;
      }
      assert.deepEqual(extraKeys, entry.extraKeys);
      return;
    }
    const source =
      entry.kind === "source-bypass-emitted-shape"
        ? entry.input.source
        : (entry.input?.source ??
          readFileSync(resolve(ROOT, entry.sourcePath ?? ""), "utf8"));
    const literalFields = lintStampLiteralFields(source, lintStampCorpus.literalFields);
    if (entry.kind === "source-bypass-emitted-shape") {
      assert.deepEqual(literalFields, entry.inlineLiteralFields);
      assert.deepEqual(
        lintStampShapeExtraKeys(
          stampWithExtraKeys(entry.extraKeys),
          lintStampCorpus.allowedKeys,
        ),
        entry.extraKeys,
      );
      return;
    }
    if (entry.expectation === "accept") {
      assert.deepEqual(literalFields, []);
      return;
    }
    assert.deepEqual(literalFields, entry.literalFields);
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
      (entry.input.unboundTerms ?? []).map((term) => ({
        reason: "adversarial corpus",
        term,
      })),
      glossary(entry.input.glossaryAvoidance, entry.input.glossaryTerm),
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

const ingestEncoder = new TextEncoder();

function ingestPage(
  path: string,
  id: string,
  type: string,
  title: string,
  atlasBlock: string,
  body: string,
): CapturedAtlasFile {
  return {
    bytes: ingestEncoder.encode(
      [
        "---",
        "sdk:",
        "  atlas-sdk-schema: 1.0.0",
        '  created-at: "2026-08-17T00:00:00Z"',
        "  created-by:",
        "    kind: human",
        "    name: Fixture Author",
        `  id: ${id}`,
        "  local-atlas-schema: 1.0.0",
        "  tags: []",
        `  title: ${title}`,
        `  type: ${type}`,
        '  updated-at: "2026-08-17T00:00:00Z"',
        "  updated-by:",
        "    kind: human",
        "    name: Fixture Author",
        atlasBlock,
        "---",
        "",
        body,
      ].join("\n"),
    ),
    path,
  };
}

const ingestRoot = ingestPage(
  ".atlas/index.md",
  "anchor:root",
  "anchor",
  "Home",
  "atlas: {}",
  "# Home\n",
);
const ingestChangelog: CapturedAtlasFile = {
  bytes: ingestEncoder.encode(
    "# Changelog\n\n## 2026-08-17\n\n- Existing ingest entry.\n",
  ),
  path: ".atlas/CHANGELOG.md",
};
const ingestPrinciple = ingestPage(
  ".atlas/principles/determinism.md",
  "principle:determinism",
  "principle",
  "Determinism",
  "atlas: {}",
  "# Determinism\n\n## Active truths\n\n- `truth:no-model` Atlas SDK never invokes a model.\n\n## Amendments\n\n### 1 - 2026-08-17\n\nAdded `truth:no-model`.\n",
);

const ingestSourceContent =
  "Atlas SDK is a deterministic library. The Lint gate runs with no network access.";

// A curated page the Home Atlas already holds, so a crawled identity that reuses
// it would overwrite it and a crawled Edge over its pair would duplicate it.
const ingestExistingConcept = ingestPage(
  ".atlas/concepts/determinism.md",
  "concept:determinism",
  "concept",
  "Determinism",
  "atlas:\n  confidence: reviewed\n  evidence:\n    - .atlas/sources/readme",
  "# Determinism\n\nCurated understanding.\n",
);
const ingestExistingPairConcept = ingestPage(
  ".atlas/concepts/home.md",
  "concept:home",
  "concept",
  "Home Concept",
  "atlas:\n  confidence: reviewed\n  evidence:\n    - .atlas/sources/readme",
  "# Home Concept\n\nCurated understanding.\n",
);
const ingestExistingEdge = ingestPage(
  ".atlas/edges/home.md",
  "edge:home",
  "edge",
  "Home Edge",
  "atlas:\n  from: anchor:root\n  semantics:\n    - covers\n  to: concept:home",
  "# Home Edge\n\nExisting relationship.\n",
);
const ingestExistingPolicy = ingestPage(
  ".atlas/types/policy/publication.md",
  "policy:publication",
  "policy",
  "Publication Policy",
  "atlas:\n  scope: publication\n  evaluation: deterministic\n  consequence: block-operation",
  "# Publication Policy\n\nGoverns publication.\n",
);

function ingestWorkflowState(): AtlasIngestWorkflowState {
  return Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    baseSnapshotDigest: "base-digest",
    effectReceipts: Object.freeze([]),
    operationId: "ingest-op-81",
    proposalBranch: "feat/issue-81-ingest",
    targetBranch: "main",
    targetHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
}

interface IngestConceptOverrides {
  readonly citations?: readonly {
    readonly sourceClaim: string;
    readonly sourceId: string;
  }[];
  readonly claim?: string;
  readonly contradiction?: {
    readonly acceptedBy?: string;
    readonly atlasPolicyId?: string;
    readonly principleTruthId?: string;
  };
  readonly id?: string;
  readonly locator?: string;
  readonly title?: string;
}

function ingestConcept(overrides: IngestConceptOverrides = {}) {
  return {
    citations: overrides.citations ?? [
      {
        sourceClaim: "Atlas SDK is a deterministic library.",
        sourceId: "source:readme",
      },
    ],
    claim: overrides.claim ?? "Atlas SDK is a deterministic library.",
    id: overrides.id ?? "concept:determinism",
    locator: overrides.locator ?? "docs/readme.md",
    title: overrides.title ?? "Determinism",
    ...(overrides.contradiction === undefined
      ? {}
      : { contradiction: overrides.contradiction }),
  };
}

function ingestEdge(
  overrides: Partial<AtlasIngestCandidateEdge> = {},
): AtlasIngestCandidateEdge {
  return {
    citations: [
      {
        sourceClaim: "The Lint gate runs with no network access.",
        sourceId: "source:readme",
      },
    ],
    context: "Entering the Home Atlas leads to the determinism Concept.",
    from: "anchor:root",
    id: "edge:root-covers-determinism",
    semantics: ["covers"],
    title: "Root Covers Determinism",
    to: "concept:determinism",
    ...overrides,
  };
}

function ingestSource(
  overrides: Partial<AtlasIngestCandidateGraph["sources"][number]> = {},
) {
  return {
    authority: "official" as const,
    content: ingestSourceContent,
    id: "source:readme",
    locator: "docs/readme.md",
    refreshWindowDays: 30,
    revisionTime: "2026-08-20T00:00:00Z",
    title: "Readme",
    ...overrides,
  };
}

function ingestBaselineGraph(): AtlasIngestCandidateGraph {
  return {
    "candidate-graph-schema": "1.0.0",
    concepts: [ingestConcept()],
    disputes: [],
    edges: [ingestEdge()],
    sources: [ingestSource()],
  };
}

function ingestScope(): AtlasIngestRequest["scope"] {
  return {
    "ingest-scope-schema": "1.0.0",
    approvedAt: "2026-08-22T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    asOf: "2026-08-22T00:00:00Z",
    authority: "official",
    entryPoint: "docs",
    excludedPaths: ["docs/private"],
    freshnessWindowDays: 30,
    includedPaths: ["docs"],
    maxDepth: 4,
    sourceId: "source:readme",
  };
}

interface IngestScenario {
  readonly baseFiles: readonly CapturedAtlasFile[];
  readonly request: AtlasIngestRequest;
  readonly workflowState: AtlasIngestWorkflowState;
}

function ingestTieGraph(): AtlasIngestCandidateGraph {
  return {
    "candidate-graph-schema": "1.0.0",
    concepts: [
      ingestConcept({
        citations: [{ sourceClaim: "Left claim.", sourceId: "source:left" }],
        claim: "Left claim.",
        id: "concept:left",
        title: "Left",
      }),
      ingestConcept({
        citations: [{ sourceClaim: "Right claim.", sourceId: "source:right" }],
        claim: "Right claim.",
        id: "concept:right",
        title: "Right",
      }),
    ],
    disputes: [{ leftConceptId: "concept:left", rightConceptId: "concept:right" }],
    edges: [
      ingestEdge({
        citations: [{ sourceClaim: "Left claim.", sourceId: "source:left" }],
        id: "edge:left",
        to: "concept:left",
      }),
      ingestEdge({
        citations: [{ sourceClaim: "Right claim.", sourceId: "source:right" }],
        id: "edge:right",
        to: "concept:right",
      }),
    ],
    sources: [
      ingestSource({
        content: "Left claim.",
        id: "source:left",
        refreshWindowDays: 3650,
        revisionTime: "2026-08-05T00:00:00Z",
        title: "Left Source",
      }),
      ingestSource({
        content: "Right claim.",
        id: "source:right",
        refreshWindowDays: 3650,
        revisionTime: "2026-08-05T00:00:00Z",
        title: "Right Source",
      }),
    ],
  };
}

function ingestMutatedGraph(mutation: string): AtlasIngestCandidateGraph {
  if (mutation === "citation-quote-not-in-source") {
    return {
      ...ingestBaselineGraph(),
      concepts: [
        ingestConcept({
          citations: [
            {
              sourceClaim: "This never appears in the source.",
              sourceId: "source:readme",
            },
          ],
        }),
      ],
    };
  }
  if (mutation === "citation-source-absent") {
    return {
      ...ingestBaselineGraph(),
      concepts: [
        ingestConcept({
          citations: [
            {
              sourceClaim: "Atlas SDK is a deterministic library.",
              sourceId: "source:ghost",
            },
          ],
        }),
      ],
    };
  }
  if (mutation === "concept-without-edge") {
    return { ...ingestBaselineGraph(), edges: [] };
  }
  if (mutation === "concept-uncited") {
    return {
      ...ingestBaselineGraph(),
      concepts: [ingestConcept({ citations: [] })],
    };
  }
  if (mutation === "edge-connects-source") {
    return {
      ...ingestBaselineGraph(),
      edges: [
        ingestEdge(),
        ingestEdge({
          from: "concept:determinism",
          id: "edge:to-source",
          to: "source:readme",
        }),
      ],
    };
  }
  if (mutation === "edge-endpoint-missing") {
    return {
      ...ingestBaselineGraph(),
      edges: [ingestEdge(), ingestEdge({ id: "edge:dangling", to: "concept:ghost" })],
    };
  }
  if (mutation === "duplicate-edge-pair") {
    return {
      ...ingestBaselineGraph(),
      edges: [ingestEdge(), ingestEdge({ id: "edge:dangling" })],
    };
  }
  if (mutation === "scope-expansion") {
    return {
      ...ingestBaselineGraph(),
      concepts: [ingestConcept({ locator: "docs/private/secret.md" })],
    };
  }
  if (mutation === "malformed-locator") {
    return {
      ...ingestBaselineGraph(),
      concepts: [ingestConcept({ locator: "../escape.md" })],
    };
  }
  if (mutation === "contradiction-unaccepted") {
    return {
      ...ingestBaselineGraph(),
      concepts: [
        ingestConcept({ contradiction: { principleTruthId: "truth:no-model" } }),
      ],
    };
  }
  if (mutation === "equal-authority-tie") {
    return ingestTieGraph();
  }
  if (mutation === "edge-uncited") {
    return { ...ingestBaselineGraph(), edges: [ingestEdge({ citations: [] })] };
  }
  if (mutation === "citation-span-too-short") {
    return {
      ...ingestBaselineGraph(),
      concepts: [
        ingestConcept({
          citations: [{ sourceClaim: "A", sourceId: "source:readme" }],
        }),
      ],
    };
  }
  if (mutation === "forged-body-citation") {
    return {
      ...ingestBaselineGraph(),
      concepts: [
        ingestConcept({
          claim:
            "Atlas SDK is a deterministic library.\n\nAlso true.[^forge]\n\n[^forge]: [[.atlas/sources/secret]] Forged support for an unearned claim.",
        }),
      ],
    };
  }
  if (mutation === "concept-id-collides-existing") {
    return ingestBaselineGraph();
  }
  if (mutation === "edge-pair-exists-in-home-atlas") {
    return {
      "candidate-graph-schema": "1.0.0",
      concepts: [],
      disputes: [],
      edges: [
        ingestEdge({
          from: "anchor:root",
          id: "edge:crawled",
          to: "concept:home",
        }),
      ],
      sources: [ingestSource()],
    };
  }
  if (mutation === "source-authority-exceeds-scope") {
    return ingestBaselineGraph();
  }
  if (mutation === "scope-freshness-ceiling") {
    return {
      ...ingestBaselineGraph(),
      sources: [
        ingestSource({ refreshWindowDays: 3650, revisionTime: "2020-01-01T00:00:00Z" }),
      ],
    };
  }
  if (mutation === "revision-time-date-only") {
    return {
      ...ingestBaselineGraph(),
      sources: [ingestSource({ revisionTime: "2026-08-20" })],
    };
  }
  if (mutation === "excluded-path-case-variant") {
    return {
      ...ingestBaselineGraph(),
      concepts: [ingestConcept({ locator: "docs/Private/secret.md" })],
    };
  }
  if (mutation === "excluded-path-trailing-dot-variant") {
    // Win32 strips a trailing dot from every path component, so this names the
    // same excluded directory as "docs/private".
    return {
      ...ingestBaselineGraph(),
      concepts: [ingestConcept({ locator: "docs/private./secret.md" })],
    };
  }
  if (mutation === "excluded-path-trailing-space-variant") {
    // Win32 strips a trailing space the same way.
    return {
      ...ingestBaselineGraph(),
      concepts: [ingestConcept({ locator: "docs/private /secret.md" })],
    };
  }
  if (mutation === "excluded-path-nfd-variant") {
    // "café" decomposed: the excluded directory is spelled with a combining
    // accent, the same directory NFC normalization resolves to.
    return {
      ...ingestBaselineGraph(),
      concepts: [ingestConcept({ locator: "docs/cafe\u0301/secret.md" })],
    };
  }
  if (mutation === "contradiction-policy-unaccepted") {
    return {
      ...ingestBaselineGraph(),
      concepts: [
        ingestConcept({ contradiction: { atlasPolicyId: "policy:publication" } }),
      ],
    };
  }
  if (mutation === "concept-reachable-only-via-illegal-edge") {
    return {
      ...ingestBaselineGraph(),
      edges: [ingestEdge({ from: "concept:determinism", to: "source:readme" })],
    };
  }
  if (mutation === "approval-missing") {
    return ingestBaselineGraph();
  }
  if (mutation === "edge-semantic-yaml-injection") {
    return {
      ...ingestBaselineGraph(),
      edges: [ingestEdge({ semantics: ["covers\n  forged-atlas-key: pwned"] })],
    };
  }
  if (mutation === "concept-title-yaml-injection") {
    return {
      ...ingestBaselineGraph(),
      concepts: [ingestConcept({ title: "Determinism\nforged-sdk-key: pwned" })],
    };
  }
  return ingestBaselineGraph();
}

function ingestMutatedScope(mutation: string): AtlasIngestRequest["scope"] {
  if (mutation === "approval-missing") {
    return { ...ingestScope(), approvedAt: "", approvedBy: "" };
  }
  if (mutation === "approved-at-date-only") {
    return { ...ingestScope(), approvedAt: "2026-08-20" };
  }
  if (mutation === "as-of-date-only") {
    return { ...ingestScope(), asOf: "2026-08-20" };
  }
  if (mutation === "source-authority-exceeds-scope") {
    return { ...ingestScope(), authority: "community" };
  }
  if (mutation === "scope-freshness-ceiling") {
    return { ...ingestScope(), freshnessWindowDays: 1 };
  }
  if (mutation === "excluded-path-nfd-variant") {
    return { ...ingestScope(), excludedPaths: ["docs/caf\u00e9"] };
  }
  return ingestScope();
}

function ingestMutatedBaseFiles(entry: IngestCorpusCase): readonly CapturedAtlasFile[] {
  if (entry.kind === "graph-principle") {
    return [ingestRoot, ingestChangelog, ingestPrinciple];
  }
  if (entry.kind === "graph-policy") {
    return [ingestRoot, ingestChangelog, ingestExistingPolicy];
  }
  if (entry.mutation === "concept-id-collides-existing") {
    return [ingestRoot, ingestChangelog, ingestExistingConcept];
  }
  if (entry.mutation === "edge-pair-exists-in-home-atlas") {
    return [ingestRoot, ingestChangelog, ingestExistingPairConcept, ingestExistingEdge];
  }
  return [ingestRoot, ingestChangelog];
}

function ingestScenario(entry: IngestCorpusCase): IngestScenario {
  const workflowState = ingestWorkflowState();
  const graph = ingestMutatedGraph(entry.mutation);
  const request: AtlasIngestRequest = {
    "ingest-request-schema": "1.0.0",
    candidateGraph: graph,
    scope: ingestMutatedScope(entry.mutation),
  };
  const baseFiles = ingestMutatedBaseFiles(entry);
  const resumeState =
    entry.mutation === "forged-resume-receipt"
      ? Object.freeze({
          ...workflowState,
          effectReceipts: Object.freeze([
            { effect: "create-proposal-worktree" as const, receipt: "created" },
            {
              changeSetDigest: "forged",
              effect: "write-change-set" as const,
              receipt: "written",
              writtenTree: "written",
            },
          ]),
        })
      : workflowState;
  return { baseFiles, request, workflowState: resumeState };
}

function ingestRuntime(scenario: IngestScenario): AtlasIngestRuntime {
  let captured: AtlasIngestChangeSet | undefined;
  const commit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  return {
    commitProposal: () => ({ commit, receipt: commit }),
    createProposalWorktree: () => ({ receipt: "created" }),
    currentBaseSnapshotDigest: () => scenario.workflowState.baseSnapshotDigest,
    currentTargetHead: () => scenario.workflowState.targetHead,
    existingAtlasFiles: () => scenario.baseFiles,
    lintProposal: () => {
      const changeSet =
        captured ?? reconcileCandidateGraph(scenario.workflowState, scenario.request);
      const byPath = new Map(scenario.baseFiles.map((file) => [file.path, file]));
      for (const change of changeSet.changes) {
        byPath.set(change.path, {
          bytes: ingestEncoder.encode(change.content),
          path: change.path,
        });
      }
      return {
        lint: runLintOperation([...byPath.values()], {
          maxFileBytes: 8192,
          maxTotalBytes: 262_144,
        }),
        receipt: commit,
      };
    },
    writeChangeSet: (changeSet: AtlasIngestChangeSet) => {
      captured = changeSet;
      return { receipt: "written" };
    },
  };
}

function ingestGraphFindings(
  entry: IngestCorpusCase,
  scenario: IngestScenario,
): readonly Finding[] {
  if (entry.kind === "workflow") {
    return runAtlasIngestWorkflow(
      scenario.workflowState,
      scenario.request,
      ingestRuntime(scenario),
    ).handoff.validationState.findings;
  }
  if (entry.kind === "change-set") {
    // A crawled path carrying a control character would let the digest framing
    // reproduce a different change set; the change-set validator must reject it.
    const changeSet = reconcileCandidateGraph(
      scenario.workflowState,
      scenario.request,
      scenario.baseFiles,
    );
    const forged: AtlasIngestChange = {
      content: "forged",
      path: `.atlas/a.md\u0000${String("forged".length)}\u0000.atlas/b.md`,
    };
    return validateAtlasIngestChangeSet(scenario.workflowState, {
      ...changeSet,
      changes: [...changeSet.changes, forged],
    });
  }
  return validateCandidateGraph(scenario.request, scenario.baseFiles);
}

function ingestEmittedPage(
  scenario: IngestScenario,
  path: string,
): ReturnType<typeof parseAtlasPage> {
  const changeSet = reconcileCandidateGraph(
    scenario.workflowState,
    scenario.request,
    scenario.baseFiles,
  );
  const change = changeSet.changes.find((entry) => entry.path === path);
  assert.ok(change !== undefined, `expected an emitted page at ${path}`);
  return parseAtlasPage({ content: change.content, path });
}

function assertIngestEmission(entry: IngestCorpusCase, scenario: IngestScenario): void {
  if (entry.mutation === "edge-semantic-yaml-injection") {
    const parsed = ingestEmittedPage(
      scenario,
      ".atlas/edges/root-covers-determinism.md",
    );
    assert.ok(!(parsed instanceof Error), "edge page must parse");
    const atlas = (
      parsed as { readonly page: { readonly atlas: Record<string, unknown> } }
    ).page.atlas;
    assert.deepEqual(atlas["semantics"], ["covers\n  forged-atlas-key: pwned"]);
    assert.equal("forged-atlas-key" in atlas, false);
    return;
  }
  if (entry.mutation === "concept-title-yaml-injection") {
    const parsed = ingestEmittedPage(scenario, ".atlas/concepts/determinism.md");
    assert.ok(!(parsed instanceof Error), "concept page must parse");
    const sdk = (parsed as { readonly page: { readonly sdk: Record<string, unknown> } })
      .page.sdk;
    assert.equal(sdk["title"], "Determinism\nforged-sdk-key: pwned");
    assert.equal("forged-sdk-key" in sdk, false);
    return;
  }
  if (entry.mutation === "source-revision-digest-is-sha256") {
    const parsed = ingestEmittedPage(scenario, ".atlas/sources/readme.md");
    assert.ok(!(parsed instanceof Error), "source page must parse");
    const atlas = (
      parsed as { readonly page: { readonly atlas: Record<string, unknown> } }
    ).page.atlas;
    assert.match(String(atlas["revision"]), /^[0-9a-f]{64}$/u);
    return;
  }
  if (entry.mutation === "changelog-preserves-existing-history") {
    const changeSet = reconcileCandidateGraph(
      scenario.workflowState,
      scenario.request,
      scenario.baseFiles,
    );
    const changelogChange = changeSet.changes.find(
      (change) => change.path === ".atlas/CHANGELOG.md",
    );
    assert.ok(changelogChange);
    assert.match(changelogChange.content, /- Existing ingest entry\./u);
    assert.match(changelogChange.content, /- ingest-op-81: Ingested source:readme/u);
    assert.ok(
      changelogChange.content.indexOf("Existing ingest entry") <
        changelogChange.content.indexOf("ingest-op-81"),
    );
    return;
  }
  assert.fail(`unhandled emission mutation ${entry.mutation}`);
}

function assertIngestSourceReuse(): void {
  // The digest and safe-branch primitives are single-sourced: the sibling
  // proposal operations import them rather than re-defining a forgeable copy.
  const ingest = readFileSync(
    resolve(ROOT, "src", "operations", "ingest_operation.ts"),
    "utf8",
  );
  const governance = readFileSync(
    resolve(ROOT, "src", "operations", "governance_operation.ts"),
    "utf8",
  );
  const initialize = readFileSync(
    resolve(ROOT, "src", "operations", "initialize_operation.ts"),
    "utf8",
  );
  for (const source of [ingest, governance]) {
    assert.ok(source.includes('from "./operation_support.ts"'));
    assert.equal(/function changeSetDigest\b/u.test(source), false);
    assert.equal(/hash \^= BigInt/u.test(source), false);
  }
  for (const source of [ingest, governance, initialize]) {
    assert.equal(/function isSafeGitBranchName\b/u.test(source), false);
  }
}

test("the adversarial ingest corpus is structurally valid", () => {
  assert.match(ingestCorpus.reviewResolutionRule, /review finding/u);
  assert.equal(ingestCorpus.schema, 1);
  assert.equal(
    new Set(ingestCorpus.cases.map((entry) => entry.name)).size,
    ingestCorpus.cases.length,
  );
  assert.ok(ingestCorpus.cases.some((entry) => entry.expectation === "accept"));
  assert.ok(ingestCorpus.cases.some((entry) => entry.expectation === "reject"));
});

for (const entry of ingestCorpus.cases) {
  test(`adversarial ingest corpus: ${entry.name}`, () => {
    executedCases += 1;
    assert.equal(entry.gate, "ingest");
    const scenario = ingestScenario(entry);

    if (entry.kind === "emission") {
      assertIngestEmission(entry, scenario);
      return;
    }
    if (entry.kind === "source-reuse") {
      assertIngestSourceReuse();
      return;
    }

    if (entry.expectation === "accept") {
      assert.deepEqual(
        validateCandidateGraph(scenario.request, scenario.baseFiles),
        [],
      );
      const result = runAtlasIngestWorkflow(
        scenario.workflowState,
        scenario.request,
        ingestRuntime(scenario),
      );
      assert.equal(result.completion, "completed");
      return;
    }

    const findings = ingestGraphFindings(entry, scenario);
    const summary = findings.map((finding) => `${finding.code} ${finding.severity}`);
    const blocking = [
      ...new Set(
        findings
          .filter(
            (finding) =>
              finding.severity === "error" || finding.severity === "inconclusive",
          )
          .map((finding) => finding.code),
      ),
    ].sort();
    if (entry.expectedCodes !== undefined) {
      assert.deepEqual(
        blocking,
        [...entry.expectedCodes].sort(),
        `${entry.name} blocking mismatch: ${summary.join(", ")}`,
      );
      return;
    }
    const expected = entry.expectedCode as string;
    assert.ok(
      findings.some((finding) => finding.code === expected),
      `${entry.name} did not report ${expected}: ${summary.join(", ")}`,
    );
    const expectedIsBlocking = findings.some(
      (finding) =>
        finding.code === expected &&
        (finding.severity === "error" || finding.severity === "inconclusive"),
    );
    if (expectedIsBlocking) {
      assert.deepEqual(
        blocking,
        [expected],
        `${entry.name} is not otherwise-clean: ${summary.join(", ")}`,
      );
    } else {
      assert.deepEqual(
        blocking,
        [],
        `${entry.name} warning case has unexpected blocking Findings: ${summary.join(", ")}`,
      );
    }
  });
}
