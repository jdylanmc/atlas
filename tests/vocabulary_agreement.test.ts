import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import type { CoreArchetypeBindings } from "../src/domain/core_archetype.ts";
import {
  coreArchetypes,
  reservedPageDirectories,
} from "../src/domain/core_archetype.ts";
import type {
  ContractVocabularyBinding,
  UnboundGlossaryTerm,
} from "../src/domain/contract_vocabulary.ts";
import { checkFinding, type Finding } from "../src/domain/finding.ts";
import {
  parseGlossary,
  validateVocabularyAgreement,
  type VocabularyTextFile,
} from "../src/lint/validate_vocabulary_agreement.ts";
import {
  collectContracts,
  formatFinding,
  main,
  validateRepository,
} from "../scripts/vocabulary_agreement.ts";
import { assertGrowthRatio, assertWallClockUnder } from "./growth.ts";

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
  contractTerms: readonly ContractVocabularyBinding[] = [],
  unboundTerms?: readonly UnboundGlossaryTerm[],
): readonly Finding[] {
  const glossaryFile = glossary(lines);
  // Callers that are not exercising term-classification itself do not want
  // to hand-maintain a not-a-contract list for their fixture glossary, so an
  // omitted list is derived permissively: every defined term the fixture's
  // own `bindings`/`contractTerms` do not already cover is treated as
  // deliberately unbound. Production code never takes this default; it
  // always passes the real, hand-maintained `unboundGlossaryTerms`.
  const resolvedUnboundTerms =
    unboundTerms ??
    [...parseGlossary(glossaryFile.content).terms.keys()]
      .filter(
        (term) =>
          !Object.hasOwn(bindings, term) &&
          !contractTerms.some((binding) => binding.term === term),
      )
      .map((term) => ({ reason: "test default", term }));
  const findings = validateVocabularyAgreement(
    bindings,
    contractTerms,
    resolvedUnboundTerms,
    glossaryFile,
    contracts,
  );
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

// Every reserved directory is a name the vocabulary check accepts without a
// glossary term, so the set is an allowlist and silence is how one grows. An
// exact-membership assertion is the only thing that makes an addition a
// decision rather than an edit: "framework" is here solely until issue #162
// deletes `.atlas/framework/`, and this test is what will notice if it stays.
test("the reserved page directories are exactly the ones Atlas SDK claims", () => {
  assert.deepEqual([...reservedPageDirectories].toSorted(), [
    "atlas-cache",
    "framework",
    "types",
  ]);
});

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

test("contract vocabulary terms must be glossary-defined capitalized phrases", () => {
  assert.deepEqual(
    validate(
      anchorBinding,
      [contract("export interface AtlasSdk {}\nexport interface Anchor {}")],
      glossaryLines,
      [
        { exportedIdentifiers: ["AtlasSdk"], term: "Atlas SDK" },
        { exportedIdentifiers: ["Anchor"], term: "Anchor" },
      ],
    ),
    [],
  );

  assert.deepEqual(
    summarize(
      validate(anchorBinding, [], glossaryLines, [
        { exportedIdentifiers: ["MissingTerm"], term: "missing Term" },
      ]),
    ),
    [
      'ATLAS_VOCABULARY_CONTRACT_TERM_UNSUPPORTED Atlas SDK contracts require the term "missing Term", which is not a capitalized term or phrase.',
    ],
  );
  assert.deepEqual(
    summarize(
      validate(anchorBinding, [], glossaryLines, [
        { exportedIdentifiers: ["MissingTerm"], term: "Missing Term" },
      ]),
    ),
    [
      'ATLAS_VOCABULARY_CONTRACT_TERM_UNDEFINED Atlas SDK contracts require the term "Missing Term", which CONTEXT.md does not define.',
    ],
  );
  assert.deepEqual(
    summarize(
      validate(anchorBinding, [], glossaryLines, [
        { exportedIdentifiers: ["Bonfire"], term: "Bonfire" },
      ]),
    ),
    [
      'ATLAS_VOCABULARY_CONTRACT_TERM_AVOIDED Atlas SDK contracts require the term "Bonfire", which CONTEXT.md lists as an avoided term.',
    ],
  );
});

test("contract vocabulary terms must be exported by the contracts they name", () => {
  const valid = contract("export interface ValidAtlasLintResult {}");
  const renamed = contract("export interface ValidLintOutcome {}");
  const binding = Object.freeze([
    {
      exportedIdentifiers: Object.freeze(["ValidAtlasLintResult"]),
      term: "Anchor",
    },
  ]);

  assert.deepEqual(validate(anchorBinding, [valid], glossaryLines, binding), []);
  assert.deepEqual(
    summarize(validate(anchorBinding, [renamed], glossaryLines, binding)),
    [
      'ATLAS_VOCABULARY_CONTRACT_EXPORT_MISSING Atlas SDK contracts require the term "Anchor" to be exported as "ValidAtlasLintResult", but no scanned contract exports that identifier.',
    ],
  );
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

test("an avoidance qualifier that hides a term is reported, not obeyed", () => {
  const leading = [
    "# Atlas SDK",
    "",
    "**Anchor**:",
    "A page through which an agent enters a region of knowledge.",
    "_Avoid_: when naming the skill, Bonfire",
    "",
  ];
  const buried = [...leading];
  buried[4] = "_Avoid_: Bonfire, when naming the skill, Landmark";

  for (const lines of [leading, buried]) {
    const findings = validate(anchorBinding, [contract('const t = "bonfire";')], lines);
    assert.deepEqual(summarize(findings).slice(0, 1), [
      "ATLAS_VOCABULARY_AVOIDANCE_MALFORMED Atlas SDK requires every avoidance entry in CONTEXT.md to name a term, and a qualifier to follow the one term it scopes and to end its line.",
    ]);
    assert.deepEqual(findings[0]?.location, {
      end: { column: (lines[4] as string).length + 1, line: 5 },
      start: { column: 1, line: 5 },
    });
  }
});

test("a stray comma in an avoidance line is reported, and every term keeps binding", () => {
  const base = [
    "# Atlas SDK",
    "",
    "**Anchor**:",
    "A page through which an agent enters a region of knowledge.",
    "_Avoid_: Bonfire, Landmark",
    "",
  ];

  for (const entries of [
    "Bonfire, Landmark,",
    "Bonfire, Landmark, ",
    "Bonfire,, Landmark",
  ]) {
    const lines = [...base];
    lines[4] = `_Avoid_: ${entries}`;
    assert.deepEqual(
      summarize(
        validate(
          anchorBinding,
          [contract('const type = "landmark";\nconst code = "ATLAS_BONFIRE_MISSING";')],
          lines,
        ),
      ),
      [
        "ATLAS_VOCABULARY_AVOIDANCE_MALFORMED Atlas SDK requires every avoidance entry in CONTEXT.md to name a term, and a qualifier to follow the one term it scopes and to end its line.",
        'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "landmark" in an Atlas page type, which CONTEXT.md lists as the avoided term "Landmark".',
        'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "BONFIRE" in the diagnostic code ATLAS_BONFIRE_MISSING, which CONTEXT.md lists as the avoided term "Bonfire".',
      ],
    );
  }
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

test("an avoided term of several words is read as one name", () => {
  const lines = [
    "# Atlas SDK",
    "",
    "**Anchor**:",
    "A page through which an agent enters a region of knowledge.",
    "_Avoid_: Bonfire, Realm Chronicle",
    "",
  ];
  const source = [
    'const a = "Atlas SDK rejects a Realm Chronicle here.";',
    'const b = "Atlas SDK rejects a Realm, Chronicle here.";',
    'const c = "ATLAS_REALM_CHRONICLE_MISSING";',
    'const d = "Atlas SDK rejects a Realm Chronicle Bonfire here.";',
    'const e = ".atlas/realm-chronicles/";',
  ].join("\n");
  const findings = validate(anchorBinding, [contract(source)], lines);

  assert.deepEqual(summarize(findings), [
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Realm Chronicle" in a Finding message, which CONTEXT.md lists as the avoided term "Realm Chronicle".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "REALM_CHRONICLE" in the diagnostic code ATLAS_REALM_CHRONICLE_MISSING, which CONTEXT.md lists as the avoided term "Realm Chronicle".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Realm Chronicle" in a Finding message, which CONTEXT.md lists as the avoided term "Realm Chronicle".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Bonfire" in a Finding message, which CONTEXT.md lists as the avoided term "Bonfire".',
    'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "realm-chronicles" in an Atlas page directory name, which CONTEXT.md lists as the avoided term "Realm Chronicle".',
  ]);
  assert.deepEqual(findings[0]?.location, {
    end: { column: 47, line: 1 },
    start: { column: 32, line: 1 },
  });
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
    "TrackedAtlas",
  ]);
});

test("every CONTEXT.md glossary term is classified exactly once", () => {
  // Real registries, real glossary: this is the coverage guard issue #143
  // exists for. It fails the moment a term is added to CONTEXT.md without a
  // contract binding or an explicit not-a-contract decision, and it fails
  // the moment a term is both bound and recorded as unbound.
  assert.deepEqual(validateRepository(ROOT), []);
});

test("a glossary term bound to no contract and recorded as no contract is unclassified", () => {
  const findings = validate(
    anchorBinding,
    [],
    [...glossaryLines, "**Finding**:", "One result reported by a Lint.", ""],
    [],
    [],
  );
  assert.deepEqual(
    findings.map((finding) => finding.code),
    [
      "ATLAS_VOCABULARY_TERM_UNCLASSIFIED",
      "ATLAS_VOCABULARY_TERM_UNCLASSIFIED",
      "ATLAS_VOCABULARY_TERM_UNCLASSIFIED",
    ],
  );
  const messages = findings.map((finding) => finding.message);
  assert.ok(messages.some((message) => message.includes('"Atlas SDK"')));
  assert.ok(messages.some((message) => message.includes('"Explore"')));
  assert.ok(messages.some((message) => message.includes('"Finding"')));
});

test("a term recorded as not bound to a contract that CONTEXT.md never defines is reported", () => {
  const findings = validate(
    anchorBinding,
    [],
    ["**Anchor**:", "A page.", ""],
    [],
    [{ reason: "test", term: "Nonexistent Term" }],
  );
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ["ATLAS_VOCABULARY_UNBOUND_TERM_UNDEFINED"],
  );
  assert.ok(findings[0]?.message.includes('"Nonexistent Term"'));
});

test("a term both bound and recorded as not bound to a contract is double-classified", () => {
  const findings = validate(
    anchorBinding,
    [],
    ["**Anchor**:", "A page.", ""],
    [],
    [{ reason: "test", term: "Anchor" }],
  );
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ["ATLAS_VOCABULARY_TERM_DOUBLE_CLASSIFIED"],
  );
  assert.ok(findings[0]?.message.includes('"Anchor"'));
});

test("vocabulary scanning cost follows input growth", () => {
  const nonSpecifierSmall = contract(`// from${" ".repeat(100_000)}`);
  const nonSpecifierLarge = contract(`// from${" ".repeat(200_000)}`);
  assertWallClockUnder("masking a long non-specifier", 2000, () =>
    assert.deepEqual(validate(anchorBinding, [nonSpecifierLarge]), []),
  );
  assertGrowthRatio({
    large: () => assert.deepEqual(validate(anchorBinding, [nonSpecifierLarge]), []),
    name: "masking a long non-specifier",
    small: () => assert.deepEqual(validate(anchorBinding, [nonSpecifierSmall]), []),
  });

  const line =
    'const found = finding("ATLAS_CORE_EXAMPLE_INVALID", "Atlas SDK reports One Page Here Today.", ".atlas/anchors/page.md");';
  const denseSmall = contract(`${line}\n`.repeat(1500));
  const denseLarge = contract(`${line}\n`.repeat(3000));
  assertWallClockUnder("scanning token-dense vocabulary contract", 2000, () =>
    assert.deepEqual(validate(anchorBinding, [denseLarge]), []),
  );
  assertGrowthRatio({
    large: () => assert.deepEqual(validate(anchorBinding, [denseLarge]), []),
    name: "token-dense vocabulary contract",
    small: () => assert.deepEqual(validate(anchorBinding, [denseSmall]), []),
  });

  const unterminatedSmall = contract(`// "${'\\"'.repeat(50_000)}`);
  const unterminatedLarge = contract(`// "${'\\"'.repeat(100_000)}`);
  assertWallClockUnder("scanning unterminated literal", 2000, () =>
    assert.deepEqual(validate(anchorBinding, [unterminatedLarge]), []),
  );
  assertGrowthRatio({
    large: () => assert.deepEqual(validate(anchorBinding, [unterminatedLarge]), []),
    name: "unterminated literal scan",
    small: () => assert.deepEqual(validate(anchorBinding, [unterminatedSmall]), []),
  });

  const exported = (count: number): VocabularyTextFile =>
    contract(
      Array.from(
        { length: count },
        (_, index) => `export interface Exported${String(index)} {}`,
      ).join("\n"),
    );
  const exportedSmall = exported(1500);
  const exportedLarge = exported(3000);
  const exportedTerm: readonly ContractVocabularyBinding[] = [
    { exportedIdentifiers: ["Exported0"], term: "Anchor" },
  ];
  assertWallClockUnder("scanning exported contract identifiers", 2000, () =>
    assert.deepEqual(
      validate(anchorBinding, [exportedLarge], glossaryLines, exportedTerm),
      [],
    ),
  );
  assertGrowthRatio({
    large: () =>
      assert.deepEqual(
        validate(anchorBinding, [exportedLarge], glossaryLines, exportedTerm),
        [],
      ),
    name: "exported contract identifier scan",
    small: () =>
      assert.deepEqual(
        validate(anchorBinding, [exportedSmall], glossaryLines, exportedTerm),
        [],
      ),
  });
});

test("a contract longer than Atlas SDK reads is reported, not scanned", () => {
  const oversize = `const a = "bonfire";\n${" ".repeat(1_048_576)}`;

  assert.deepEqual(summarize(validate(anchorBinding, [contract(oversize)])), [
    "ATLAS_VOCABULARY_CONTRACT_OVERSIZE Atlas SDK reads a contract of at most 1048576 characters, and src/lint/example.ts is longer, so its vocabulary went unread.",
  ]);
});

test("a method named for module syntax does not hide the literal it reads", () => {
  assert.deepEqual(
    summarize(
      validate(anchorBinding, [
        contract(
          [
            'const a = Buffer.from("ATLAS_BONFIRE_MISSING");',
            'const b = Array.from(".atlas/bonfires/page.md");',
            'const c = Buffer.from("Atlas SDK lights a Bonfire here.");',
            'import d from "node:fs";',
            'const e = require("node:fs");',
            'const f = import.meta.resolve("node:fs");',
            'export { g } from "node:fs";',
            'const h = cond?require("node:fs"):null;',
            'const i = cond ? import("node:fs") : null;',
          ].join("\n"),
        ),
      ]),
    ),
    [
      'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "BONFIRE" in the diagnostic code ATLAS_BONFIRE_MISSING, which CONTEXT.md lists as the avoided term "Bonfire".',
      'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "bonfires" in an Atlas page directory name, which CONTEXT.md lists as the avoided term "Bonfire".',
      'ATLAS_VOCABULARY_IDENTIFIER_AVOIDED Atlas SDK uses "Bonfire" in a Finding message, which CONTEXT.md lists as the avoided term "Bonfire".',
    ],
  );
});

test("a directory name is located where it is written, not where it repeats", () => {
  const findings = validate(anchorBinding, [
    contract('const page = ".atlas/atlas/page.md";'),
  ]);

  assert.deepEqual(summarize(findings), [
    'ATLAS_VOCABULARY_IDENTIFIER_UNDECLARED Atlas SDK uses the identifier "atlas" in an Atlas page directory name, which no CONTEXT.md term defines.',
  ]);
  assert.deepEqual(findings[0]?.location, {
    end: { column: 27, line: 1 },
    start: { column: 22, line: 1 },
  });
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
