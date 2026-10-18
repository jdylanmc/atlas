import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { verifyLocalAtlasLintStamp } from "../src/index.ts";
import { runLocalAtlasInitialization } from "../src/platform/local_atlas_initialization.ts";
import { readInstalledConsumerCorpus } from "./installed_consumer_corpus.ts";
import { exerciseLintStampVerification } from "./lint_stamp_probes.ts";

const workspace = resolve(import.meta.dirname, "..", ".test-workspaces", "lint-stamp");

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(name: string) {
  const repository = resolve(workspace, name);
  rmSync(repository, { force: true, recursive: true });
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-b", "main"]);
  writeFileSync(resolve(repository, "README.md"), "# host\n");
  git(repository, ["add", "README.md"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Host",
  ]);
  const initialized = runLocalAtlasInitialization(repository);
  assert.equal(initialized.disposition, "success");
  const stamp = initialized.payload.atlasReadinessReport?.lintStamp;
  const artifacts = initialized.payload.outputArtifacts;
  assert.ok(stamp !== undefined && artifacts !== undefined);
  return { repository, stamp, artifacts };
}

test("a reviewer verifies the emitted JSON stamp from its named commit without changing Git", () => {
  const { repository, stamp, artifacts } = fixture("verify-json");
  const before = git(repository, ["status", "--porcelain=v1"]);
  const verified = verifyLocalAtlasLintStamp(
    repository,
    readFileSync(artifacts.lintStamp, "utf8"),
  );
  assert.deepEqual(verified, {
    state: "verified",
    atlasCommit: stamp.atlasCommit,
    atlasContentDigest: stamp.atlasContentDigest,
    findings: [],
  });
  assert.equal(git(repository, ["status", "--porcelain=v1"]), before);
  assert.notEqual(git(repository, ["rev-parse", "HEAD"]), stamp.atlasCommit);
});

test("permanent stamp corpus accepts metadata controls and rejects byte/path or evidence changes", () => {
  const { repository, stamp } = fixture("corpus");
  const cases = readInstalledConsumerCorpus().cases.find(
    (entry) => entry.lintStampVerification !== undefined,
  )?.lintStampVerification;
  assert.ok(cases !== undefined);
  const before = git(repository, ["status", "--porcelain=v1"]);
  const refs = git(repository, ["show-ref"]);
  exerciseLintStampVerification({
    repository,
    stamp,
    cases,
    verify: (value, host) => verifyLocalAtlasLintStamp(host, value),
  });
  assert.equal(git(repository, ["status", "--porcelain=v1"]), before);
  assert.equal(git(repository, ["show-ref"]), refs);
});

test("verification selects the Atlas Host Directory within the named commit, not the repository root", () => {
  const { repository, stamp } = fixture("nested-host");
  git(repository, ["merge", "--ff-only", stamp.atlasCommit]);
  mkdirSync(resolve(repository, "domain"));
  git(repository, ["mv", ".atlas", "domain/.atlas"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Move intact Atlas into its host directory",
  ]);
  const commit = git(repository, ["rev-parse", "HEAD"]);
  const relocated = { ...stamp, atlasCommit: commit, evidenceRevision: commit };
  assert.equal(
    verifyLocalAtlasLintStamp(resolve(repository, "domain"), relocated).state,
    "verified",
  );
  assert.equal(verifyLocalAtlasLintStamp(repository, relocated).state, "rejected");
});

test("verification ignores moved HEAD and dirty Atlas content, and does not follow replacement objects", () => {
  const { repository, stamp } = fixture("dirty-and-replacement");
  git(repository, ["merge", "--ff-only", stamp.atlasCommit]);
  writeFileSync(
    resolve(repository, ".atlas/CHANGELOG.md"),
    "# other committed bytes\n",
  );
  git(repository, ["add", ".atlas/CHANGELOG.md"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Change Atlas after Lint",
  ]);
  const changed = git(repository, ["rev-parse", "HEAD"]);
  writeFileSync(resolve(repository, ".atlas/index.md"), "dirty invalid Atlas\n");
  git(repository, ["replace", stamp.atlasCommit, changed]);
  const before = git(repository, ["status", "--porcelain=v1"]);
  assert.equal(verifyLocalAtlasLintStamp(repository, stamp).state, "verified");
  assert.equal(
    verifyLocalAtlasLintStamp(repository, {
      ...stamp,
      atlasCommit: changed,
      evidenceRevision: changed,
    }).state,
    "rejected",
  );
  assert.equal(git(repository, ["status", "--porcelain=v1"]), before);
  assert.equal(
    readFileSync(resolve(repository, ".atlas/index.md"), "utf8"),
    "dirty invalid Atlas\n",
  );
});

test("stamp verification refuses accessor evidence without executing it", () => {
  const { repository, stamp } = fixture("accessors");
  const value = {
    ...stamp,
    get atlasContentDigest(): string {
      return assert.fail("stamp evidence accessors must not run");
    },
  };
  const result = verifyLocalAtlasLintStamp(repository, value);
  assert.equal(result.state, "rejected");
  assert.equal(result.findings[0]?.code, "ATLAS_LINT_STAMP_INVALID");
});

test("stamp verification reports missing Git context and preserves unexpected faults", (context) => {
  const { repository, stamp } = fixture("faults");
  const outside = mkdtempSync(resolve(tmpdir(), "atlas-stamp-no-git-"));
  try {
    assert.equal(verifyLocalAtlasLintStamp(outside, stamp).state, "rejected");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
  const fault = new Error("unexpected verification fault");
  const parsing = context.mock.method(JSON, "parse", () => {
    throw fault;
  });
  assert.throws(
    () => verifyLocalAtlasLintStamp(repository, "{}"),
    (error) => error === fault,
  );
  parsing.mock.restore();
  const hashing = context.mock.method(JSON, "stringify", () => {
    throw fault;
  });
  assert.throws(
    () => verifyLocalAtlasLintStamp(repository, stamp),
    (error) => error === fault,
  );
  hashing.mock.restore();
  const foreignFault = new Error("non-native filesystem fault");
  Object.setPrototypeOf(foreignFault, null);
  for (const filesystemFault of [
    fault,
    foreignFault,
    Object.assign(new Error("permission fault"), { code: "EACCES" }),
  ]) {
    const reader = context.mock.method(fs, "lstatSync", () => {
      throw filesystemFault;
    });
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => verifyLocalAtlasLintStamp(repository, stamp),
        (error) => error === filesystemFault,
      );
    } finally {
      reader.mock.restore();
      syncBuiltinESMExports();
    }
  }
});
