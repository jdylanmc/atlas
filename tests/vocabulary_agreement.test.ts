import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function inDirectory<T>(directory: string, run: () => T): T {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    return run();
  } finally {
    process.chdir(previous);
  }
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

test("a term spells its own directory, however that term pluralizes", () => {
  const lines = [
    "# Atlas SDK",
    "",
    "**Policy**:",
    "A rule an Atlas states about its own knowledge.",
    "",
  ];
  const consistent: CoreArchetypeBindings = {
    Policy: {
      diagnosticStem: "POLICY",
      directory: "policies",
      idPrefix: "policy",
      pageType: "policy",
    },
  };

  assert.deepEqual(validate(consistent, [], lines), []);
  assert.deepEqual(
    summarize(
      validate(
        {
          Policy: {
            ...(consistent["Policy"] as CoreArchetypeBindings[string]),
            directory: "policys",
          },
        },
        [],
        lines,
      ),
    ),
    [
      'ATLAS_VOCABULARY_IDENTIFIER_MISMATCH Atlas SDK binds page directory "policys" to the term "Policy", which requires "policies".',
    ],
  );
});

test("a term Atlas SDK cannot spell is refused before it is bound", () => {
  assert.deepEqual(
    summarize(
      validate(
        {
          "Atlas Policy": {
            diagnosticStem: "ATLAS_POLICY",
            directory: "atlas policies",
            idPrefix: "atlas-policy",
            pageType: "atlas policy",
          },
          Waypoint: {
            diagnosticStem: "WAYPOINT",
            directory: "waypoints",
            idPrefix: "waypoint",
            pageType: "waypoint",
          },
        },
        [],
      ),
    ),
    [
      'ATLAS_VOCABULARY_TERM_UNDEFINED Atlas SDK contracts bind the term "Waypoint", which CONTEXT.md does not define.',
      'ATLAS_VOCABULARY_TERM_UNSUPPORTED Atlas SDK contracts bind the term "Atlas Policy", which is not one capitalized word.',
    ],
  );
});

test("a bound term the glossary avoids fails at its avoidance line", () => {
  const findings = validate(
    {
      Bonfire: {
        diagnosticStem: "BONFIRE",
        directory: "bonfires",
        idPrefix: "bonfire",
        pageType: "bonfire",
      },
    },
    [],
  );

  assert.deepEqual(summarize(findings), [
    'ATLAS_VOCABULARY_TERM_AVOIDED Atlas SDK contracts bind the term "Bonfire", which CONTEXT.md lists as an avoided term.',
  ]);
  assert.deepEqual(findings[0]?.location, {
    end: { column: 27, line: 10 },
    start: { column: 1, line: 10 },
  });
});

test("an avoided term used as a live identifier fails in every contract surface", () => {
  const findings = validate(anchorBinding, [
    contract(
      [
        'const code = "ATLAS_BONFIRE_MISSING";',
        'const directory = ".atlas/bonfires/";',
        'const id = "bonfire:root";',
        'const type = "bonfire";',
        'const message = "Bonfire pages are required.";',
        'const trailing = "Atlas SDK reads one anchor. Landmark pages are ignored.";',
      ].join("\n"),
    ),
  ]);

  assert.deepEqual(
    findings.map((found) => `${found.code} ${String(found.location?.start.line)}`),
    [
      "ATLAS_VOCABULARY_IDENTIFIER_AVOIDED 1",
      "ATLAS_VOCABULARY_IDENTIFIER_AVOIDED 2",
      "ATLAS_VOCABULARY_IDENTIFIER_AVOIDED 3",
      "ATLAS_VOCABULARY_IDENTIFIER_AVOIDED 4",
      "ATLAS_VOCABULARY_IDENTIFIER_AVOIDED 5",
      "ATLAS_VOCABULARY_IDENTIFIER_AVOIDED 6",
    ],
  );
  assert.deepEqual(summarize(findings).toSorted(), [
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "BONFIRE" in the diagnostic code ATLAS_BONFIRE_MISSING, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Bonfire" in a Finding message, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Landmark" in a Finding message, which CONTEXT.md lists as the avoided term "Landmark".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "bonfire" in an Atlas page type, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "bonfire" in an Atlas page-ID prefix, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "bonfires" in an Atlas page directory name, which CONTEXT.md lists as the avoided term "Bonfire".',
  ]);
});

test("sentence position never excuses an avoided term in a message", () => {
  const findings = validate(anchorBinding, [
    contract('const opening = "Landmark pages are ignored.";'),
  ]);

  assert.deepEqual(summarize(findings), [
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Landmark" in a Finding message, which CONTEXT.md lists as the avoided term "Landmark".',
  ]);
  assert.deepEqual(findings[0]?.location, {
    end: { column: 26, line: 1 },
    start: { column: 18, line: 1 },
  });
});

test("a substitution keeps the words after it at their own location", () => {
  const findings = validate(anchorBinding, [
    contract("const message = `Atlas SDK rejects ${directory} the Landmark.`;"),
  ]);

  assert.deepEqual(findings[0]?.location, {
    end: { column: 61, line: 1 },
    start: { column: 53, line: 1 },
  });
});

test("a conditional avoidance stays advice, and an unconditional one binds", () => {
  const lines = [
    "# Atlas SDK",
    "",
    "**Anchor**:",
    "A page through which an agent enters a region of knowledge.",
    "_Avoid_: Bonfire, Query, when naming the user-facing skill, which humans read",
    "",
  ];

  assert.deepEqual(
    summarize(
      validate(
        anchorBinding,
        [contract('const skill = "query";\nconst type = "bonfire";')],
        lines,
      ),
    ),
    [
      'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "bonfire" in an Atlas page type, which CONTEXT.md lists as the avoided term "Bonfire".',
    ],
  );
});

test("a page-ID prefix is read even when a substitution supplies its value", () => {
  assert.deepEqual(
    summarize(validate(anchorBinding, [contract("const id = `bonfire:${slug}`;")])),
    [
      'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "bonfire" in an Atlas page-ID prefix, which CONTEXT.md lists as the avoided term "Bonfire".',
    ],
  );
  assert.deepEqual(
    validate(anchorBinding, [
      contract("const x = `${cond ? active:inactive}`;\nconst y = `${ {foo:1} }`;"),
    ]),
    [],
  );
});

test("an identifier bound to no glossary term fails with its own diagnostic", () => {
  assert.deepEqual(
    summarize(
      validate(anchorBinding, [
        contract('const directory = ".atlas/waypoints/";\nconst id = "waypoint:root";'),
      ]),
    ),
    [
      'ATLAS_VOCABULARY_IDENTIFIER_UNDECLARED Atlas SDK uses the identifier "waypoints" in an Atlas page directory name, which no CONTEXT.md term defines.',
      'ATLAS_VOCABULARY_IDENTIFIER_UNDECLARED Atlas SDK uses the identifier "waypoint" in an Atlas page-ID prefix, which no CONTEXT.md term defines.',
    ],
  );
});

test("ordinary English prose that matches a domain term does not fail", () => {
  assert.deepEqual(
    validate(anchorBinding, [
      contract(
        [
          "// A Bonfire is a Landmark, and a Query names an ordinary hub.",
          "/* The Anchor of this Region is only prose about a Query. */",
          "// Landmark pages are ignored, and a todo:fixme tag is not a page.",
          "/** An avoidance line, for example `_Avoid_: Bonfire, Landmark, Hub`. */",
          'const format = "date-time";',
          'const schema = "https://atlas.dev/schema/finding.json";',
          'const label = "Atlas page";',
          'const reserved = ".atlas/types/";',
          'const encoding = "utf8";',
          'const message = "Atlas SDK reads one Anchor page.";',
          "const anchors = `${format} ${schema}`;",
          'import { readFileSync } from "node:fs";',
          'export { anchors } from "./landmark-report.ts";',
          'const resolved = import.meta.resolve("node:path");',
          'const legacy = require("node:url");',
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
    findings.map((found) => `${found.path} ${found.code}`),
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

test("a hostile contract cannot make the check run long", () => {
  const started = process.hrtime.bigint();
  assert.deepEqual(
    validate(anchorBinding, [contract(`// from${" ".repeat(200_000)}`)]),
    [],
  );
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  assert.ok(elapsedMs < 2000, `scanning took ${String(elapsedMs)}ms`);
});

test("a token-dense contract stays linear in its own length", () => {
  const line =
    'const found = finding("ATLAS_CORE_EXAMPLE_INVALID", "Atlas SDK reports One Page Here Today.", ".atlas/anchors/page.md");';
  const dense = `${line}\n`.repeat(3000);
  const started = process.hrtime.bigint();

  assert.deepEqual(validate(anchorBinding, [contract(dense)]), []);

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  assert.ok(
    elapsedMs < 2000,
    `scanning ${String(dense.length)} characters took ${String(elapsedMs)}ms`,
  );
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
    assert.equal(
      inDirectory(ROOT, () => main(["validate"])),
      0,
    );
    assert.deepEqual(logs, ["validated glossary and contract vocabulary agreement"]);
    assert.equal(main([]), 2);
    assert.equal(main(["render"]), 2);
    assert.equal(main(["validate", "--root"]), 2);
    assert.deepEqual(errors, Array(3).fill(errors[0]));

    writeFileSync(join(workspace, "CONTEXT.md"), glossaryLines.join("\n"));
    writeFileSync(
      join(workspace, "src", "lint", "drift.ts"),
      'export const code = "ATLAS_BONFIRE_MISSING";\n',
    );
    writeFileSync(join(workspace, "src", "lint", "notes.md"), "ignored\n");
    assert.equal(
      inDirectory(workspace, () => main(["validate"])),
      1,
    );
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
  const output = execFileSync("node", [SCRIPT, "validate"], {
    cwd: ROOT,
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

test("the validator refuses unreadable contracts instead of following them", () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (value: string) => errors.push(value);
  const workspace = scratchRepository();
  try {
    assert.equal(
      inDirectory(workspace, () => main(["validate"])),
      1,
    );
    assert.deepEqual(errors, ["error: CONTEXT.md must be a regular file"]);

    symlinkSync(join(workspace, "src", "lint"), join(workspace, "CONTEXT.md"));
    assert.equal(
      inDirectory(workspace, () => main(["validate"])),
      1,
    );
    assert.equal(errors.at(-1), "error: CONTEXT.md must be a regular file");

    const linked = scratchRepository();
    writeFileSync(join(linked, "CONTEXT.md"), glossaryLines.join("\n"));
    writeFileSync(join(linked, "src", "lint", "outside.ts"), "const a = 1;\n");
    symlinkSync(
      join(linked, "src", "lint", "outside.ts"),
      join(linked, "src", "lint", "link.ts"),
    );
    assert.deepEqual(collectContracts(linked, "src"), ["src/lint/outside.ts"]);
    rmSync(linked, { recursive: true, force: true });

    const missing = scratchRepository();
    writeFileSync(join(missing, "CONTEXT.md"), glossaryLines.join("\n"));
    rmSync(join(missing, "src"), { recursive: true, force: true });
    assert.equal(
      inDirectory(missing, () => main(["validate"])),
      1,
    );
    assert.equal(errors.at(-1), "error: src must be a readable directory");
    rmSync(missing, { recursive: true, force: true });
  } finally {
    console.error = originalError;
    rmSync(workspace, { recursive: true, force: true });
  }
});
