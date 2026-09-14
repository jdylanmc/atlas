import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { LintStamp, LintStampVerification } from "../src/index.ts";

export interface LintStampProbe {
  readonly host?: "file";
  readonly name: string;
  readonly expectation: "accept" | "reject";
  readonly expectedCode?: string;
  readonly revision?:
    | "metadata"
    | "host"
    | "bytes"
    | "path"
    | "bom"
    | "crlf"
    | "tree"
    | "missing"
    | "symlink"
    | "executable"
    | "absent"
    | "invalid-text";
  readonly patch?: Readonly<Record<string, unknown>>;
  readonly remove?: readonly string[];
  readonly json?: string;
}

export function exerciseLintStampVerification(input: {
  readonly repository: string;
  readonly stamp: LintStamp;
  readonly cases: readonly LintStampProbe[];
  readonly verify: (stamp: unknown, host: string) => LintStampVerification;
}): void {
  const directory = mkdtempSync(join(input.repository, ".stamp-probes-"));
  const index = join(directory, "index");
  const git = (args: readonly string[], stdin?: string, trim = true): string => {
    const result = spawnSync("git", ["-C", input.repository, ...args], {
      encoding: "utf8",
      input: stdin,
      env: {
        ...process.env,
        GIT_INDEX_FILE: index,
        GIT_AUTHOR_NAME: "Different fixture author",
        GIT_AUTHOR_EMAIL: "different-author@example.invalid",
        GIT_AUTHOR_DATE: "2001-02-03T04:05:06Z",
        GIT_COMMITTER_NAME: "Different fixture committer",
        GIT_COMMITTER_EMAIL: "different-committer@example.invalid",
        GIT_COMMITTER_DATE: "2002-03-04T05:06:07Z",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return trim ? result.stdout.trimEnd() : result.stdout;
  };
  try {
    for (const probe of input.cases) {
      const stamp: Record<string, unknown> = Object.fromEntries(
        Object.entries({ ...input.stamp, ...probe.patch }).filter(
          ([key]) => !probe.remove?.includes(key),
        ),
      );
      if (probe.revision !== undefined) {
        git(["read-tree", input.stamp.atlasCommit]);
        const originalTree = git(["rev-parse", `${input.stamp.atlasCommit}^{tree}`]);
        if (probe.revision === "tree") {
          stamp["atlasCommit"] = originalTree;
        } else if (probe.revision === "missing") {
          stamp["atlasCommit"] = "0".repeat(input.stamp.atlasCommit.length);
        } else {
          const path = probe.revision === "host" ? "README.md" : ".atlas/index.md";
          const original =
            probe.revision === "host"
              ? "# unrelated host content\n"
              : git(["show", `${input.stamp.atlasCommit}:${path}`], undefined, false);
          let content = original;
          if (probe.revision === "bytes") content += "\n";
          if (probe.revision === "bom") content = `\uFEFF${content}`;
          if (probe.revision === "crlf") content = content.replaceAll("\n", "\r\n");
          if (probe.revision === "invalid-text") content += "\u2028";
          if (probe.revision === "absent") {
            git(["read-tree", "--empty"]);
          } else if (probe.revision === "symlink" || probe.revision === "executable") {
            const blob = git([
              "rev-parse",
              `${input.stamp.atlasCommit}:.atlas/index.md`,
            ]);
            git([
              "update-index",
              "--add",
              "--cacheinfo",
              probe.revision === "symlink" ? "120000" : "100755",
              blob,
              ".atlas/index.md",
            ]);
          } else if (probe.revision === "path") {
            git(["update-index", "--force-remove", ".atlas/CHANGELOG.md"]);
            const blob = git([
              "rev-parse",
              `${input.stamp.atlasCommit}:.atlas/CHANGELOG.md`,
            ]);
            git([
              "update-index",
              "--add",
              "--cacheinfo",
              "100644",
              blob,
              ".atlas/HISTORY.md",
            ]);
          } else if (probe.revision !== "metadata") {
            const blob = git(["hash-object", "-w", "--stdin"], content);
            git(["update-index", "--add", "--cacheinfo", "100644", blob, path]);
          }
          const tree = git(["write-tree"]);
          const commit = git([
            "commit-tree",
            tree,
            "-m",
            "Synthetic alternate review locator",
          ]);
          stamp["atlasCommit"] = commit;
          assert.notEqual(commit, input.stamp.atlasCommit, probe.name);
          if (probe.revision === "metadata")
            assert.equal(tree, originalTree, probe.name);
          if (probe.revision === "metadata" || probe.revision === "host") {
            assert.equal(
              git(["rev-parse", `${commit}:.atlas`]),
              git(["rev-parse", `${input.stamp.atlasCommit}:.atlas`]),
              probe.name,
            );
          }
        }
        stamp["evidenceRevision"] = stamp["atlasCommit"];
      }
      const result = input.verify(
        probe.json ?? stamp,
        probe.host === "file"
          ? join(input.repository, ".git", "config")
          : input.repository,
      );
      assert.equal(
        result.state,
        probe.expectation === "accept" ? "verified" : "rejected",
        probe.name,
      );
      if (probe.expectation === "reject") {
        assert.deepEqual(
          result.findings.map((finding) => finding.code),
          [probe.expectedCode],
          probe.name,
        );
      } else {
        assert.equal(result.state, "verified");
        assert.equal(
          result.atlasContentDigest,
          input.stamp.atlasContentDigest,
          probe.name,
        );
        assert.equal(result.atlasCommit, stamp["atlasCommit"], probe.name);
        assert.deepEqual(result.findings, [], probe.name);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
