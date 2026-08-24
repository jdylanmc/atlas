import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  atlasFrameworkDirectory,
  atlasInitializationFiles,
  canonicalFrameworkPageByBundleState,
  frameworkBundleStateFromEvidence,
  frameworkReleaseManifestAtlasPath,
  frameworkReleaseManifestDigestAtlasPath,
  initialAtlasInitializationWorkflowState,
} from "../src/operations/initialize_operation.ts";
import {
  inventoryPaths,
  parseFrameworkReleaseManifest,
} from "../src/framework/framework_release.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function slashPath(path: string): string {
  return path.split(/[/\\]+/u).join("/");
}

function listFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return Object.freeze([]);
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...listFiles(absolute));
      continue;
    }
    files.push(slashPath(relative(ROOT, absolute)));
  }
  return Object.freeze(files.toSorted());
}

function committedFrameworkBundleState(): "absent" | "installed" {
  const manifestPath = join(ROOT, frameworkReleaseManifestAtlasPath);
  const digestPath = join(ROOT, frameworkReleaseManifestDigestAtlasPath);
  let manifestPresent = false;
  let manifestDigestVerified = false;
  let manifestInventoryPaths: readonly string[] = Object.freeze([]);
  if (existsSync(manifestPath) && existsSync(digestPath)) {
    const rawManifest = readFileSync(manifestPath, "utf8");
    const parsed = parseFrameworkReleaseManifest(JSON.parse(rawManifest));
    manifestPresent = parsed.state === "parsed";
    manifestDigestVerified =
      manifestPresent &&
      readFileSync(digestPath, "utf8").trim() === sha256(rawManifest);
    manifestInventoryPaths =
      parsed.state === "parsed" ? inventoryPaths(parsed.manifest) : Object.freeze([]);
  }
  return frameworkBundleStateFromEvidence({
    frameworkFilePaths: listFiles(join(ROOT, atlasFrameworkDirectory)),
    inventoryPaths: manifestInventoryPaths,
    manifestDigestVerified,
    manifestPresent,
  });
}

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

test("the SDK Atlas framework page matches its derived Framework Bundle state", () => {
  const state = committedFrameworkBundleState();
  const framework = readFileSync(join(ROOT, ".atlas/framework/README.md"), "utf8");
  assert.equal(
    framework,
    canonicalFrameworkPageByBundleState[state],
    `the framework page must exactly match the canonical ${state} Framework Bundle text`,
  );
});

test("Framework Bundle page text is selected only from derived states", () => {
  assert.equal(
    canonicalFrameworkPageByBundleState[
      frameworkBundleStateFromEvidence({
        frameworkFilePaths: Object.freeze([]),
        inventoryPaths: Object.freeze([]),
        manifestDigestVerified: false,
        manifestPresent: false,
      })
    ],
    canonicalFrameworkPageByBundleState.absent,
  );
  assert.equal(
    canonicalFrameworkPageByBundleState[
      frameworkBundleStateFromEvidence({
        frameworkFilePaths: Object.freeze([".atlas/framework/src/runtime.ts"]),
        inventoryPaths: Object.freeze(["src/runtime.ts"]),
        manifestDigestVerified: true,
        manifestPresent: true,
      })
    ],
    canonicalFrameworkPageByBundleState.installed,
  );
});
