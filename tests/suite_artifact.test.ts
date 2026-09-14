import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createSuiteArtifactOwner } from "./suite_artifact.ts";

test("suite artifact outlives isolated consumers and has owner-only cleanup", () => {
  const consumers = mkdtempSync(join(tmpdir(), "atlas-artifact-consumers-"));
  let creations = 0;
  const owner = createSuiteArtifactOwner((destination) => {
    creations += 1;
    mkdirSync(destination, { recursive: true });
    const artifact = join(destination, "atlas.tgz");
    writeFileSync(artifact, "immutable artifact");
    return artifact;
  });

  try {
    const firstConsumer = join(consumers, "first");
    const secondConsumer = join(consumers, "second");
    mkdirSync(firstConsumer);
    mkdirSync(secondConsumer);
    writeFileSync(join(firstConsumer, "state"), "first");
    writeFileSync(join(secondConsumer, "state"), "second");

    assert.equal(creations, 0);
    const firstArtifact = owner.artifact();
    rmSync(firstConsumer, { recursive: true });
    const secondArtifact = owner.artifact();

    assert.equal(secondArtifact, firstArtifact);
    assert.equal(creations, 1);
    assert.equal(readFileSync(secondArtifact, "utf8"), "immutable artifact");
    assert.equal(readFileSync(join(secondConsumer, "state"), "utf8"), "second");

    owner.dispose();
    assert.equal(existsSync(firstArtifact), false);
    assert.equal(existsSync(secondConsumer), true);
  } finally {
    owner.dispose();
    rmSync(consumers, { force: true, recursive: true });
  }
});

test("suite artifact owner removes its workspace when creation fails", () => {
  let workspace: string | undefined;
  const owner = createSuiteArtifactOwner((destination) => {
    workspace = dirname(destination);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "partial.tgz"), "partial artifact");
    throw new Error("pack failed");
  });

  assert.throws(() => owner.artifact(), /pack failed/u);
  assert.ok(workspace !== undefined);
  assert.equal(existsSync(workspace), false);
  owner.dispose();
});
