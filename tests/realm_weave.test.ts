import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import {
  CORE_SCHEMA_VERSION,
  FINDING_SCHEMA,
  MAX_REALM_FILE_BYTES,
  MAX_REALM_FILES,
  MAX_REALM_TOTAL_BYTES,
  OPERATION_HANDOFF_SCHEMA,
  OPERATION_RESULT_SCHEMA,
  PUBLIC_SCHEMAS,
  REALM_LAWS_SCHEMA,
  REALM_MANIFEST_SCHEMA,
  compareFindings,
  compareText,
  type Finding,
} from "../src/domain/contracts.ts";
import {
  assertRealmDirectory,
  assertStableFileRead,
  combineRealmDigest,
  enforceRealmBudget,
  isStableContainedPath,
  main,
  readRegularFile,
  readRealmFiles,
  serializeOperationResult,
} from "../src/interfaces/atlas.ts";
import { loadRealm, parseYaml, type SourceFile } from "../src/realm/load.ts";
import { failedWeaveResult, weaveRealm } from "../src/weave/weave.ts";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE = join(ROOT, "tests/fixtures/realms/minimal");
const WORKSPACES = join(ROOT, ".test-workspaces/realm-weave");

function files(): readonly SourceFile[] {
  return readRealmFiles(FIXTURE);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function replaceFile(
  input: readonly SourceFile[],
  path: string,
  replacement: string | Uint8Array,
): readonly SourceFile[] {
  const bytes =
    typeof replacement === "string" ? Buffer.from(replacement, "utf8") : replacement;
  return input.map((file) =>
    file.path === path ? { path, bytes, digest: sha256(bytes) } : file,
  );
}

function removeFile(input: readonly SourceFile[], path: string): readonly SourceFile[] {
  return input.filter((file) => file.path !== path);
}

function findingCodes(input: readonly SourceFile[]): string[] {
  const result = loadRealm(input, combineRealmDigest);
  assert.equal(result.valid, false);
  return result.findings.map((finding) => finding.code);
}

function captureMain(arguments_: readonly string[]): {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  let stdout = "";
  let stderr = "";
  const code = main(arguments_, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

function resultStatus(text: string): string | undefined {
  const value: unknown = JSON.parse(text);
  if (value !== null && typeof value === "object" && "status" in value) {
    return typeof value.status === "string" ? value.status : undefined;
  }
  return undefined;
}

test.beforeEach(() => {
  rmSync(WORKSPACES, { force: true, recursive: true });
  mkdirSync(WORKSPACES, { recursive: true });
});

test.after(() => {
  rmSync(WORKSPACES, { force: true, recursive: true });
});

test("public contracts are schema-first and frozen", () => {
  assert.equal(CORE_SCHEMA_VERSION, "1.0.0");
  assert.equal(FINDING_SCHEMA, PUBLIC_SCHEMAS.finding.$id);
  assert.equal(REALM_MANIFEST_SCHEMA, PUBLIC_SCHEMAS.manifest.$id);
  assert.equal(REALM_LAWS_SCHEMA, PUBLIC_SCHEMAS.laws.$id);
  assert.deepEqual(PUBLIC_SCHEMAS.page.properties.atlas.properties.type.enum, [
    "lore",
    "insight",
    "pillar",
    "bonfire",
    "thread",
  ]);
  assert.equal(PUBLIC_SCHEMAS.finding.additionalProperties, false);
  assert.deepEqual(
    PUBLIC_SCHEMAS.operationResult.oneOf.map(
      (variant) => variant.properties.status.const,
    ),
    ["completed", "blocked", "failed"],
  );
  assert.equal(OPERATION_HANDOFF_SCHEMA, PUBLIC_SCHEMAS.operationHandoff.$id);
  assert.equal(OPERATION_RESULT_SCHEMA, PUBLIC_SCHEMAS.operationResult.$id);
  assert.ok(Object.isFrozen(PUBLIC_SCHEMAS));
  assert.ok(Object.isFrozen(PUBLIC_SCHEMAS.finding.required));

  const ajv = new Ajv2020({
    strict: true,
    formats: { "date-time": true },
  });
  for (const schema of Object.values(PUBLIC_SCHEMAS)) {
    assert.doesNotThrow(() => ajv.compile(schema));
  }
  const validateResult = ajv.getSchema(OPERATION_RESULT_SCHEMA);
  assert.ok(validateResult);
  assert.equal(validateResult(weaveRealm(files(), combineRealmDigest)), true);
  const validatePage = ajv.getSchema("atlas.realm-page/v1");
  assert.ok(validatePage);
  const audit = {
    at: "2026-08-17T00:00:00.000Z",
    by: { kind: "human", name: "Atlas fixture" },
  };
  const atlas = {
    id: "lore:test",
    type: "lore",
    schema: "1.0.0",
    "realm-schema": "1.0.0",
    title: "Test",
    created: audit,
    updated: audit,
    tags: [],
  };
  assert.equal(
    validatePage({
      atlas,
      realm: {
        source: {},
        authority: "official",
        "gathered-at": audit.at,
        "refresh-after": audit.at,
      },
      body: "# Test\n",
    }),
    false,
  );
  const validateLaws = ajv.getSchema(REALM_LAWS_SCHEMA);
  assert.ok(validateLaws);
  assert.equal(
    validateLaws({
      schema: REALM_LAWS_SCHEMA,
      "atlas-schema": CORE_SCHEMA_VERSION,
      "realm-schema": CORE_SCHEMA_VERSION,
      laws: [],
      approved: {
        at: audit.at,
        by: { kind: "agent", name: "Atlas fixture" },
      },
    }),
    false,
  );
  assert.equal(
    validatePage({
      atlas: { ...atlas, id: "thread:test", type: "thread" },
      realm: {
        endpoints: ["bonfire:root", "bonfire:root"],
        relationships: ["orients"],
      },
      body: "# Test\n",
    }),
    false,
  );
});

test("minimal Realm round-trips canonically through an immutable Realm View", () => {
  const input = files();
  const loaded = loadRealm(input, combineRealmDigest);
  assert.equal(loaded.valid, true);
  assert.deepEqual(loaded.findings, []);
  assert.ok(Object.isFrozen(loaded));
  assert.ok(Object.isFrozen(loaded.view));
  assert.ok(Object.isFrozen(loaded.view.pages));
  assert.ok(Object.isFrozen(loaded.view.pages[0]));
  assert.ok(Object.isFrozen(loaded.view.pages[0]?.envelope));
  assert.ok(Object.isFrozen(loaded.view.pages[0]?.realm));
  const thread = loaded.view.pages.find(
    (page) => page.envelope.id === "thread:root-to-insight",
  );
  assert.ok(Object.isFrozen(thread?.realm["endpoints"]));
  assert.ok(Object.isFrozen(loaded.view.files));
  assert.ok(Object.isFrozen(loaded.view.canonicalFiles));
  for (const file of input) {
    assert.equal(
      loaded.view.canonicalFiles.find((candidate) => candidate.path === file.path)
        ?.text,
      Buffer.from(file.bytes).toString("utf8"),
      file.path,
    );
  }
  assert.throws(() => {
    (loaded.view.pages as unknown as unknown[]).push({});
  }, TypeError);

  const first = input[0] as SourceFile;
  const untrustedDigest = loadRealm(
    [{ ...first, digest: "sha256:not-the-bytes" }, ...input.slice(1)],
    combineRealmDigest,
  );
  assert.equal(untrustedDigest.valid, true);
  assert.notEqual(untrustedDigest.view.files[0]?.digest, "sha256:not-the-bytes");
  const index = readFileSync(join(FIXTURE, ".atlas/index.md"), "utf8");
  const withProvenance = loadRealm(
    replaceFile(
      input,
      ".atlas/index.md",
      index.replace(
        "  id: bonfire:root",
        "  id: bonfire:root\n  originating-operation: initialize:123",
      ),
    ),
    combineRealmDigest,
  );
  assert.equal(withProvenance.valid, true);
  assert.equal(
    withProvenance.view.pages.find((page) => page.path === ".atlas/index.md")?.envelope[
      "originating-operation"
    ],
    "initialize:123",
  );
});

test("valid Weave and machine serialization are byte-stable", () => {
  const first = weaveRealm(files(), combineRealmDigest);
  const second = weaveRealm(files(), combineRealmDigest);
  assert.equal(first.status, "completed");
  assert.equal(first.schema, OPERATION_RESULT_SCHEMA);
  assert.equal(first.handoff.schema, OPERATION_HANDOFF_SCHEMA);
  assert.equal(first.handoff.validation.state, "valid");
  assert.equal(first.findings.length, 0);
  assert.equal(serializeOperationResult(first), serializeOperationResult(second));
  assert.equal(first.output.realm.id, "realm:atlas-minimal");
  assert.equal(first.output.serialization.files, files().length);
  assert.ok(first.output.serialization.bytes > 0);
});

test("invalid Realm Findings are attributed, located, ordered, and stable", () => {
  let input = removeFile(files(), ".atlas/realm/config.yaml");
  input = replaceFile(
    input,
    ".atlas/threads/root-to-insight.md",
    readFileSync(join(FIXTURE, ".atlas/threads/root-to-insight.md"), "utf8").replace(
      "    - insight:realm-files",
      "    - insight:missing",
    ),
  );
  const first = weaveRealm(input, combineRealmDigest);
  const second = weaveRealm(input, combineRealmDigest);
  assert.equal(first.status, "blocked");
  assert.equal(first.handoff.validation.state, "blocked");
  assert.equal(first.handoff.homeRealm.id, "realm:atlas-minimal");
  assert.equal(first.handoff.validation.errors, first.findings.length);
  assert.equal(first.handoff.validation.warnings, 0);
  assert.equal(serializeOperationResult(first), serializeOperationResult(second));
  assert.deepEqual(
    first.findings.map((finding) => finding.code),
    [
      "ATLAS_REALM_INSIGHT_ORPHAN",
      "ATLAS_REALM_REQUIRED_FILE",
      "ATLAS_REALM_THREAD_TARGET_MISSING",
    ],
  );
  const missingTarget = first.findings.find(
    (finding) => finding.code === "ATLAS_REALM_THREAD_TARGET_MISSING",
  );
  assert.ok(missingTarget);
  assert.equal(missingTarget.location.line, 22);
  assert.ok(missingTarget.location.column > 1);
  for (const finding of first.findings) {
    assert.equal(finding.schema, FINDING_SCHEMA);
    assert.deepEqual(finding.check, {
      id: "atlas.realm.structure",
      origin: "trusted-atlas",
    });
    assert.equal(finding.severity, "error");
    assert.ok(finding.location.line >= 1);
    assert.ok(finding.location.column >= 1);
    assert.ok(finding.remediation.length > 0);
  }
});

test("manifest and page schemas fail closed with precise diagnostics", () => {
  const manifest = readFileSync(join(FIXTURE, ".atlas/realm/manifest.yaml"), "utf8");
  const index = readFileSync(join(FIXTURE, ".atlas/index.md"), "utf8");
  const laws = readFileSync(join(FIXTURE, ".atlas/realm/laws.md"), "utf8");
  const cases: ReadonlyArray<readonly [string, readonly SourceFile[], string]> = [
    [
      "missing required file",
      removeFile(files(), ".atlas/realm/manifest.yaml"),
      "ATLAS_REALM_REQUIRED_FILE",
    ],
    [
      "manifest syntax",
      replaceFile(files(), ".atlas/realm/manifest.yaml", "realm: [\n"),
      "ATLAS_REALM_YAML_SYNTAX",
    ],
    [
      "manifest root",
      replaceFile(files(), ".atlas/realm/manifest.yaml", "- value\n"),
      "ATLAS_REALM_YAML_OBJECT",
    ],
    [
      "manifest realm",
      replaceFile(
        files(),
        ".atlas/realm/manifest.yaml",
        manifest.replace(
          "realm:\n  id: realm:atlas-minimal\n  title: Atlas Minimal Realm\n",
          "realm: invalid\n",
        ),
      ),
      "ATLAS_REALM_REQUIRED_FIELD",
    ],
    [
      "manifest field",
      replaceFile(
        files(),
        ".atlas/realm/manifest.yaml",
        manifest.replace("  title: Atlas Minimal Realm\n", ""),
      ),
      "ATLAS_REALM_REQUIRED_FIELD",
    ],
    [
      "manifest version",
      replaceFile(
        files(),
        ".atlas/realm/manifest.yaml",
        manifest.replace("atlas.realm-manifest/v1", "atlas.realm-manifest/v2"),
      ),
      "ATLAS_REALM_UNSUPPORTED_SCHEMA",
    ],
    [
      "manifest unknown field",
      replaceFile(
        files(),
        ".atlas/realm/manifest.yaml",
        manifest.replace(
          "schema: atlas.realm-manifest/v1",
          "unexpected: true\nschema: atlas.realm-manifest/v1",
        ),
      ),
      "ATLAS_REALM_UNKNOWN_FIELD",
    ],
    [
      "frontmatter required",
      replaceFile(files(), ".atlas/index.md", index.slice(4)),
      "ATLAS_REALM_FRONTMATTER_REQUIRED",
    ],
    [
      "frontmatter closing",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("\n---\n\n# Atlas", "\n# Atlas"),
      ),
      "ATLAS_REALM_FRONTMATTER_UNTERMINATED",
    ],
    [
      "frontmatter mappings",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace(/realm:\n[\s\S]*?\n---/, "realm: invalid\n---"),
      ),
      "ATLAS_REALM_FRONTMATTER_ENVELOPE",
    ],
    [
      "frontmatter syntax",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("  id: bonfire:root", "  id: bonfire:root\n  id: duplicate"),
      ),
      "ATLAS_REALM_YAML_SYNTAX",
    ],
    [
      "page required field",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("  title: Atlas Minimal Realm\n", ""),
      ),
      "ATLAS_REALM_REQUIRED_FIELD",
    ],
    [
      "unknown type",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("type: bonfire", "type: mystery"),
      ),
      "ATLAS_REALM_UNKNOWN_ARCHETYPE",
    ],
    [
      "Atlas envelope unknown field",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("  id: bonfire:root", "  id: bonfire:root\n  mystery: true"),
      ),
      "ATLAS_REALM_UNKNOWN_FIELD",
    ],
    [
      "invalid provenance",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace(
          "  id: bonfire:root",
          "  id: bonfire:root\n  originating-operation: ''",
        ),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "page schema",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("\n  schema: 1.0.0", "\n  schema: 2.0.0"),
      ),
      "ATLAS_REALM_UNSUPPORTED_SCHEMA",
    ],
    [
      "missing envelope",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("  tags: []", "  tags: invalid"),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "invalid tag item",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("  tags: []", "  tags: [1]"),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "invalid audit",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("kind: human", "kind: robot"),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "missing audit timestamp",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("    at: 2026-08-17T00:00:00.000Z\n", ""),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "invalid audit actor",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace(
          "    by:\n      kind: human\n      name: Atlas fixture",
          "    by: invalid",
        ),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "title",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("# Atlas Minimal Realm", "# Wrong Realm"),
      ),
      "ATLAS_REALM_TITLE_MISMATCH",
    ],
    [
      "laws frontmatter",
      replaceFile(files(), ".atlas/realm/laws.md", laws.slice(4)),
      "ATLAS_REALM_FRONTMATTER_REQUIRED",
    ],
    [
      "laws closing",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("\n---\n\n# Realm", "\n# Realm"),
      ),
      "ATLAS_REALM_FRONTMATTER_UNTERMINATED",
    ],
    [
      "laws syntax",
      replaceFile(files(), ".atlas/realm/laws.md", laws.replace("laws: []", "laws: [")),
      "ATLAS_REALM_YAML_SYNTAX",
    ],
    [
      "laws required field",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("realm-schema: 1.0.0\n", ""),
      ),
      "ATLAS_REALM_REQUIRED_FIELD",
    ],
    [
      "laws schema",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("atlas.realm-laws/v1", "atlas.realm-laws/v2"),
      ),
      "ATLAS_REALM_UNSUPPORTED_SCHEMA",
    ],
    [
      "laws fields",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("laws: []", "laws: invalid"),
      ),
      "ATLAS_REALM_LAWS_FIELDS",
    ],
    [
      "laws item shape",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("laws: []", "laws:\n  - invalid"),
      ),
      "ATLAS_REALM_LAWS_FIELDS",
    ],
    [
      "laws approval timestamp",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("at: 2026-08-17T00:00:00.000Z", "at: not-a-date"),
      ),
      "ATLAS_REALM_LAWS_FIELDS",
    ],
    [
      "laws human approval",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("kind: human", "kind: agent"),
      ),
      "ATLAS_REALM_LAWS_FIELDS",
    ],
    [
      "laws title",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("# Realm Laws", "# Other Laws"),
      ),
      "ATLAS_REALM_TITLE_MISMATCH",
    ],
  ];
  for (const [label, input, code] of cases) {
    const result = loadRealm(input, combineRealmDigest);
    assert.equal(result.valid, false, label);
    assert.ok(
      result.findings.some((finding) => finding.code === code),
      label,
    );
  }
  const nestedUnknown = loadRealm(
    replaceFile(
      files(),
      ".atlas/realm/manifest.yaml",
      manifest.replace(
        "  title: Atlas Minimal Realm",
        "  unexpected: true\n  title: Atlas Minimal Realm",
      ),
    ),
    combineRealmDigest,
  );
  assert.equal(nestedUnknown.valid, false);
  const unknownFinding = nestedUnknown.findings.find(
    (finding) =>
      finding.code === "ATLAS_REALM_UNKNOWN_FIELD" &&
      finding.message.includes("unexpected"),
  );
  assert.equal(unknownFinding?.location.column, 3);
  const nestedManifestText = manifest.replace(
    "  title: Atlas Minimal Realm",
    "  atlas-schema: invalid\n  title: Atlas Minimal Realm",
  );
  const nestedManifest = loadRealm(
    replaceFile(files(), ".atlas/realm/manifest.yaml", nestedManifestText),
    combineRealmDigest,
  );
  assert.equal(nestedManifest.valid, false);
  const nestedManifestFinding = nestedManifest.findings.find(
    (finding) =>
      finding.code === "ATLAS_REALM_UNKNOWN_FIELD" &&
      finding.message.includes("atlas-schema"),
  );
  assert.ok(nestedManifestFinding);
  assert.equal(
    nestedManifestFinding.location.line,
    nestedManifestText
      .split("\n")
      .findIndex((line) => line === "  atlas-schema: invalid") + 1,
  );
  const invalidUpdatedText = index.replace(
    "updated:\n    at: 2026-08-17T00:00:00.000Z",
    "updated:\n    at: not-a-date",
  );
  const invalidUpdated = loadRealm(
    replaceFile(files(), ".atlas/index.md", invalidUpdatedText),
    combineRealmDigest,
  );
  assert.equal(invalidUpdated.valid, false);
  const auditFinding = invalidUpdated.findings.find(
    (finding) => finding.code === "ATLAS_REALM_INVALID_ENVELOPE",
  );
  assert.ok(auditFinding);
  assert.equal(
    auditFinding.location.line,
    invalidUpdatedText.split("\n").findIndex((line) => line.includes("not-a-date")) + 1,
  );
  assert.equal(auditFinding.location.column, 5);
  for (const quotedKey of ['"at"', "'at'"]) {
    const quotedAuditText = index.replace(
      "updated:\n    at: 2026-08-17T00:00:00.000Z",
      `updated:\n    ${quotedKey}: not-a-date`,
    );
    const quotedAudit = loadRealm(
      replaceFile(files(), ".atlas/index.md", quotedAuditText),
      combineRealmDigest,
    );
    assert.equal(quotedAudit.valid, false);
    const quotedAuditFinding = quotedAudit.findings.find(
      (finding) => finding.code === "ATLAS_REALM_INVALID_ENVELOPE",
    );
    assert.ok(quotedAuditFinding);
    assert.equal(
      quotedAuditFinding.location.line,
      quotedAuditText.split("\n").findIndex((line) => line.includes("not-a-date")) + 1,
    );
  }
  const colonKeyAuditText = index
    .replace("atlas:", 'atlas:\n  "foo:bar": value')
    .replace(
      "updated:\n    at: 2026-08-17T00:00:00.000Z",
      'updated:\n    "at": not-a-date',
    );
  const colonKeyAudit = loadRealm(
    replaceFile(files(), ".atlas/index.md", colonKeyAuditText),
    combineRealmDigest,
  );
  assert.equal(colonKeyAudit.valid, false);
  assert.ok(
    colonKeyAudit.findings.some(
      (finding) => finding.code === "ATLAS_REALM_INVALID_ENVELOPE",
    ),
  );
  const escapedKeyAuditText = index
    .replace(
      "atlas:",
      String.raw`atlas:
  "x\x41": value`,
    )
    .replace(
      "updated:\n    at: 2026-08-17T00:00:00.000Z",
      'updated:\n    "at": not-a-date',
    );
  assert.doesNotThrow(() =>
    loadRealm(
      replaceFile(files(), ".atlas/index.md", escapedKeyAuditText),
      combineRealmDigest,
    ),
  );
  const offsetTimestamp = loadRealm(
    replaceFile(
      files(),
      ".atlas/index.md",
      index.replace("at: 2026-08-17T00:00:00.000Z", "at: 2026-08-17T01:30:00+01:30"),
    ),
    combineRealmDigest,
  );
  assert.equal(
    offsetTimestamp.findings.some(
      (finding) => finding.code === "ATLAS_REALM_INVALID_ENVELOPE",
    ),
    false,
  );
});

test("text and canonical input failures are stable Findings", () => {
  const config = readFileSync(join(FIXTURE, ".atlas/realm/config.yaml"), "utf8");
  const oversized = new Uint8Array(1024 * 1024 + 1);
  oversized.fill(97);
  const invalidUtf8 = Uint8Array.from([0xc3, 0x28, 0x0a]);
  const cases: ReadonlyArray<readonly [readonly SourceFile[], string]> = [
    [
      replaceFile(files(), ".atlas/realm/config.yaml", oversized),
      "ATLAS_REALM_FILE_TOO_LARGE",
    ],
    [
      replaceFile(files(), ".atlas/realm/config.yaml", invalidUtf8),
      "ATLAS_REALM_INVALID_UTF8",
    ],
    [
      replaceFile(files(), ".atlas/realm/config.yaml", "source-authorities:\0 []\n"),
      "ATLAS_REALM_BINARY_FILE",
    ],
    [
      replaceFile(files(), ".atlas/realm/config.yaml", config.replaceAll("\n", "\r\n")),
      "ATLAS_REALM_LINE_ENDINGS",
    ],
    [
      replaceFile(files(), ".atlas/realm/config.yaml", config.trimEnd()),
      "ATLAS_REALM_FINAL_NEWLINE",
    ],
    [
      replaceFile(
        files(),
        ".atlas/realm/config.yaml",
        "source-authorities: [official]\n",
      ),
      "ATLAS_REALM_NON_CANONICAL",
    ],
    [
      replaceFile(
        files(),
        ".atlas/realm/config.yaml",
        `\u{10000}: astral\n\u{e000}: bmp\n${config}`,
      ),
      "ATLAS_REALM_NON_CANONICAL",
    ],
    [
      replaceFile(files(), ".atlas/realm/schemas/1.0.0/schema.json", "{]\n"),
      "ATLAS_REALM_JSON_SYNTAX",
    ],
    [
      replaceFile(
        files(),
        ".atlas/realm/config.yaml",
        "value: &self\n  child: *self\n",
      ),
      "ATLAS_REALM_YAML_ALIAS",
    ],
    [
      replaceFile(
        files(),
        ".atlas/index.md",
        readFileSync(join(FIXTURE, ".atlas/index.md"), "utf8").replace(
          "---\n\n# Atlas Minimal Realm",
          "---\n# Atlas Minimal Realm",
        ),
      ),
      "ATLAS_REALM_NON_CANONICAL",
    ],
    [
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        readFileSync(join(FIXTURE, ".atlas/realm/laws.md"), "utf8").replace(
          "---\n\n# Realm Laws",
          "---\n# Realm Laws",
        ),
      ),
      "ATLAS_REALM_NON_CANONICAL",
    ],
  ];
  for (const [input, code] of cases) {
    assert.ok(findingCodes(input).includes(code), code);
  }
});

test("object and graph invariants produce distinct Findings", () => {
  const index = readFileSync(join(FIXTURE, ".atlas/index.md"), "utf8");
  const lore = readFileSync(join(FIXTURE, ".atlas/lore/atlas-contract.md"), "utf8");
  const insight = readFileSync(join(FIXTURE, ".atlas/insights/realm-files.md"), "utf8");
  const thread = readFileSync(
    join(FIXTURE, ".atlas/threads/root-to-insight.md"),
    "utf8",
  );
  const pillar = readFileSync(
    join(FIXTURE, ".atlas/pillars/knowledge-integrity.md"),
    "utf8",
  );
  const cases: ReadonlyArray<readonly [readonly SourceFile[], string]> = [
    [[...files(), files()[0] as SourceFile], "ATLAS_REALM_DUPLICATE_PATH"],
    [
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace("insight:realm-files", "bonfire:root"),
      ),
      "ATLAS_REALM_DUPLICATE_ID",
    ],
    [
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("type: bonfire", "type: insight"),
      ),
      "ATLAS_REALM_ROOT_NOT_BONFIRE",
    ],
    [
      replaceFile(
        files(),
        ".atlas/threads/root-to-insight.md",
        thread.replace(
          "  endpoints:\n    - bonfire:root\n    - insight:realm-files",
          "  endpoints: invalid",
        ),
      ),
      "ATLAS_REALM_THREAD_ENDPOINTS",
    ],
    [
      removeFile(files(), ".atlas/threads/root-to-insight.md"),
      "ATLAS_REALM_INSIGHT_ORPHAN",
    ],
    [
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("  root: true", "  root: invalid"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
    [
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace("  heresy: false", "  heresy: invalid"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
    [
      replaceFile(
        files(),
        ".atlas/lore/atlas-contract.md",
        lore.replace("  authority: official", "  authority:"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
    [
      replaceFile(
        files(),
        ".atlas/pillars/knowledge-integrity.md",
        pillar.replace("  approved: true", "  approved: invalid"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
    [
      replaceFile(
        files(),
        ".atlas/threads/root-to-insight.md",
        thread.replace("  relationships:", "  relationships: invalid\n  ignored:"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
  ];
  for (const [input, code] of cases) {
    assert.ok(findingCodes(input).includes(code), code);
  }
});

test("Realm schema, graph, catalog, and Citation contracts fail closed", () => {
  const manifest = readFileSync(join(FIXTURE, ".atlas/realm/manifest.yaml"), "utf8");
  const laws = readFileSync(join(FIXTURE, ".atlas/realm/laws.md"), "utf8");
  const index = readFileSync(join(FIXTURE, ".atlas/index.md"), "utf8");
  const insight = readFileSync(join(FIXTURE, ".atlas/insights/realm-files.md"), "utf8");
  const lore = readFileSync(join(FIXTURE, ".atlas/lore/atlas-contract.md"), "utf8");
  const thread = readFileSync(
    join(FIXTURE, ".atlas/threads/root-to-insight.md"),
    "utf8",
  );
  const relationships = readFileSync(
    join(FIXTURE, ".atlas/realm/schemas/1.0.0/relationships.yaml"),
    "utf8",
  );
  const schemaText = readFileSync(
    join(FIXTURE, ".atlas/realm/schemas/1.0.0/schema.json"),
    "utf8",
  );
  const duplicateBytes = Buffer.from(
    thread.replace("thread:root-to-insight", "thread:duplicate-pair"),
  );
  const secondRootBytes = Buffer.from(
    index
      .replace("bonfire:root", "bonfire:second")
      .replaceAll("Atlas Minimal Realm", "Second Bonfire"),
  );
  const cases: ReadonlyArray<readonly [string, readonly SourceFile[], string]> = [
    [
      "manifest schema bundle",
      replaceFile(
        files(),
        ".atlas/realm/manifest.yaml",
        manifest.replace("realm-schema: 1.0.0", "realm-schema: 9.9.9"),
      ),
      "ATLAS_REALM_REQUIRED_FILE",
    ],
    [
      "page schema mismatch",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("realm-schema: 1.0.0", "realm-schema: 9.9.9"),
      ),
      "ATLAS_REALM_SCHEMA_MISMATCH",
    ],
    [
      "Laws schema mismatch",
      replaceFile(
        files(),
        ".atlas/realm/laws.md",
        laws.replace("realm-schema: 1.0.0", "realm-schema: 9.9.9"),
      ),
      "ATLAS_REALM_UNSUPPORTED_SCHEMA",
    ],
    [
      "schema artifact",
      replaceFile(files(), ".atlas/realm/schemas/1.0.0/schema.json", "{}\n"),
      "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
    ],
    [
      "unsafe schema pattern",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/schema.json",
        `${JSON.stringify(
          {
            ...(JSON.parse(schemaText) as Record<string, unknown>),
            properties: {
              custom: { type: "string", pattern: "^(a+)+$" },
            },
          },
          null,
          2,
        )}\n`,
      ),
      "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
    ],
    [
      "unsafe schema pattern properties",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/schema.json",
        `${JSON.stringify(
          {
            ...(JSON.parse(schemaText) as Record<string, unknown>),
            patternProperties: { "^x": { type: "string" } },
          },
          null,
          2,
        )}\n`,
      ),
      "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
    ],
    [
      "async schema",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/schema.json",
        `${JSON.stringify(
          {
            ...(JSON.parse(schemaText) as Record<string, unknown>),
            $async: true,
          },
          null,
          2,
        )}\n`,
      ),
      "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
    ],
    [
      "recursive schema",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/schema.json",
        `${JSON.stringify(
          {
            ...(JSON.parse(schemaText) as Record<string, unknown>),
            allOf: [{ $ref: "#" }],
          },
          null,
          2,
        )}\n`,
      ),
      "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
    ],
    [
      "dynamic recursive schema",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/schema.json",
        `${JSON.stringify(
          {
            ...(JSON.parse(schemaText) as Record<string, unknown>),
            $dynamicAnchor: "node",
            properties: {
              child: { $dynamicRef: "#node" },
            },
          },
          null,
          2,
        )}\n`,
      ),
      "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
    ],
    [
      "schema compilation",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/schema.json",
        `${JSON.stringify(
          {
            ...(JSON.parse(schemaText) as Record<string, unknown>),
            unknownKeyword: true,
          },
          null,
          2,
        )}\n`,
      ),
      "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
    ],
    [
      "undeclared Realm field",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("  root: true", "  custom: value\n  root: true"),
      ),
      "ATLAS_REALM_SCHEMA_VALIDATION",
    ],
    [
      "relationship registry",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/relationships.yaml",
        relationships.replace("relationships: []", "relationships: invalid"),
      ),
      "ATLAS_REALM_RELATIONSHIP_REGISTRY_INVALID",
    ],
    [
      "relationship descriptor",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/relationships.yaml",
        "relationships:\n  - {}\n",
      ),
      "ATLAS_REALM_RELATIONSHIP_REGISTRY_INVALID",
    ],
    [
      "relationship type",
      replaceFile(
        files(),
        ".atlas/threads/root-to-insight.md",
        thread.replace("    - orients", "    - mystery"),
      ),
      "ATLAS_REALM_RELATIONSHIP_UNKNOWN",
    ],
    [
      "root marker",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("  root: true", "  root: false"),
      ),
      "ATLAS_REALM_ROOT_NOT_BONFIRE",
    ],
    [
      "multiple roots",
      [
        ...replaceFile(
          files(),
          ".atlas/index.md",
          index.replace("  catalog:", "  catalog:\n    - bonfire:second"),
        ),
        {
          path: ".atlas/bonfires/second.md",
          bytes: secondRootBytes,
          digest: sha256(secondRootBytes),
        },
      ],
      "ATLAS_REALM_MULTIPLE_ROOTS",
    ],
    [
      "audit timestamp",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("at: 2026-08-17T00:00:00.000Z", "at: not-a-date"),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "invalid calendar timestamp",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("at: 2026-08-17T00:00:00.000Z", "at: 2025-02-30T00:00:00Z"),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "audit actor name",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("name: Atlas fixture", "name: ''"),
      ),
      "ATLAS_REALM_INVALID_ENVELOPE",
    ],
    [
      "Lore timestamp",
      replaceFile(
        files(),
        ".atlas/lore/atlas-contract.md",
        lore.replace("gathered-at: 2026-08-17T00:00:00.000Z", "gathered-at: invalid"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
    [
      "Lore authority",
      replaceFile(
        files(),
        ".atlas/lore/atlas-contract.md",
        lore.replace("authority: official", "authority: ''"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
    [
      "Lore source kind",
      replaceFile(
        files(),
        ".atlas/lore/atlas-contract.md",
        lore.replace("kind: repository", "kind: ''"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
    [
      "missing root marker",
      replaceFile(files(), ".atlas/index.md", index.replace("  root: true\n", "")),
      "ATLAS_REALM_ROOT_NOT_BONFIRE",
    ],
    [
      "catalog target",
      replaceFile(
        files(),
        ".atlas/index.md",
        index.replace("    - insight:realm-files", "    - insight:missing"),
      ),
      "ATLAS_REALM_CATALOG_TARGET_MISSING",
    ],
    [
      "unreachable Pillar",
      removeFile(
        replaceFile(
          files(),
          ".atlas/index.md",
          index.replace("    - pillar:knowledge-integrity\n", ""),
        ),
        ".atlas/threads/root-to-pillar.md",
      ),
      "ATLAS_REALM_OBJECT_UNREACHABLE",
    ],
    [
      "Lore endpoint",
      replaceFile(
        files(),
        ".atlas/threads/root-to-pillar.md",
        readFileSync(join(FIXTURE, ".atlas/threads/root-to-pillar.md"), "utf8").replace(
          "    - pillar:knowledge-integrity",
          "    - lore:atlas-contract",
        ),
      ),
      "ATLAS_REALM_THREAD_ENDPOINT_TYPE",
    ],
    [
      "inline missing endpoint",
      replaceFile(
        files(),
        ".atlas/threads/root-to-insight.md",
        thread.replace(
          "  endpoints:\n    - bonfire:root\n    - insight:realm-files",
          "  endpoints: [bonfire:root, insight:missing]",
        ),
      ),
      "ATLAS_REALM_THREAD_TARGET_MISSING",
    ],
    [
      "duplicate pair",
      [
        ...files(),
        {
          path: ".atlas/threads/duplicate-pair.md",
          bytes: duplicateBytes,
          digest: sha256(duplicateBytes),
        },
      ],
      "ATLAS_REALM_THREAD_PAIR_DUPLICATE",
    ],
    [
      "self Thread",
      replaceFile(
        files(),
        ".atlas/threads/root-to-pillar.md",
        readFileSync(join(FIXTURE, ".atlas/threads/root-to-pillar.md"), "utf8").replace(
          "    - pillar:knowledge-integrity",
          "    - bonfire:root",
        ),
      ),
      "ATLAS_REALM_THREAD_ENDPOINTS",
    ],
    [
      "empty relationships",
      replaceFile(
        files(),
        ".atlas/threads/root-to-insight.md",
        thread.replace("  relationships:\n    - orients", "  relationships: []"),
      ),
      "ATLAS_REALM_ARCHETYPE_FIELDS",
    ],
    [
      "Citation required",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight
          .replace("[^atlas-contract]", "")
          .replace(/\n\[\^atlas-contract\]:.*\n/, "\n"),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in code fence",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "```markdown\n[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.\n```",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in indented code fence",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "   ~~~markdown\n   [^atlas-contract]\n\n   [^atlas-contract]: [[lore/atlas-contract]] supports this claim.\n   ~~~",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in indented code block",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "    [^atlas-contract]\n\n    [^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in blockquote fence",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "> ```markdown\n> [^atlas-contract]\n>\n> [^atlas-contract]: [[lore/atlas-contract]] supports this claim.\n> ```",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in raw HTML block",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "<pre>\n[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.\n</pre>",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in CDATA block",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "<![CDATA[\n[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.\n]]>",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in processing instruction",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "<?atlas\n[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.\n?>",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in HTML declaration",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "<!ATLAS [^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.>",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in multiline HTML block",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          '<div\nclass="evidence">\n[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.\n</div>',
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in multi-backtick code span",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "``[^atlas-contract]``\n\n``[^atlas-contract]: [[lore/atlas-contract]] supports this claim.``",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in link destination",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "[source](https://example.invalid/[^atlas-contract])\n\n[source definition](https://example.invalid/[^atlas-contract]:%20[[lore/atlas-contract]])",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation in unclosed HTML comment",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(
          "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
          "<!--\n[^atlas-contract]\n\n[^atlas-contract]: [[lore/atlas-contract]] supports this claim.",
        ),
      ),
      "ATLAS_REALM_CITATION_REQUIRED",
    ],
    [
      "Citation definition",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace(/\n\[\^atlas-contract\]:.*\n/, "\n"),
      ),
      "ATLAS_REALM_CITATION_DEFINITION_MISSING",
    ],
    [
      "Citation target",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace("[[lore/atlas-contract]]", "[[insights/realm-files]]"),
      ),
      "ATLAS_REALM_CITATION_TARGET_INVALID",
    ],
    [
      "missing Citation target",
      replaceFile(
        files(),
        ".atlas/insights/realm-files.md",
        insight.replace("[[lore/atlas-contract]]", "[[lore/missing]]"),
      ),
      "ATLAS_REALM_CITATION_TARGET_INVALID",
    ],
    [
      "relationship registry root",
      replaceFile(files(), ".atlas/realm/schemas/1.0.0/relationships.yaml", "[]\n"),
      "ATLAS_REALM_YAML_OBJECT",
    ],
    [
      "relationship registry syntax",
      replaceFile(
        files(),
        ".atlas/realm/schemas/1.0.0/relationships.yaml",
        "relationships: [\n",
      ),
      "ATLAS_REALM_YAML_SYNTAX",
    ],
  ];
  for (const [label, input, code] of cases) {
    assert.ok(findingCodes(input).includes(code), label);
  }
  const inlineHtmlCitation = loadRealm(
    replaceFile(
      files(),
      ".atlas/insights/realm-files.md",
      insight.replace(
        "Realm knowledge remains directly readable beneath `.atlas/`.[^atlas-contract]",
        "<span>Realm</span> claim.[^atlas-contract]",
      ),
    ),
    combineRealmDigest,
  );
  assert.equal(
    inlineHtmlCitation.findings.some(
      (finding) => finding.code === "ATLAS_REALM_CITATION_REQUIRED",
    ),
    false,
  );
  const inlineThread = thread.replace(
    "  endpoints:\n    - bonfire:root\n    - insight:realm-files",
    "  endpoints: [bonfire:root, insight:missing]",
  );
  const inlineResult = loadRealm(
    replaceFile(files(), ".atlas/threads/root-to-insight.md", inlineThread),
    combineRealmDigest,
  );
  assert.equal(inlineResult.valid, false);
  const inlineFinding = inlineResult.findings.find(
    (finding) => finding.code === "ATLAS_REALM_THREAD_TARGET_MISSING",
  );
  assert.ok(inlineFinding);
  assert.equal(
    inlineFinding.location.line,
    inlineThread.split("\n").findIndex((line) => line.includes("endpoints:")) + 1,
  );
  assert.ok(inlineFinding.location.column > 1);
  const quotedThread = thread.replace("    - insight:realm-files", '    - "#missing"');
  const quotedResult = loadRealm(
    replaceFile(files(), ".atlas/threads/root-to-insight.md", quotedThread),
    combineRealmDigest,
  );
  assert.equal(quotedResult.valid, false);
  const quotedFinding = quotedResult.findings.find(
    (finding) => finding.code === "ATLAS_REALM_THREAD_TARGET_MISSING",
  );
  assert.ok(quotedFinding);
  assert.equal(
    quotedFinding.location.line,
    quotedThread.split("\n").findIndex((line) => line.includes('"#missing"')) + 1,
  );
  assert.ok(quotedFinding.location.column > 1);
  const substringThread = thread
    .replace("  tags: []", "  tags:\n    - insight:missing-suffix")
    .replace("    - insight:realm-files", "    - insight:missing");
  const substringResult = loadRealm(
    replaceFile(files(), ".atlas/threads/root-to-insight.md", substringThread),
    combineRealmDigest,
  );
  assert.equal(substringResult.valid, false);
  const substringFinding = substringResult.findings.find(
    (finding) => finding.code === "ATLAS_REALM_THREAD_TARGET_MISSING",
  );
  assert.ok(substringFinding);
  assert.equal(
    substringFinding.location.line,
    substringThread
      .split("\n")
      .findIndex((line) => line.trim() === "- insight:missing") + 1,
  );
  const undeclaredExtension = loadRealm(
    replaceFile(
      files(),
      ".atlas/index.md",
      index.replace("  root: true", "  custom: value\n  root: true"),
    ),
    combineRealmDigest,
  );
  assert.equal(undeclaredExtension.valid, false);
  const extensionFinding = undeclaredExtension.findings.find(
    (finding) => finding.code === "ATLAS_REALM_SCHEMA_VALIDATION",
  );
  assert.equal(extensionFinding?.location.column, 3);
  const quotedExtension = loadRealm(
    replaceFile(
      files(),
      ".atlas/index.md",
      index.replace("  root: true", '  "#custom": value\n  root: true'),
    ),
    combineRealmDigest,
  );
  assert.equal(quotedExtension.valid, false);
  const quotedExtensionFinding = quotedExtension.findings.find(
    (finding) => finding.code === "ATLAS_REALM_SCHEMA_VALIDATION",
  );
  assert.ok(quotedExtensionFinding);
  assert.ok(quotedExtensionFinding.location.line > 1);
  assert.equal(quotedExtensionFinding.location.column, 4);
  const singleQuotedExtension = loadRealm(
    replaceFile(
      files(),
      ".atlas/index.md",
      index.replace("  root: true", "  '#custom': value\n  root: true"),
    ),
    combineRealmDigest,
  );
  assert.equal(singleQuotedExtension.valid, false);
  const singleQuotedFinding = singleQuotedExtension.findings.find(
    (finding) => finding.code === "ATLAS_REALM_SCHEMA_VALIDATION",
  );
  assert.ok(singleQuotedFinding);
  assert.ok(singleQuotedFinding.location.line > 1);
  assert.equal(singleQuotedFinding.location.column, 4);
  const collidingExtensionText = index.replace(
    "  root: true",
    "  id: extension-id\n  root: true",
  );
  const collidingExtension = loadRealm(
    replaceFile(files(), ".atlas/index.md", collidingExtensionText),
    combineRealmDigest,
  );
  assert.equal(collidingExtension.valid, false);
  const collidingFinding = collidingExtension.findings.find(
    (finding) => finding.code === "ATLAS_REALM_SCHEMA_VALIDATION",
  );
  assert.ok(collidingFinding);
  assert.equal(
    collidingFinding.location.line,
    collidingExtensionText
      .split("\n")
      .findIndex((line) => line.trim() === "id: extension-id") + 1,
  );
  const escapedRealmText = index
    .replace("realm:", String.raw`"re\u0061lm":`)
    .replace("  root: true", "  custom: value\n  root: true");
  const escapedRealm = loadRealm(
    replaceFile(files(), ".atlas/index.md", escapedRealmText),
    combineRealmDigest,
  );
  assert.equal(escapedRealm.valid, false);
  const escapedRealmFinding = escapedRealm.findings.find(
    (finding) => finding.code === "ATLAS_REALM_SCHEMA_VALIDATION",
  );
  assert.ok(escapedRealmFinding);
  assert.ok(escapedRealmFinding.location.line > 1);

  for (const registry of [
    "relationships:\n  - custom\n",
    "relationships:\n  - id: custom\n",
  ]) {
    const custom = replaceFile(
      replaceFile(files(), ".atlas/realm/schemas/1.0.0/relationships.yaml", registry),
      ".atlas/threads/root-to-insight.md",
      thread.replace("    - orients", "    - custom"),
    );
    const result = loadRealm(custom, combineRealmDigest);
    assert.equal(
      result.findings.some(
        (finding) => finding.code === "ATLAS_REALM_RELATIONSHIP_UNKNOWN",
      ),
      false,
    );
  }

  const extensionSchema = JSON.parse(schemaText) as {
    properties: Record<string, unknown>;
    required?: string[];
  };
  extensionSchema.properties["custom"] = { type: "string" };
  const declaredExtension = replaceFile(
    replaceFile(
      files(),
      ".atlas/realm/schemas/1.0.0/schema.json",
      `${JSON.stringify(extensionSchema, null, 2)}\n`,
    ),
    ".atlas/index.md",
    index.replace("  root: true", "  custom: value\n  root: true"),
  );
  const extensionResult = loadRealm(declaredExtension, combineRealmDigest);
  assert.equal(
    extensionResult.findings.some(
      (finding) => finding.code === "ATLAS_REALM_SCHEMA_VALIDATION",
    ),
    false,
  );

  const invalidExtension = replaceFile(
    declaredExtension,
    ".atlas/index.md",
    index.replace("  root: true", "  custom: false\n  root: true"),
  );
  assert.ok(findingCodes(invalidExtension).includes("ATLAS_REALM_SCHEMA_VALIDATION"));

  extensionSchema.required = ["custom"];
  const requiredSchema = replaceFile(
    files(),
    ".atlas/realm/schemas/1.0.0/schema.json",
    `${JSON.stringify(extensionSchema, null, 2)}\n`,
  );
  assert.ok(findingCodes(requiredSchema).includes("ATLAS_REALM_SCHEMA_VALIDATION"));

  const rootFailureSchema = {
    ...(JSON.parse(schemaText) as Record<string, unknown>),
    not: {},
  };
  const rootFailure = loadRealm(
    replaceFile(
      files(),
      ".atlas/realm/schemas/1.0.0/schema.json",
      `${JSON.stringify(rootFailureSchema, null, 2)}\n`,
    ),
    combineRealmDigest,
  );
  assert.equal(rootFailure.valid, false);
  assert.ok(
    rootFailure.findings.some(
      (finding) =>
        finding.code === "ATLAS_REALM_SCHEMA_VALIDATION" && finding.location.line > 1,
    ),
  );
});

test("Finding comparison reaches every stable tie-breaker", () => {
  const base: Finding = {
    schema: FINDING_SCHEMA,
    check: { id: "b", origin: "trusted-atlas" },
    severity: "error",
    code: "B",
    message: "message",
    location: { path: "b", line: 2, column: 2 },
    remediation: "repair",
  };
  assert.ok(
    compareFindings({ ...base, location: { ...base.location, path: "a" } }, base) < 0,
  );
  assert.equal(compareText("same", "same"), 0);
  assert.ok(compareText("z", "a") > 0);
  assert.ok(compareText("\u{e000}", "\u{10000}") < 0);
  assert.ok(compareText("a", "aa") < 0);
  assert.ok(
    compareFindings({ ...base, location: { ...base.location, line: 1 } }, base) < 0,
  );
  assert.ok(
    compareFindings({ ...base, location: { ...base.location, column: 1 } }, base) < 0,
  );
  assert.ok(compareFindings({ ...base, code: "A" }, base) < 0);
  assert.ok(compareFindings({ ...base, check: { ...base.check, id: "a" } }, base) < 0);
  assert.equal(compareFindings(base, base), 0);
});

test("canonical CLI handles success, blocked results, usage, and failures", () => {
  const success = captureMain(["weave", "--json", "--realm", FIXTURE]);
  assert.equal(success.code, 0);
  assert.equal(success.stderr, "");
  assert.equal(resultStatus(success.stdout), "completed");

  const invalid = join(WORKSPACES, "invalid");
  cpSync(FIXTURE, invalid, { recursive: true });
  rmSync(join(invalid, ".atlas/realm/config.yaml"));
  const blocked = captureMain(["weave", "--json", "--realm", invalid]);
  assert.equal(blocked.code, 1);
  assert.equal(resultStatus(blocked.stdout), "blocked");

  assert.equal(captureMain([]).code, 2);
  assert.equal(captureMain(["weave", "--json", "--realm"]).code, 2);
  assert.equal(captureMain(["weave", "--json", "--realm", "--json"]).code, 2);
  assert.equal(captureMain(["weave", "--json", "--unknown"]).code, 2);

  const missing = captureMain([
    "weave",
    "--json",
    "--realm",
    join(WORKSPACES, "missing"),
  ]);
  assert.equal(missing.code, 1);
  assert.equal(resultStatus(missing.stdout), "failed");
  assert.equal(
    (JSON.parse(missing.stdout) as { failure: { message: string } }).failure.message,
    "Realm loading failed.",
  );
});

test("filesystem loader rejects symlinks and non-regular Realm entries", () => {
  const atlasLink = join(WORKSPACES, "atlas-link");
  mkdirSync(atlasLink);
  symlinkSync(join(FIXTURE, ".atlas"), join(atlasLink, ".atlas"));
  assert.throws(() => readRealmFiles(atlasLink), /escaped/);

  const fileLink = join(WORKSPACES, "file-link");
  cpSync(FIXTURE, fileLink, { recursive: true });
  rmSync(join(fileLink, ".atlas/realm/config.yaml"));
  symlinkSync(
    join(FIXTURE, ".atlas/realm/config.yaml"),
    join(fileLink, ".atlas/realm/config.yaml"),
  );
  assert.throws(() => readRealmFiles(fileLink), /symbolic link/);

  if (process.platform !== "win32") {
    const fifoRealm = join(WORKSPACES, "fifo");
    cpSync(FIXTURE, fifoRealm, { recursive: true });
    const fifo = join(fifoRealm, ".atlas/realm/pipe");
    const created = spawnSync("mkfifo", [fifo]);
    assert.equal(created.status, 0);
    assert.throws(() => readRealmFiles(fifoRealm), /regular file/);
  }

  const realAtlasRoot = resolve(FIXTURE, ".atlas");
  assert.doesNotThrow(() =>
    assertRealmDirectory(join(realAtlasRoot, "realm"), realAtlasRoot),
  );
  assert.throws(() => assertRealmDirectory(ROOT, realAtlasRoot), /escaped/);
  assert.throws(() => readRegularFile(realAtlasRoot, realAtlasRoot), /regular file/);
  assert.equal(
    isStableContainedPath(
      join(realAtlasRoot, "realm"),
      join(realAtlasRoot, "realm"),
      realAtlasRoot,
    ),
    true,
  );
  assert.equal(
    isStableContainedPath(
      join(realAtlasRoot, "realm"),
      join(realAtlasRoot, "schemas"),
      realAtlasRoot,
    ),
    false,
  );
  assert.equal(isStableContainedPath(ROOT, ROOT, realAtlasRoot), false);
  const snapshot = {
    dev: 1,
    ino: 2,
    size: 3,
    mtimeMs: 4,
    ctimeMs: 5,
  };
  assert.doesNotThrow(() =>
    assertStableFileRead(snapshot, snapshot, snapshot.size, "realm.md"),
  );
  assert.throws(
    () =>
      assertStableFileRead(
        snapshot,
        { ...snapshot, size: snapshot.size + 1 },
        snapshot.size,
        "realm.md",
      ),
    /changed/,
  );

  const oversizedRealm = join(WORKSPACES, "oversized");
  cpSync(FIXTURE, oversizedRealm, { recursive: true });
  writeFileSync(
    join(oversizedRealm, ".atlas/oversized.md"),
    Buffer.alloc(MAX_REALM_FILE_BYTES + 1, 97),
  );
  assert.throws(() => readRealmFiles(oversizedRealm), /exceeds/);
  assert.doesNotThrow(() => enforceRealmBudget(MAX_REALM_FILES, MAX_REALM_TOTAL_BYTES));
  assert.throws(() => enforceRealmBudget(MAX_REALM_FILES + 1, 0), /files/);
  assert.throws(() => enforceRealmBudget(1, MAX_REALM_TOTAL_BYTES + 1), /aggregate/);
});

test("YAML parser faults become stable Findings", () => {
  const findings: Finding[] = [];
  const throwingParser = (() => {
    throw new RangeError("nesting limit");
  }) as typeof parseDocument;
  assert.equal(
    parseYaml("realm.yaml", "value: true\n", findings, throwingParser),
    null,
  );
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ["ATLAS_REALM_YAML_SYNTAX"],
  );
  assert.equal(findings[0]?.location.line, 1);
  const offsetFindings: Finding[] = [];
  assert.equal(
    parseYaml("frontmatter.md", "atlas: ]\n", offsetFindings, parseDocument, 1),
    null,
  );
  assert.equal(offsetFindings[0]?.location.line, 2);
});

test("failed result preserves Error and non-Error messages", () => {
  const error = failedWeaveResult("broken");
  assert.equal(error.status, "failed");
  assert.equal(error.failure.message, "broken");
  assert.equal(error.handoff.validation.state, "failed");
  assert.equal(error.handoff.homeRealm.id, null);

  const noManifest = weaveRealm(
    removeFile(files(), ".atlas/realm/manifest.yaml"),
    combineRealmDigest,
  );
  assert.equal(noManifest.handoff.homeRealm.title, null);

  const original = files()[0] as SourceFile;
  assert.notEqual(
    combineRealmDigest([original]),
    combineRealmDigest([{ ...original, bytes: Buffer.from("changed\n") }]),
  );
  assert.notEqual(
    combineRealmDigest([
      { path: "a", bytes: Buffer.from("b\0c\0d"), digest: "ignored" },
    ]),
    combineRealmDigest([
      { path: "a", bytes: Buffer.from("b"), digest: "ignored" },
      { path: "c", bytes: Buffer.from("d"), digest: "ignored" },
    ]),
  );
});

test("black-box canonical command exits with machine result", () => {
  const command = spawnSync(
    process.execPath,
    ["src/interfaces/atlas.ts", "weave", "--json", "--realm", FIXTURE],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(command.status, 0, command.stderr);
  assert.equal(resultStatus(command.stdout), "completed");

  const usage = spawnSync(process.execPath, ["src/interfaces/atlas.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: atlas weave/);

  const imported = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'process.argv.splice(1); await import("./src/interfaces/atlas.ts")',
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
});
