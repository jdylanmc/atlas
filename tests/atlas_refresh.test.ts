import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  atlasLocatorFromParts,
  deriveAtlasSlug,
  probeAtlasIngestSource,
  resolveAtlasCache,
  runLocalAtlasRefresh,
  runAtlasRefreshOperation,
  type AtlasRefreshResult,
} from "../src/index.ts";
import { captureLocalAtlasExploreSnapshot } from "../src/platform/local_atlas_explore.ts";
import { localAtlasSnapshotBudgets } from "../src/platform/local_atlas_snapshot.ts";
import {
  runTrustedGitBootstrap,
  runTrustedGitForWrite,
} from "../src/platform/trusted_git.ts";

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE = join(ROOT, ".test-workspaces", "atlas-refresh");
const COMMAND = join(ROOT, "scripts", "atlas.ts");

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commit(repository: string, message: string): string {
  git(repository, ["add", "."]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  return git(repository, ["rev-parse", "HEAD"]);
}

function repository(name: string): string {
  const path = join(WORKSPACE, name);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  git(path, ["init", "--quiet", "--initial-branch=main"]);
  cpSync(
    join(ROOT, "tests", "fixtures", "complete-atlas", ".atlas"),
    join(path, ".atlas"),
    { recursive: true },
  );
  commit(path, "Create fixture Atlas");
  return path;
}

function addTracked(home: string, name: string) {
  const remote = repository(name);
  const canonical = `https://github.com/fixture/${name}.git`;
  const probe = probeAtlasIngestSource({
    approvedAt: "2026-08-25T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    asOf: "2026-08-25T00:00:00Z",
    atlasPath: ".",
    branch: "main",
    fromAnchorId: "anchor:root",
    repositoryLocator: canonical,
    title: name,
  });
  assert.equal(probe.state, "tracked-atlas");
  for (const change of probe.changes) {
    mkdirSync(dirname(join(home, change.path)), { recursive: true });
    const content = change.path.includes("/tracked-atlases/")
      ? change.content.replace("\natlas:\n", "\natlas:\n  refresh-window-days: 1\n")
      : change.content;
    writeFileSync(join(home, change.path), content);
  }
  const locator = atlasLocatorFromParts({
    host: "github.com",
    owner: "fixture",
    repository: name,
    branch: "main",
    atlasPath: ".",
  });
  const slug = deriveAtlasSlug(locator);
  const cached = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:fixture-seed",
      trackedAtlas: {
        declarationId: `tracked-atlas:${slug.value}`,
        defaultBranch: "main",
        locator,
        refreshWindowDays: 1,
        slug,
        title: name,
      },
    },
    { resolveRemote: () => remote },
  );
  assert.equal(cached.state, "resolved");
  const cacheGit = join(cached.snapshot.cacheDirectory, "repository.git");
  git(cacheGit, ["--git-dir=.", "config", `url.${remote}.insteadOf`, canonical]);
  assert.equal(
    git(cacheGit, [
      "--git-dir=.",
      "-c",
      `remote.origin.url=${canonical}`,
      "remote",
      "get-url",
      "origin",
    ]),
    remote,
  );
  writeFileSync(join(remote, "README.md"), "# Advanced remote\n");
  const advanced = commit(remote, "Advance remote");
  const gateway = probe.changes.find((change) => change.path.includes("/edges/"));
  assert.ok(gateway !== undefined);
  return {
    advanced,
    cached: cached.snapshot.snapshot,
    cacheDirectory: cached.snapshot.cacheDirectory,
    gatewayPath: gateway.path,
    remote,
    slug: slug.value,
  };
}

function refresh(home: string, selection: readonly string[]) {
  const result = spawnSync(
    process.execPath,
    [COMMAND, "refresh", "--machine", ...selection, "--atlas-host-directory", home],
    { encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  return { ...result, result: JSON.parse(result.stdout) as AtlasRefreshResult };
}

test("atlas refresh forces all declared Atlases to branch tips without changing knowledge", () => {
  const home = repository("home-all");
  const one = addTracked(home, "refresh-one");
  const two = addTracked(home, "refresh-two");
  const homeHead = commit(home, "Track both Atlases");
  const beforeRoot = readFileSync(join(home, ".atlas", "index.md"));
  const command = refresh(home, ["--all"]);
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stderr, "");
  assert.equal(command.result["operation-result-schema"], "1.0.0");
  assert.equal(command.result.completion, "completed");
  assert.equal(command.result.disposition, "success");
  assert.equal(command.result.operation.kind, "atlas-refresh");
  assert.deepEqual(command.result.handoff.baseSnapshot, {
    reference: homeHead,
    state: "known",
  });
  assert.deepEqual(
    command.result.payload.entries.map(({ slug, snapshot, state }) => ({
      slug,
      snapshot,
      state,
    })),
    [
      { slug: one.slug, snapshot: one.advanced, state: "refreshed" },
      { slug: two.slug, snapshot: two.advanced, state: "refreshed" },
    ],
  );
  assert.equal(git(home, ["rev-parse", "HEAD"]), homeHead);
  assert.equal(git(home, ["status", "--porcelain"]), "");
  assert.deepEqual(readFileSync(join(home, ".atlas", "index.md")), beforeRoot);
});

test("atlas refresh selects one declared slug and leaves other caches untouched", () => {
  const home = repository("home-one");
  const one = addTracked(home, "selected-one");
  const two = addTracked(home, "unselected-two");
  const homeHead = commit(home, "Track both Atlases");
  const untouched = readFileSync(join(two.cacheDirectory, "metadata.json"));
  const command = refresh(home, ["--atlas-slug", one.slug]);
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(command.result.payload.selection, { kind: "one", slug: one.slug });
  assert.deepEqual(
    command.result.payload.entries.map(({ slug, snapshot, state }) => ({
      slug,
      snapshot,
      state,
    })),
    [{ slug: one.slug, snapshot: one.advanced, state: "refreshed" }],
  );
  assert.deepEqual(readFileSync(join(two.cacheDirectory, "metadata.json")), untouched);
  assert.equal(git(home, ["rev-parse", "HEAD"]), homeHead);
  assert.equal(git(home, ["status", "--porcelain"]), "");
});

test("Atlas Refresh fixes one Snapshot per Locator despite declaration aliases", () => {
  const home = repository("home-aliases");
  const first = addTracked(home, "shared-locator");
  const alias = probeAtlasIngestSource({
    approvedAt: "2026-08-25T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    asOf: "2026-08-25T00:00:00Z",
    atlasPath: ".",
    branch: "main",
    defaultBranch: "trunk",
    fromAnchorId: "anchor:root",
    repositoryLocator: "https://github.com/fixture/shared-locator.git",
    title: "Alias declaration",
  });

  assert.equal(alias.state, "tracked-atlas");
  for (const change of alias.changes) {
    mkdirSync(dirname(join(home, change.path)), { recursive: true });
    writeFileSync(join(home, change.path), change.content);
  }
  commit(home, "Track an alias of the same Locator");
  let contacts = 0;
  const result = runLocalAtlasRefresh(
    home,
    { kind: "all" },
    {
      resolveRemote: () => {
        contacts++;
        if (contacts === 2) {
          writeFileSync(
            join(first.remote, "README.md"),
            "# Remote moved during refresh\n",
          );
          commit(first.remote, "Move the remote during an operation");
        }
        return first.remote;
      },
    },
  );
  assert.equal(result.disposition, "success");
  assert.equal(contacts, 1, "An operation must refresh a Locator only once.");
  assert.equal(result.payload.entries.length, 2);
  assert.deepEqual(
    result.payload.entries.map((entry) => entry.snapshot),
    [first.advanced, first.advanced],
  );
});

test("Atlas Refresh distinguishes a missing branch from an unreachable repository", () => {
  const home = repository("home-missing-branch");
  const tracked = addTracked(home, "branch-disappeared");
  commit(home, "Track the branch");
  git(tracked.remote, ["branch", "-m", "retained/refs/heads/main"]);
  const options = { resolveRemote: () => tracked.remote };
  const cached = runLocalAtlasRefresh(home, { kind: "all" }, options);
  assert.equal(cached.disposition, "success");
  assert.equal(cached.payload.entries[0]?.snapshot, tracked.cached);
  assert.deepEqual(
    cached.payload.findings.map(({ code }) => code),
    ["ATLAS_CROSS_ATLAS_CACHED_OFFLINE", "ATLAS_CROSS_ATLAS_BRANCH_MISSING"],
  );
  rmSync(tracked.cacheDirectory, { recursive: true, force: true });
  const firstContact = runLocalAtlasRefresh(home, { kind: "all" }, options);
  assert.equal(firstContact.disposition, "failed");
  assert.equal(firstContact.payload.entries[0]?.state, "unreachable");
  assert.equal(firstContact.handoff.unresolvedHumanDecisions.state, "pending");
  assert.deepEqual(
    firstContact.payload.findings.map(({ code }) => code),
    ["ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE", "ATLAS_CROSS_ATLAS_BRANCH_MISSING"],
  );
  rmSync(tracked.remote, { recursive: true, force: true });
  const unreachable = runLocalAtlasRefresh(home, { kind: "all" }, options);
  assert.deepEqual(
    unreachable.payload.findings.map(({ code }) => code),
    ["ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE"],
  );
});

test("atlas refresh validates selectors before effects and reports unknown targets", () => {
  const home = repository("home-usage");
  const tracked = addTracked(home, "usage-control");
  commit(home, "Track the usage control");
  const metadata = readFileSync(join(tracked.cacheDirectory, "metadata.json"));
  const badArguments = [
    [],
    ["--machine"],
    ["--all"],
    ["--machine", "--all", "--all"],
    ["--machine", "--all", "--machine"],
    ["--machine", "--all", "--unknown"],
    ["--machine", "--atlas-slug"],
    ["--machine", "--atlas-slug", ""],
    ["--machine", "--atlas-slug", "--all"],
    ["--machine", "--all", "--atlas-slug", tracked.slug],
    ["--machine", "--atlas-slug", tracked.slug, "--all"],
    ["--machine", "--atlas-slug", tracked.slug, "--atlas-slug", tracked.slug],
    ["--machine", "--all", "--atlas-host-directory"],
    ["--machine", "--all", "--atlas-host-directory", ""],
    ["--machine", "--all", "--atlas-host-directory", "--all"],
    [
      "--machine",
      "--all",
      "--atlas-host-directory",
      home,
      "--atlas-host-directory",
      home,
    ],
  ];
  for (const arguments_ of badArguments) {
    const child = spawnSync(process.execPath, [COMMAND, "refresh", ...arguments_], {
      cwd: home,
      encoding: "utf8",
    });
    const result = JSON.parse(child.stdout) as AtlasRefreshResult;
    assert.equal(child.status, 64, JSON.stringify(arguments_));
    assert.equal(
      result.handoff.validationState.findings[0]?.code,
      "ATLAS_REFRESH_USAGE",
    );
    assert.equal(result.completion, "not-completed");
  }
  const unknown = refresh(home, ["--atlas-slug", "absent"]);
  assert.equal(unknown.status, 2);
  assert.equal(
    unknown.result.payload.findings[0]?.code,
    "ATLAS_REFRESH_TARGET_NOT_FOUND",
  );
  assert.deepEqual(
    readFileSync(join(tracked.cacheDirectory, "metadata.json")),
    metadata,
  );
  const defaultHost = spawnSync(
    process.execPath,
    [COMMAND, "refresh", "--machine", "--atlas-slug", tracked.slug],
    { cwd: home, encoding: "utf8" },
  );
  assert.equal(defaultHost.status, 0, defaultHost.stderr);
});

test("Atlas Refresh reports empty selection, unavailable capture and invalid Home knowledge", () => {
  const home = repository("home-boundaries");
  const empty = refresh(home, ["--all"]);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(empty.result.payload.entries, []);
  const missing = refresh(join(home, "absent"), ["--all"]);
  assert.equal(missing.status, 2);
  assert.equal(
    missing.result.payload.findings[0]?.code,
    "ATLAS_REFRESH_CAPTURE_FAILED",
  );
  const captured = captureLocalAtlasExploreSnapshot(home, localAtlasSnapshotBudgets);
  assert.equal(captured.state, "captured");
  for (const unknown of ["baseSnapshot", "homeAtlas"]) {
    const result = runAtlasRefreshOperation({
      baseSnapshot:
        unknown === "baseSnapshot"
          ? { state: "unknown", reason: "Fixture" }
          : { state: "known", reference: captured.baseSnapshot },
      homeAtlas:
        unknown === "homeAtlas"
          ? { state: "unknown", reason: "Fixture" }
          : { state: "known", reference: "home" },
      capturedFiles: captured.capturedFiles,
      selection: { kind: "all" },
      runtime: {
        refresh: () => {
          throw new Error("Unselected Snapshot must not cause effects");
        },
      },
    });
    assert.equal(result.payload.findings[0]?.code, "ATLAS_REFRESH_SNAPSHOT_REQUIRED");
  }
  git(home, ["rm", ".atlas/index.md"]);
  commit(home, "Remove the required Root");
  const invalid = refresh(home, ["--all"]);
  assert.equal(invalid.status, 2);
  assert.equal(invalid.result.completion, "not-completed");
  assert.ok(
    invalid.result.payload.findings.some((entry) => entry.severity === "error"),
  );
});

test("Atlas Refresh reports malformed declarations without refreshing their caches", () => {
  const home = repository("home-invalid-declaration");
  const tracked = addTracked(home, "bad-window");
  const healthy = addTracked(home, "healthy-window");
  const declaration = join(home, ".atlas", "tracked-atlases", `${tracked.slug}.md`);
  writeFileSync(
    declaration,
    readFileSync(declaration, "utf8").replace(
      "refresh-window-days: 1",
      "refresh-window-days: invalid",
    ),
  );
  commit(home, "Record a malformed declaration");
  const before = readFileSync(join(tracked.cacheDirectory, "metadata.json"));
  const command = refresh(home, ["--all"]);
  assert.equal(command.status, 1, JSON.stringify(command.result.payload));
  assert.equal(command.result.payload.entries[0]?.state, "invalid");
  assert.equal(
    command.result.payload.findings[0]?.code,
    "ATLAS_CROSS_ATLAS_REFRESH_WINDOW_INVALID",
  );
  assert.ok(
    command.result.payload.entries.some(
      (entry) =>
        entry.slug === healthy.slug &&
        entry.snapshot === healthy.advanced &&
        entry.state === "refreshed",
    ),
  );
  assert.deepEqual(readFileSync(join(tracked.cacheDirectory, "metadata.json")), before);
});

test("Atlas Refresh requires a genuine Anchor gateway and supports reversed Edges", () => {
  for (const mode of ["missing", "non-anchor", "reversed"]) {
    const home = repository(`home-gateway-${mode}`);
    const tracked = addTracked(home, `gateway-${mode}`);
    const path = join(home, tracked.gatewayPath);
    const original = readFileSync(path, "utf8");
    if (mode === "missing") rmSync(path);
    else {
      const content =
        mode === "non-anchor"
          ? original.replace(
              "  from: anchor:root",
              "  from: concept:canonical-serialization",
            )
          : original
              .replace("  from: anchor:root", `  from: tracked-atlas:${tracked.slug}`)
              .replace(`  to: tracked-atlas:${tracked.slug}`, "  to: anchor:root");
      assert.notEqual(content, original);
      writeFileSync(path, content);
    }
    commit(home, "Record the gateway fixture");
    const command = refresh(home, ["--all"]);
    assert.equal(
      command.status,
      mode === "reversed" ? 0 : 1,
      JSON.stringify(command.result.payload),
    );
    if (mode !== "reversed")
      assert.equal(
        command.result.payload.findings[0]?.code,
        "ATLAS_REFRESH_GATEWAY_MISSING",
      );
    else assert.equal(command.result.payload.entries[0]?.snapshot, tracked.advanced);
  }
});

test("Atlas Refresh preserves committed selection, fetch-failure evidence and maintenance warnings", () => {
  const home = repository("home-refresh-effects");
  const tracked = addTracked(home, "refresh-effects");
  const homeHead = commit(home, "Track the effect fixture");
  rmSync(join(home, ".atlas", "tracked-atlases", `${tracked.slug}.md`));
  const beforeStatus = git(home, ["status", "--porcelain"]);
  const options = { resolveRemote: () => tracked.remote };
  const failed = runLocalAtlasRefresh(
    home,
    { kind: "all" },
    {
      ...options,
      bootstrap: (path, args) =>
        args[0] === "fetch"
          ? { state: "failed", reason: "Fixture transfer failure" }
          : runTrustedGitBootstrap(path, args),
    },
  );
  assert.equal(failed.disposition, "success");
  assert.deepEqual(
    failed.payload.findings.map(({ code }) => code),
    ["ATLAS_CROSS_ATLAS_CACHED_OFFLINE"],
  );
  assert.equal(failed.payload.entries[0]?.snapshot, tracked.cached);
  const maintained = runLocalAtlasRefresh(
    home,
    { kind: "all" },
    {
      ...options,
      writeGit: (path, args) =>
        args[0] === "update-ref" && args[1] === "-d"
          ? { state: "failed", reason: "Fixture cleanup failure" }
          : runTrustedGitForWrite(path, args),
    },
  );
  assert.equal(maintained.disposition, "success");
  assert.equal(maintained.payload.entries[0]?.snapshot, tracked.advanced);
  assert.equal(maintained.handoff.validationState.state, "passed");
  assert.equal(maintained.handoff.degradationState.state, "not-degraded");
  assert.equal(
    maintained.payload.maintenanceFindings[0]?.code,
    "ATLAS_CROSS_ATLAS_CACHE_CLEANUP_FAILED",
  );
  assert.equal(git(home, ["rev-parse", "HEAD"]), homeHead);
  assert.equal(git(home, ["status", "--porcelain"]), beforeStatus);
});

test("Atlas Refresh does not promote a runtime error Finding into success", () => {
  const home = repository("home-runtime-error");
  addTracked(home, "runtime-error");
  commit(home, "Track the runtime error fixture");
  const capture = captureLocalAtlasExploreSnapshot(home, localAtlasSnapshotBudgets);
  assert.equal(capture.state, "captured");
  const result = runAtlasRefreshOperation({
    baseSnapshot: { state: "known", reference: capture.baseSnapshot },
    homeAtlas: { state: "known", reference: "fixture-home" },
    capturedFiles: capture.capturedFiles,
    selection: { kind: "all" },
    runtime: {
      refresh: (request) => ({
        state: "resolved",
        snapshot: {
          capturedFiles: capture.capturedFiles,
          snapshot: "fixture-remote",
          trackedAtlas: request.trackedAtlas,
          findings: [
            {
              attribution: { checkId: "fixture", kind: "sdk-core", trusted: true },
              code: "ATLAS_FIXTURE_REFRESH_ERROR",
              "finding-schema": "1.0.0",
              message: "Fixture runtime validation failure.",
              path: ".atlas",
              severity: "error",
            },
          ],
        },
      }),
    },
  });
  assert.equal(result.disposition, "failed");
  assert.equal(result.handoff.validationState.state, "failed");
  assert.equal(result.payload.findings[0]?.code, "ATLAS_FIXTURE_REFRESH_ERROR");
});
