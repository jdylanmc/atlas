import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AtlasInitializationResult } from "../src/operations/initialize_operation.ts";

export interface InitializationArtifactConflict {
  readonly artifact: "lintStamp" | "readinessReportMarkdown";
  readonly kind:
    "same-length" | "short" | "long" | "directory" | "symlink" | "parent-symlink";
}

function snapshot(path: string): unknown {
  const stat = lstatSync(path, { bigint: true });
  const identity = { ino: stat.ino, mtimeNs: stat.mtimeNs };
  if (stat.isSymbolicLink()) return { ...identity, link: readlinkSync(path) };
  if (stat.isDirectory()) {
    return {
      ...identity,
      entries: readdirSync(path)
        .toSorted()
        .map((name) => [name, readFileSync(join(path, name))]),
    };
  }
  return { ...identity, bytes: readFileSync(path) };
}

export function exerciseInitializationArtifactConflicts(input: {
  readonly artifacts: NonNullable<
    AtlasInitializationResult["payload"]["outputArtifacts"]
  >;
  readonly cases: readonly InitializationArtifactConflict[];
  readonly gitState: () => string;
  readonly resume: () => AtlasInitializationResult;
}): void {
  const beforeGit = input.gitState();
  for (const probe of input.cases) {
    const path = input.artifacts[probe.artifact];
    const directory = dirname(path);
    const preservedDirectory = `${directory}-preserved`;
    const sentinel = `${path}.sentinel`;
    const original = readFileSync(path);
    if (probe.kind === "parent-symlink") {
      renameSync(directory, preservedDirectory);
      symlinkSync(preservedDirectory, directory, "dir");
    } else {
      unlinkSync(path);
      switch (probe.kind) {
        case "directory":
          mkdirSync(path);
          writeFileSync(join(path, "keep.txt"), "Preserve this directory.\n");
          break;
        case "symlink":
          writeFileSync(sentinel, original, { flag: "wx" });
          symlinkSync(sentinel, path, "file");
          break;
        case "same-length":
          writeFileSync(path, Buffer.alloc(original.length, 0x78));
          break;
        case "short":
          writeFileSync(path, "Operator note.\n");
          break;
        case "long":
          writeFileSync(path, Buffer.alloc(original.length + 65_536, 0x78));
          break;
      }
    }
    try {
      const before = Object.values(input.artifacts).map(snapshot);
      const external =
        probe.kind === "symlink"
          ? snapshot(sentinel)
          : probe.kind === "parent-symlink"
            ? snapshot(preservedDirectory)
            : undefined;
      const result = input.resume();
      assert.equal(result.completion, "not-completed", probe.kind);
      assert.equal(result.disposition, "failed", probe.kind);
      assert.deepEqual(
        result.handoff.validationState.findings.map(({ code }) => code),
        ["ATLAS_INITIALIZATION_OUTPUT_FAILED"],
        probe.kind,
      );
      assert.equal(result.payload.outputArtifacts, undefined);
      assert.ok(result.payload.atlasReadinessReport !== undefined);
      assert.match(result.handoff.recommendedNextAction, /never overwritten/u);
      assert.deepEqual(
        Object.values(input.artifacts).map(snapshot),
        before,
        probe.kind,
      );
      assert.equal(input.gitState(), beforeGit, probe.kind);
      if (probe.kind === "symlink") assert.deepEqual(snapshot(sentinel), external);
      if (probe.kind === "parent-symlink") {
        assert.deepEqual(snapshot(preservedDirectory), external);
      }
    } finally {
      if (probe.kind === "parent-symlink") {
        unlinkSync(directory);
        renameSync(preservedDirectory, directory);
      } else {
        if (probe.kind === "directory") {
          unlinkSync(join(path, "keep.txt"));
          rmdirSync(path);
        } else {
          unlinkSync(path);
        }
        if (probe.kind === "symlink") unlinkSync(sentinel);
        writeFileSync(path, original, { flag: "wx" });
      }
    }
  }
}
