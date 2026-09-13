import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolveAtlasCache, runExploreOperation } from "@jdylanmc/atlas";

const inputText = process.argv[1];
assert.ok(inputText !== undefined);
const input = JSON.parse(inputText) as {
  readonly home: string;
  readonly query: string;
  readonly remotes: Readonly<Record<string, string>>;
};
const git = (args: readonly string[]) =>
  execFileSync("git", ["-C", input.home, ...args], { timeout: 30_000 });
const snapshot = git(["rev-parse", "HEAD"]).toString("utf8").trim();
const paths = git(["ls-tree", "-rz", "--name-only", snapshot, "--", ".atlas"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const result = runExploreOperation({
  atlasCacheResolver: {
    resolve(request) {
      const remote = input.remotes[request.trackedAtlas.locator.repository];
      assert.ok(remote !== undefined, "No Git fixture for this tracked Atlas");
      return resolveAtlasCache(
        { ...request, homeAtlasDirectory: input.home },
        { resolveRemote: () => remote },
      );
    },
  },
  baseSnapshot: { reference: snapshot, state: "known" },
  capturedFiles: paths.map((path) => ({
    bytes: git(["show", `${snapshot}:${path}`]),
    path,
  })),
  homeAtlas: { reference: "local-home-atlas", state: "known" },
  query: input.query,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
