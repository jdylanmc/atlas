import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkFinding } from "../src/domain/finding.ts";
import type {
  CapturedRealmFile,
  RealmTextBudgets,
} from "../src/realm/load_realm_text.ts";
import { validateRealmInput } from "../src/weave/validate_realm_input.ts";

const encoder = new TextEncoder();
const fixturesRoot = resolve(import.meta.dirname, "fixtures", "realm-pages");

const generousBudgets: RealmTextBudgets = Object.freeze({
  maxFileBytes: 4096,
  maxTotalBytes: 65536,
});

const realmPaths = [
  ".atlas/framework/README.md",
  ".atlas/CHANGELOG.md",
  ".atlas/index.md",
  ".atlas/insights/parsing.md",
  ".atlas/lore/parser-source.md",
] as const;

function captured(path: string, content: string): CapturedRealmFile {
  return { bytes: encoder.encode(content), path };
}

function completeRealm(): CapturedRealmFile[] {
  return realmPaths.map((path) =>
    captured(path, readFileSync(resolve(fixturesRoot, path), "utf8")),
  );
}

const inputAttribution = Object.freeze({
  checkId: "atlas-core.realm-input",
  kind: "atlas-core",
  trusted: true,
});

test("accepts a valid complete captured Realm with no Findings", () => {
  assert.deepEqual(validateRealmInput(completeRealm(), generousBudgets), []);
});

test("reports a loading failure as one stable attributed Finding", () => {
  const budgets: RealmTextBudgets = { maxFileBytes: 4096, maxTotalBytes: 200 };
  const findings = validateRealmInput(completeRealm(), budgets);

  assert.deepEqual(findings, [
    {
      attribution: inputAttribution,
      code: "ATLAS_REALM_LOAD_TOTAL_TOO_LARGE",
      "finding-schema": "1.0.0",
      message: "Captured Realm files exceed the total byte budget.",
      path: ".atlas",
      severity: "error",
    },
  ]);
  assert.equal(findings[0]?.location, undefined);
  for (const finding of findings) assert.equal(checkFinding(finding), true);

  // Identical bytes, and reversed input order, produce identical ordered Findings.
  assert.deepEqual(validateRealmInput(completeRealm(), budgets), findings);
  assert.deepEqual(validateRealmInput(completeRealm().toReversed(), budgets), findings);
});

test("maps distinct loading failures to distinct diagnostic codes", () => {
  const invalidUtf8 = [
    captured(".atlas/index.md", "ok"),
    { bytes: new Uint8Array([0xc3, 0x28]), path: ".atlas/insights/bad.md" },
  ];
  assert.equal(
    validateRealmInput(invalidUtf8, generousBudgets)[0]?.code,
    "ATLAS_REALM_LOAD_INVALID_UTF8",
  );

  const oversizedFile = validateRealmInput(
    [captured(".atlas/index.md", "0123456789")],
    {
      maxFileBytes: 4,
      maxTotalBytes: 64,
    },
  );
  assert.equal(oversizedFile[0]?.code, "ATLAS_REALM_LOAD_FILE_TOO_LARGE");
});

test("sanitizes loading failures and never leaks the offending raw path", () => {
  const findings = validateRealmInput(
    [
      captured(".atlas/index.md", "ok"),
      { bytes: encoder.encode("x"), path: "/.atlas/secret-evil.md" },
    ],
    generousBudgets,
  );

  assert.deepEqual(
    findings.map(({ code, location, path }) => ({ code, location, path })),
    [{ code: "ATLAS_REALM_LOAD_INVALID_PATH", location: undefined, path: ".atlas" }],
  );
  assert.equal(JSON.stringify(findings).includes("secret-evil"), false);
});

test("reports a parsing failure with a diagnostic code and source location", () => {
  const realm = completeRealm().map((file) =>
    file.path === ".atlas/insights/parsing.md"
      ? captured(file.path, "# Missing frontmatter\n")
      : file,
  );
  const findings = validateRealmInput(realm, generousBudgets);

  assert.deepEqual(
    findings.map(({ attribution, code, location, path }) => ({
      attribution,
      code,
      location,
      path,
    })),
    [
      {
        attribution: {
          checkId: "atlas-core.structural-validation",
          kind: "atlas-core",
          trusted: true,
        },
        code: "ATLAS_PAGE_MISSING_FRONTMATTER",
        location: { end: { column: 22, line: 1 }, start: { column: 1, line: 1 } },
        path: ".atlas/insights/parsing.md",
      },
    ],
  );
  for (const finding of findings) assert.equal(checkFinding(finding), true);

  // Identical invalid bytes produce identical ordered Findings across runs.
  assert.deepEqual(validateRealmInput(realm, generousBudgets), findings);
});

test("returns a deeply frozen Finding collection", () => {
  const findings = validateRealmInput(completeRealm(), {
    maxFileBytes: 4096,
    maxTotalBytes: 200,
  });
  assert.equal(Object.isFrozen(findings), true);
  assert.equal(Object.isFrozen(findings[0]), true);
  assert.equal(Object.isFrozen(findings[0]?.attribution), true);
});
