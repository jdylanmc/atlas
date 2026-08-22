import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  atlasInitializationFiles,
  initialAtlasInitializationWorkflowState,
} from "../src/operations/initialize_operation.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
test("the committed SDK Atlas is byte-identical to what Initialization emits", () => {
  for (const [path, content] of emittedAtlasFiles()) {
    assert.equal(
      readFileSync(join(ROOT, path), "utf8"),
      content,
      `${path} has drifted from the content Atlas Initialization emits`,
    );
  }
});

test("the SDK Atlas claims no Framework Bundle it does not carry", () => {
  const framework = readFileSync(join(ROOT, ".atlas/framework/README.md"), "utf8");
  // A real Framework Bundle is the installed Release Manifest plus that
  // manifest's complete inventory of SDK-owned files. Until those exist, the
  // page must not assert the Atlas is framework-backed.
  assert.doesNotMatch(
    framework,
    /is initialized from|is backed by|installed Framework Bundle/iu,
    "the framework page asserts a Framework Bundle that is not installed",
  );
  assert.match(framework, /No Framework Bundle is installed/u);
});
