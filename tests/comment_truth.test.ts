import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkFinding } from "../src/domain/finding.ts";
import { validateCommentTruth } from "../src/lint/validate_comment_truth.ts";
import {
  collectTestFiles,
  formatFinding,
  main,
  validateRepository,
} from "../scripts/comment_truth.ts";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(ROOT, "scripts", "comment_truth.ts");

function scratchRepository(): string {
  const directory = join(
    ROOT,
    ".test-workspaces",
    `comment-truth-${String(process.pid)}-${randomUUID()}`,
  );
  mkdirSync(join(directory, "src", "lint"), { recursive: true });
  mkdirSync(join(directory, "tests"), { recursive: true });
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

test("an absolute claim with no test-file reference is reported", () => {
  const findings = validateCommentTruth(
    [
      {
        content:
          "// Ingest can never emit a duplicate Changelog entry.\nexport const x = 1;\n",
        path: "src/lint/example.ts",
      },
    ],
    new Set(["tests/example.test.ts"]),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "ATLAS_COMMENT_TRUTH_UNPINNED_ABSOLUTE_CLAIM");
  for (const finding of findings) assert.equal(checkFinding(finding), true);
});

test("an absolute claim naming a real test file is accepted", () => {
  const findings = validateCommentTruth(
    [
      {
        content:
          "// Ingest can never emit a duplicate Changelog entry (pinned by `tests/example.test.ts`).\nexport const x = 1;\n",
        path: "src/lint/example.ts",
      },
    ],
    new Set(["tests/example.test.ts"]),
  );
  assert.deepEqual(findings, []);
});

test("an absolute claim naming a test file that does not exist is still reported", () => {
  const findings = validateCommentTruth(
    [
      {
        content:
          "// This is always true (pinned by `tests/nonexistent.test.ts`).\nexport const x = 1;\n",
        path: "src/lint/example.ts",
      },
    ],
    new Set(["tests/example.test.ts"]),
  );
  assert.equal(findings.length, 1);
});

test("a JSDoc block comment is scanned as one block", () => {
  const findings = validateCommentTruth(
    [
      {
        content:
          "/**\n * This function is impossible to call twice\n * (pinned by `tests/example.test.ts`).\n */\nexport function f(): void {}\n",
        path: "src/lint/example.ts",
      },
    ],
    new Set(["tests/example.test.ts"]),
  );
  assert.deepEqual(findings, []);
});

test("a claim and its pin in two separate, non-adjacent comments do not satisfy each other", () => {
  const findings = validateCommentTruth(
    [
      {
        content:
          "// This can never happen.\n\nconst gap = 1;\n\n// See `tests/example.test.ts` for unrelated context.\nexport const x = gap;\n",
        path: "src/lint/example.ts",
      },
    ],
    new Set(["tests/example.test.ts"]),
  );
  assert.equal(findings.length, 1);
});

test("a // line beginning at column zero inside a JSDoc block is not scanned a second time", () => {
  const findings = validateCommentTruth(
    [
      {
        content:
          "/**\n * This can never happen (pinned by `tests/example.test.ts`).\n// nested line starting a comment run inside the block\n */\nexport const x = 1;\n",
        path: "src/lint/example.ts",
      },
    ],
    new Set(["tests/example.test.ts"]),
  );
  assert.deepEqual(findings, []);
});

test("ordinary prose without an absolute claim word does not fail", () => {
  const findings = validateCommentTruth(
    [
      {
        content:
          "// This is a canonical, canned, canyon-shaped example.\nexport const x = 1;\n",
        path: "src/lint/example.ts",
      },
    ],
    new Set(),
  );
  assert.deepEqual(findings, []);
});

test("the repository's own src/** doc comments are fully pinned or reworded", () => {
  assert.deepEqual(validateRepository(ROOT), []);
});

test("the validator collects every tests/*.test.ts file", () => {
  const files = collectTestFiles(ROOT);
  assert.ok(files.has("tests/comment_truth.test.ts"));
  assert.ok(![...files].some((path) => !path.endsWith(".test.ts")));
});

test("the validator command reports success and failure", () => {
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
    assert.deepEqual(logs, ["validated comment truth"]);
    assert.equal(main([]), 2);
    assert.equal(main(["render"]), 2);
    assert.equal(main(["validate", "--root"]), 2);
    assert.deepEqual(errors, Array(3).fill(errors[0]));

    writeFileSync(
      join(workspace, "src", "lint", "drift.ts"),
      "// This can never happen.\nexport const x = 1;\n",
    );
    assert.equal(
      inDirectory(workspace, () => main(["validate"])),
      1,
    );
    assert.match(
      errors.at(-1) as string,
      /^error: src\/lint\/drift\.ts:1:1: ATLAS_COMMENT_TRUTH_UNPINNED_ABSOLUTE_CLAIM /u,
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
  assert.equal(output, "validated comment truth\n");
  assert.equal(
    formatFinding({
      attribution: {
        checkId: "sdk-core.comment-truth",
        kind: "sdk-core",
        trusted: true,
      },
      code: "ATLAS_COMMENT_TRUTH_UNPINNED_ABSOLUTE_CLAIM",
      "finding-schema": "1.0.0",
      message: "Unpinned.",
      path: "src/lint/example.ts",
      severity: "error",
    }),
    "src/lint/example.ts: ATLAS_COMMENT_TRUTH_UNPINNED_ABSOLUTE_CLAIM Unpinned.",
  );
});

test("the validator refuses an unreadable tests directory instead of following it", () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (value: string) => errors.push(value);
  const workspace = join(
    ROOT,
    ".test-workspaces",
    `comment-truth-no-tests-${randomUUID()}`,
  );
  mkdirSync(join(workspace, "src", "lint"), { recursive: true });
  try {
    assert.equal(
      inDirectory(workspace, () => main(["validate"])),
      1,
    );
    assert.deepEqual(errors, ["error: tests must be a readable directory"]);
  } finally {
    console.error = originalError;
    rmSync(workspace, { recursive: true, force: true });
  }
});
