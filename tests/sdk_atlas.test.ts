import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  atlasInitializationFiles,
  initialAtlasInitializationWorkflowState,
  runAtlasInitializationWorkflow,
} from "../src/operations/initialize_operation.ts";
import { runLintOperation } from "../src/operations/lint_operation.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MINIMAL_RESULT_FIXTURE = join(
  ROOT,
  "tests",
  "fixtures",
  "initialize-operation-minimal-result.json",
);

function emittedAtlasFiles(): Map<string, string> {
  const decoder = new TextDecoder();
  const state = initialAtlasInitializationWorkflowState({
    baseSnapshotDigest: "sdk-atlas-guard",
    proposalBranch: "atlas/initialize-sdk-atlas-guard",
    targetBranch: "main",
    targetHead: "sdk-atlas-guard",
  });
  return new Map(
    atlasInitializationFiles(state).map((file) => [
      file.path,
      decoder.decode(file.bytes),
    ]),
  );
}

// The SDK Atlas is this product's own first Home Atlas and the reference every
// adopter reads. Its committed bytes must be exactly what Atlas Initialization
// emits, so a page cannot drift into claiming something the workflow never
// produced. A committed Atlas page asserting a provenance it does not have is
// the defect this guard exists to prevent.
//
// .atlas/CHANGELOG.md is the one exception: governance and Ingest legitimately
// append their own stamped entries after Initialization, so its committed
// content only needs to retain the exact Initialization prefix, not equal it.
test("the committed SDK Atlas is byte-identical to what Initialization emits", () => {
  for (const [path, content] of emittedAtlasFiles()) {
    const committed = readFileSync(join(ROOT, path), "utf8");
    if (path === ".atlas/CHANGELOG.md") {
      assert.ok(
        committed.startsWith(content),
        `${path} has drifted from the Initialization prefix Atlas Changelog entries must extend`,
      );
      continue;
    }
    assert.equal(
      committed,
      content,
      `${path} has drifted from the content Atlas Initialization emits`,
    );
  }
});

test("the minimal initialization operation result remains byte-identical to the golden fixture", () => {
  const state = initialAtlasInitializationWorkflowState({
    baseSnapshotDigest: "base-digest",
    proposalBranch: "atlas-initialization-golden",
    targetBranch: "main",
    targetHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const result = runAtlasInitializationWorkflow(state, {
    commitProposal: () => ({
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      receipt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
    createProposalWorktree: () => ({ receipt: "atlas-initialization-golden" }),
    currentTargetHead: () => state.targetHead,
    currentBaseSnapshotDigest: () => state.baseSnapshotDigest,
    lintProposal: () => ({
      lint: runLintOperation(atlasInitializationFiles(state), {
        maxFileBytes: 4096,
        maxTotalBytes: 65536,
      }),
      receipt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
    writeChangeSet: () => ({ receipt: "tree-golden" }),
  });
  const fixture: unknown = JSON.parse(readFileSync(MINIMAL_RESULT_FIXTURE, "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), fixture);
});
