import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import type { CoreArchetypeBindings } from "../src/domain/core_archetype.ts";
import { coreArchetypes } from "../src/domain/core_archetype.ts";
import { checkFinding, type Finding } from "../src/domain/finding.ts";
import {
  validateVocabularyAgreement,
  type VocabularyTextFile,
} from "../src/lint/validate_vocabulary_agreement.ts";
import {
  collectContracts,
  formatFinding,
  main,
  validateRepository,
} from "../scripts/vocabulary_agreement.ts";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(ROOT, "scripts", "vocabulary_agreement.ts");

const anchorBinding: CoreArchetypeBindings = Object.freeze({
  Anchor: Object.freeze({
    diagnosticStem: "ANCHOR",
    directory: "anchors",
    idPrefix: "anchor",
    pageType: "anchor",
  }),
});

const glossaryLines = [
  "# Atlas SDK",
  "",
  "## Language",
  "",
  "**Atlas SDK**:",
  "The framework through which an agent discovers connected knowledge domains.",
  "",
  "**Anchor**:",
  "A human-approved page through which an agent enters a region of knowledge.",
  "_Avoid_: Bonfire, Landmark",
  "",
  "**Explore**:",
  "The human-facing workflow for traversing knowledge.",
  "_Avoid_: Query, when naming the user-facing skill",
  "",
  "**Anchor**:",
  "A repeated definition keeps its first location.",
  "_Avoid_: Bonfire",
  "",
];

function glossary(lines: readonly string[] = glossaryLines): VocabularyTextFile {
  return { content: lines.join("\n"), path: "CONTEXT.md" };
}

function contract(content: string, path = "src/lint/example.ts"): VocabularyTextFile {
  return { content, path };
}

function validate(
  bindings: CoreArchetypeBindings,
  contracts: readonly VocabularyTextFile[],
  lines?: readonly string[],
): readonly Finding[] {
  const findings = validateVocabularyAgreement(bindings, glossary(lines), contracts);
  for (const finding of findings) assert.equal(checkFinding(finding), true);
  return findings;
}

function summarize(findings: readonly Finding[]): readonly string[] {
  return findings.map((finding) => `${finding.code} ${finding.message}`);
}

function scratchRepository(): string {
  const directory = join(
    ROOT,
    ".test-workspaces",
    `vocabulary-${String(process.pid)}-${randomUUID()}`,
  );
  mkdirSync(join(directory, "src", "lint"), { recursive: true });
  return directory;
}

test("Atlas SDK contracts and the glossary bind one vocabulary", () => {
  assert.deepEqual(validateRepository(ROOT), []);
  assert.ok(collectContracts(ROOT, "src").includes("src/domain/core_archetype.ts"));
  assert.deepEqual(
    collectContracts(ROOT, "src").toSorted((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    collectContracts(ROOT, "src"),
  );
});

test("a glossary rename that leaves the contracts behind names both sides", () => {
  const renamed = glossaryLines.map((line) =>
    line === "**Anchor**:" ? "**Waypoint**:" : line,
  );
  const findings = validate(anchorBinding, [], renamed);

  assert.deepEqual(findings, [
    {
      attribution: {
        checkId: "sdk-core.vocabulary-agreement",
        kind: "sdk-core",
        trusted: true,
      },
      code: "ATLAS_VOCABULARY_TERM_UNDEFINED",
      "finding-schema": "1.0.0",
      message:
        'Atlas SDK contracts bind the term "Anchor", which CONTEXT.md does not define.',
      path: "CONTEXT.md",
      severity: "error",
    },
  ]);

  const both = validate(
    {
      Waypoint: {
        diagnosticStem: "WAYPOINT",
        directory: "waypoints",
        idPrefix: "waypoint",
        pageType: "waypoint",
      },
      Beacon: {
        diagnosticStem: "BEACON",
        directory: "beacons",
        idPrefix: "beacon",
        pageType: "beacon",
      },
    },
    [],
  );

  assert.deepEqual(summarize(both), [
    'ATLAS_VOCABULARY_TERM_UNDEFINED Atlas SDK contracts bind the term "Beacon", which CONTEXT.md does not define.',
    'ATLAS_VOCABULARY_TERM_UNDEFINED Atlas SDK contracts bind the term "Waypoint", which CONTEXT.md does not define.',
  ]);
});

test("a contract rename that leaves the glossary behind names both sides", () => {
  const findings = validate(
    {
      Anchor: {
        diagnosticStem: "WAYPOINT",
        directory: "waypoints",
        idPrefix: "waypoint",
        pageType: "waypoint",
      },
    },
    [],
  );

  assert.deepEqual(summarize(findings), [
    'ATLAS_VOCABULARY_IDENTIFIER_MISMATCH Atlas SDK binds diagnostic code stem "WAYPOINT" to the term "Anchor", which requires "ANCHOR".',
    'ATLAS_VOCABULARY_IDENTIFIER_MISMATCH Atlas SDK binds page directory "waypoints" to the term "Anchor", which requires "anchors".',
    'ATLAS_VOCABULARY_IDENTIFIER_MISMATCH Atlas SDK binds page type "waypoint" to the term "Anchor", which requires "anchor".',
    'ATLAS_VOCABULARY_IDENTIFIER_MISMATCH Atlas SDK binds page-ID prefix "waypoint" to the term "Anchor", which requires "anchor".',
  ]);
  assert.deepEqual(findings[0]?.location, {
    end: { column: 12, line: 8 },
    start: { column: 1, line: 8 },
  });
});

test("a bound term the glossary avoids fails at its avoidance line", () => {
  const avoided = glossaryLines.map((line) =>
    line === "_Avoid_: Bonfire, Landmark" ? "_Avoid_: Anchor, Bonfire" : line,
  );
  const findings = validate(anchorBinding, [], avoided);

  assert.deepEqual(summarize(findings), [
    'ATLAS_VOCABULARY_TERM_AVOIDED Atlas SDK contracts bind the term "Anchor", which CONTEXT.md lists as an avoided term.',
  ]);
  assert.deepEqual(findings[0]?.location, {
    end: { column: 25, line: 10 },
    start: { column: 1, line: 10 },
  });
});

test("an avoided term used as a live identifier fails in every contract surface", () => {
  const findings = validate(anchorBinding, [
    contract(
      [
        'const directory = ".atlas/bonfires/";',
        'const code = "ATLAS_BONFIRE_MISSING";',
        'const id = "bonfire:root";',
        'const message = "Atlas SDK requires a Bonfire.";',
        "const template = `Atlas SDK rejects ${directory} the Landmark.`;",
      ].join("\n"),
    ),
  ]);

  assert.deepEqual(summarize(findings), [
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "bonfires" in an Atlas page directory name, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "BONFIRE" in the diagnostic code ATLAS_BONFIRE_MISSING, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "bonfire" in an Atlas page-ID prefix, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Bonfire" in a Finding message, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Landmark" in a Finding message, which CONTEXT.md lists as the avoided term "Landmark".',
  ]);
  assert.deepEqual(findings[0]?.location, {
    end: { column: 35, line: 1 },
    start: { column: 27, line: 1 },
  });
});

test("an identifier bound to no glossary term fails with its own diagnostic", () => {
  const findings = validate(anchorBinding, [
    contract(
      [
        "const pattern = /^\\.atlas\\/waypoints\\/.+\\.md$/u;",
        'const id = "waypoint:root";',
        'const code = "ATLAS_WAYPOINT_MISSING";',
        'const message = "Atlas SDK reads .atlas/Waypoints/ pages.";',
        'const qualifier = "ATLAS_WHEN_MISSING";',
      ].join("\n"),
    ),
  ]);

  assert.deepEqual(summarize(findings), [
    'ATLAS_VOCABULARY_IDENTIFIER_UNDECLARED Atlas SDK uses the identifier "waypoints" in an Atlas page directory name, which no CONTEXT.md term defines.',
    'ATLAS_VOCABULARY_IDENTIFIER_UNDECLARED Atlas SDK uses the identifier "waypoint" in an Atlas page-ID prefix, which no CONTEXT.md term defines.',
    'ATLAS_VOCABULARY_WORD_UNKNOWN Atlas SDK uses the word "WAYPOINT" in the diagnostic code ATLAS_WAYPOINT_MISSING, which no CONTEXT.md term defines.',
    'ATLAS_VOCABULARY_IDENTIFIER_UNDECLARED Atlas SDK uses the identifier "Waypoints" in an Atlas page directory name, which no CONTEXT.md term defines.',
    'ATLAS_VOCABULARY_WORD_UNKNOWN Atlas SDK uses the word "Waypoints" in a Finding message, which no CONTEXT.md term defines.',
    'ATLAS_VOCABULARY_WORD_UNKNOWN Atlas SDK uses the word "WHEN" in the diagnostic code ATLAS_WHEN_MISSING, which no CONTEXT.md term defines.',
  ]);
});

test("ordinary English prose that matches a domain term does not fail", () => {
  assert.deepEqual(
    validate(anchorBinding, [
      contract(
        [
          "// A Bonfire is a Landmark, and a Query names an ordinary hub.",
          "/* The Anchor of this Region is only prose about a Query. */",
          'const format = "date-time";',
          'const schema = "https://atlas.dev/schema/finding.json";',
          'const label = "Atlas page";',
          'const reserved = ".atlas/types/";',
          'const message = "Atlas SDK reads one anchor. Landmark pages are ignored.";',
          'const opening = "Waypoints open no sentence here.";',
          "const anchors = `${format} ${schema}`;",
          'import { readFileSync } from "node:fs";',
          'export { anchors } from "./bonfire-report.ts";',
        ].join("\n"),
      ),
    ]),
    [],
  );
});

test("an empty glossary fails closed before any contract is scanned", () => {
  const findings = validate(
    anchorBinding,
    [contract('const x = ".atlas/bonfires/";')],
    ["# Atlas SDK", "", "No terms are defined here."],
  );

  assert.deepEqual(summarize(findings), [
    "ATLAS_VOCABULARY_GLOSSARY_EMPTY Atlas SDK requires CONTEXT.md to define the domain vocabulary its contracts bind.",
  ]);
});

test("vocabulary Findings are deterministic, ordered, and deeply frozen", () => {
  const contracts = [
    contract('const b = ".atlas/bonfires/";', "src/lint/second.ts"),
    contract(
      'const a = "ATLAS_BONFIRE_MISSING", c = ".atlas/landmarks/";',
      "src/atlas/first.ts",
    ),
  ];
  const bindings: CoreArchetypeBindings = {
    Anchor: { ...(anchorBinding["Anchor"] as CoreArchetypeBindings[string]) },
    Landmark: {
      diagnosticStem: "LANDMARK",
      directory: "landmarks",
      idPrefix: "landmark",
      pageType: "landmark",
    },
    Waypoint: {
      diagnosticStem: "WAYPOINT",
      directory: "waypoints",
      idPrefix: "waypoint",
      pageType: "waypoint",
    },
  };
  const findings = validate(bindings, contracts);

  assert.deepEqual(
    findings.map((finding) => `${finding.path} ${finding.code}`),
    [
      "CONTEXT.md ATLAS_VOCABULARY_TERM_UNDEFINED",
      "CONTEXT.md ATLAS_VOCABULARY_TERM_AVOIDED",
      "src/atlas/first.ts ATLAS_VOCABULARY_IDENTIFIER_AVOIDED",
      "src/atlas/first.ts ATLAS_VOCABULARY_IDENTIFIER_AVOIDED",
      "src/lint/second.ts ATLAS_VOCABULARY_IDENTIFIER_AVOIDED",
    ],
  );
  assert.deepEqual(validate(bindings, contracts.toReversed()), findings);
  assert.equal(Object.isFrozen(findings), true);
  assert.equal(Object.isFrozen(findings[0]), true);
  assert.equal(Object.isFrozen(findings[0]?.attribution), true);
  assert.equal(Object.isFrozen(findings[2]?.location), true);
  assert.equal(Object.isFrozen(findings[2]?.location?.start), true);
});

test("the repository binds every declared Core Archetype", () => {
  assert.deepEqual(Object.keys(coreArchetypes), [
    "Anchor",
    "Concept",
    "Source",
    "Principle",
    "Edge",
  ]);
});

test("the validator command reports agreement and disagreement", () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (value: string) => logs.push(value);
  console.error = (value: string) => errors.push(value);
  const workspace = scratchRepository();
  try {
    assert.equal(main(["validate", "--root", ROOT]), 0);
    assert.deepEqual(logs, ["validated glossary and contract vocabulary agreement"]);
    assert.equal(main([]), 2);
    assert.equal(main(["render"]), 2);
    assert.equal(main(["validate", "--root"]), 2);
    assert.equal(main(["validate", "--directory", ROOT]), 2);
    assert.equal(main(["validate", "--root", ""]), 2);
    assert.deepEqual(errors, Array(5).fill(errors[0]));

    writeFileSync(join(workspace, "CONTEXT.md"), glossaryLines.join("\n"));
    writeFileSync(
      join(workspace, "src", "lint", "drift.ts"),
      'export const code = "ATLAS_BONFIRE_MISSING";\n',
    );
    writeFileSync(join(workspace, "src", "lint", "notes.md"), "ignored\n");
    assert.equal(main(["validate", "--root", workspace]), 1);
    assert.match(
      errors.at(-1) as string,
      /^error: src\/lint\/drift\.ts:1:28: ATLAS_VOCABULARY_IDENTIFIER_AVOIDED /u,
    );
  } finally {
    console.log = originalLog;
    console.error = originalError;
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the validator is directly executable", () => {
  const output = execFileSync("node", [SCRIPT, "validate", "--root", ROOT], {
    encoding: "utf8",
  });
  assert.equal(output, "validated glossary and contract vocabulary agreement\n");
  assert.equal(
    formatFinding({
      attribution: {
        checkId: "sdk-core.vocabulary-agreement",
        kind: "sdk-core",
        trusted: true,
      },
      code: "ATLAS_VOCABULARY_TERM_UNDEFINED",
      "finding-schema": "1.0.0",
      message: "Undefined.",
      path: "CONTEXT.md",
      severity: "error",
    }),
    "CONTEXT.md: ATLAS_VOCABULARY_TERM_UNDEFINED Undefined.",
  );
});
