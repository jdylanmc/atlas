import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  atlasCacheKey,
  atlasLocatorFromParts,
  createAtlasCache,
  createAtlasLock,
  deriveAtlasSlug,
  atlasLocatorCredentialMessage,
  parseAtlasLocator,
  parseTrackedAtlas,
  probeAtlasIngestSource,
  resolveAtlasCache,
  runExploreOperation,
  type TrackedAtlas,
} from "../src/index.ts";
import { publishAtlasCacheDirectory } from "../src/platform/atlas_cache.ts";
import type { ExploreBudgets } from "../src/graph/explore_atlas.ts";
import { hasConnectedAtlasEdges } from "../src/operations/connected_atlas_explore.ts";
import { captureAtlasTree } from "../src/platform/atlas_tree_capture.ts";
import { localAtlasCacheResolver } from "../src/platform/local_atlas_explore.ts";

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "connected-atlas");
const encoder = new TextEncoder();

const budgets: ExploreBudgets = Object.freeze({
  maxContextCharacters: 4096,
  maxEdges: 128,
  maxFileBytes: 8192,
  maxObjects: 128,
  maxQueryCharacters: 256,
  maxResults: 5,
  maxRouteEdges: 16,
  maxTerms: 256,
  maxTotalBytes: 65536,
});

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepository(repository: string): void {
  rmSync(repository, { force: true, recursive: true });
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-b", "main"]);
  writeFileSync(resolve(repository, "README.md"), "# host\n", "utf8");
}

function commitAll(repository: string, message: string): string {
  git(repository, ["add", "."]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    message,
  ]);
  return git(repository, ["rev-parse", "HEAD"]);
}

function createBareRemote(
  name: string,
  files: readonly { readonly path: string; readonly text: string }[],
): string {
  const source = resolve(WORKSPACE, `${name}-source`);
  const bare = resolve(WORKSPACE, `${name}.git`);
  initRepository(source);
  mkdirSync(resolve(source, ".atlas"), { recursive: true });
  for (const file of files) {
    const absolute = resolve(source, file.path);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, file.text, "utf8");
  }
  commitAll(source, `seed ${name}`);
  rmSync(bare, { force: true, recursive: true });
  const clone = spawnSync("git", ["clone", "--bare", source, bare], {
    encoding: "utf8",
  });
  assert.equal(clone.status, 0, clone.stderr);
  return bare;
}

function page(
  path: string,
  id: string,
  type: string,
  title: string,
  atlasBlock: string,
  body: string,
): { readonly path: string; readonly text: string } {
  return {
    path,
    text: [
      "---",
      "sdk:",
      "  atlas-sdk-schema: 1.0.0",
      '  created-at: "2026-08-25T00:00:00Z"',
      "  created-by:",
      "    kind: human",
      "    name: Fixture",
      `  id: ${id}`,
      "  local-atlas-schema: 1.0.0",
      "  tags: []",
      `  title: ${title}`,
      `  type: ${type}`,
      '  updated-at: "2026-08-25T00:00:00Z"',
      "  updated-by:",
      "    kind: human",
      "    name: Fixture",
      atlasBlock,
      "---",
      "",
      body,
      "",
    ].join("\n"),
  };
}

function trackedAtlasDeclaration(
  locatorHost: string,
  owner: string,
  repository: string,
  atlasPath = ".",
  branch = "main",
): TrackedAtlas {
  const locator = atlasLocatorFromParts({
    atlasPath,
    branch,
    host: locatorHost,
    owner,
    repository,
  });
  return Object.freeze({
    declarationId: `tracked-atlas:${deriveAtlasSlug(locator).value}`,
    defaultBranch: branch,
    locator,
    slug: deriveAtlasSlug(locator),
    title: repository,
  });
}

function captured(file: { readonly path: string; readonly text: string }): {
  readonly bytes: Uint8Array;
  readonly path: string;
} {
  return { bytes: encoder.encode(file.text), path: file.path };
}

test("Atlas Locator normalizes equivalent HTTPS and SSH repository forms together", () => {
  const https = parseAtlasLocator(
    {
      atlasPath: ".",
      branch: "main",
      repositoryLocator: "https://GitHub.com/owner/repo.git",
    },
    ".atlas/tracked-atlases/repo.md",
  );
  const ssh = parseAtlasLocator(
    {
      atlasPath: ".",
      branch: "main",
      repositoryLocator: "git@github.com:owner/repo.git",
    },
    ".atlas/tracked-atlases/repo.md",
  );
  assert.equal(https.state, "parsed");
  assert.equal(ssh.state, "parsed");
  assert.deepEqual(https.locator, ssh.locator);
  assert.notDeepEqual(
    parseAtlasLocator(
      {
        atlasPath: "nested/atlas",
        branch: "feature/branch",
        repositoryLocator: "https://github.com/owner/repo.git",
      },
      ".atlas/tracked-atlases/repo.md",
    ),
    https,
  );
});

test("Atlas Locator rejects branch dot-segments and exposes the fixed credential message", () => {
  const invalidBranch = parseAtlasLocator(
    {
      atlasPath: ".",
      branch: "feature/../bad",
      repositoryLocator: "https://github.com/owner/repo.git",
    },
    ".atlas/tracked-atlases/repo.md",
  );
  assert.equal(invalidBranch.state, "invalid");
  assert.equal(
    atlasLocatorCredentialMessage(),
    "Atlas Locator must not embed credentials or SSH user-info.",
  );
});

test("Atlas Locator rejects non-canonical paths, branches, and unsupported transports", () => {
  const invalid = parseAtlasLocator(
    {
      atlasPath: "/bad/",
      branch: "feature branch",
      repositoryLocator: "file:///repo.git",
    },
    ".atlas/tracked-atlases/repo.md",
  );
  assert.equal(invalid.state, "invalid");
  assert.deepEqual(invalid.findings.map((finding) => finding.code).sort(), [
    "ATLAS_INGEST_SOURCE_MARKER_INVALID",
    "ATLAS_INGEST_SOURCE_MARKER_INVALID",
  ]);
});

test("Atlas Slug includes non-default branch and nested Atlas path", () => {
  const slug = deriveAtlasSlug(
    atlasLocatorFromParts({
      atlasPath: "nested/atlas",
      branch: "feature/x",
      host: "github.com",
      owner: "owner",
      repository: "repo",
    }),
    "main",
  );
  assert.equal(
    slug.value,
    "github.com--owner--repo--branch-feature-2fx--nested--atlas",
  );
});

test("Atlas Locator rejects malformed SCP repository shapes", () => {
  for (const repositoryLocator of [
    "git@github.com:owner/repo/extra.git",
    "git@github.com:owner/..git",
  ]) {
    const invalid = parseAtlasLocator(
      { atlasPath: ".", branch: "main", repositoryLocator },
      ".atlas/tracked-atlases/repo.md",
    );
    assert.equal(invalid.state, "invalid");
  }
});

test("Atlas Locator rejects malformed HTTPS paths and inner Atlas path markers", () => {
  for (const input of [
    {
      atlasPath: "nested/./atlas",
      branch: "main",
      repositoryLocator: "https://github.com/owner/repo.git",
    },
    {
      atlasPath: ".",
      branch: "main",
      repositoryLocator: "https://github.com/owner/repo/extra.git",
    },
    { atlasPath: ".", branch: "main", repositoryLocator: "git@github.com:owner/.git" },
  ]) {
    const invalid = parseAtlasLocator(input, ".atlas/tracked-atlases/repo.md");
    assert.equal(invalid.state, "invalid");
  }
});

test("Atlas Locator rejects invalid repository characters in Atlas-relative pieces", () => {
  const invalid = parseAtlasLocator(
    {
      atlasPath: "nested\\bad",
      branch: "main",
      repositoryLocator: "https://github.com/owner/./git",
    },
    ".atlas/tracked-atlases/repo.md",
  );
  assert.equal(invalid.state, "invalid");
});

test("Atlas Locator rejects embedded credentials without leaking them", () => {
  const secret = "topsecret";
  const invalid = parseAtlasLocator(
    {
      atlasPath: ".",
      branch: "main",
      repositoryLocator: `https://user:${secret}@github.com/owner/repo.git`,
    },
    ".atlas/tracked-atlases/repo.md",
  );
  assert.equal(invalid.state, "invalid");
  assert.deepEqual(
    invalid.findings.map((finding) => finding.code),
    ["ATLAS_LOCATOR_CREDENTIALS_REJECTED"],
  );
  assert.ok(!JSON.stringify(invalid).includes(secret));

  const sshInvalid = parseAtlasLocator(
    {
      atlasPath: ".",
      branch: "main",
      repositoryLocator: `alice@github.com:owner/repo.git`,
    },
    ".atlas/tracked-atlases/repo.md",
  );
  assert.equal(sshInvalid.state, "invalid");
  assert.equal(sshInvalid.findings[0]?.code, "ATLAS_LOCATOR_CREDENTIALS_REJECTED");
});

test("Atlas Locator from parts falls back for invalid local pieces", () => {
  const locator = atlasLocatorFromParts({
    atlasPath: "/",
    branch: "bad branch",
    host: "GitHub.com",
    owner: "Owner",
    repository: "Repo",
  });
  assert.equal(locator.atlasPath, ".");
  assert.equal(locator.branch, "bad branch");
  assert.equal(locator.host, "github.com");
});

test("Atlas cache and Atlas lock derive deterministic records", () => {
  const tracked = trackedAtlasDeclaration(
    "github.com",
    "owner",
    "repo",
    "nested",
    "main",
  );
  const cache = createAtlasCache(tracked.locator, tracked.slug);
  const lock = createAtlasLock([
    {
      cacheKey: cache.cacheKey,
      fetchedAt: "2026-08-25T00:00:00Z",
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      locator: tracked.locator,
      slug: tracked.slug,
      snapshot: "abc",
    },
  ]);
  assert.equal(cache.cacheKey, atlasCacheKey(tracked.locator));
  assert.deepEqual(lock.dependencies[0]?.locator, tracked.locator);
});

test("Atlas source probe emits a TrackedAtlas declaration and cross-Atlas Edge", () => {
  const outcome = probeAtlasIngestSource({
    approvedAt: "2026-08-25T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    asOf: "2026-08-25T00:00:00Z",
    atlasPath: ".",
    branch: "main",
    fromAnchorId: "anchor:root",
    repositoryLocator: "https://github.com/owner/repo.git",
    title: "Repo Atlas",
  });
  assert.equal(outcome.state, "tracked-atlas");
  assert.equal(outcome.findings.length, 0);
  const changePaths = outcome.changes.map((change) => change.path).toSorted();
  assert.equal(
    changePaths[0],
    `.atlas/edges/${changePaths[0]?.split("/").at(-1) as string}`,
  );
  assert.equal(
    changePaths[1],
    `.atlas/tracked-atlases/${
      deriveAtlasSlug(
        atlasLocatorFromParts({
          atlasPath: ".",
          branch: "main",
          host: "github.com",
          owner: "owner",
          repository: "repo",
        }),
      ).value
    }.md`,
  );
  assert.ok(
    outcome.changes.some((change) => change.content.includes("type: tracked-atlas")),
  );
  assert.ok(
    outcome.changes.some((change) => change.content.includes("to: tracked-atlas:")),
  );
});

test("Atlas source probe rejects invalid approval timestamps before emission", () => {
  const outcome = probeAtlasIngestSource({
    approvedAt: "2026-08-25",
    approvedBy: "",
    asOf: "2026-08-25",
    atlasPath: ".",
    branch: "main",
    fromAnchorId: "anchor:root",
    repositoryLocator: "https://github.com/owner/repo.git",
    title: "Repo Atlas",
  });
  assert.equal(outcome.state, "invalid");
});

test("Atlas source probe rejects credential-bearing tracked markers without emitting files", () => {
  const secret = "hidden";
  const outcome = probeAtlasIngestSource({
    approvedAt: "2026-08-25T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    asOf: "2026-08-25T00:00:00Z",
    atlasPath: ".",
    branch: "main",
    fromAnchorId: "anchor:root",
    repositoryLocator: `https://user:${secret}@github.com/owner/repo.git`,
    title: "Repo Atlas",
  });
  assert.equal(outcome.state, "invalid");
  assert.ok(!JSON.stringify(outcome).includes(secret));
});

test("Atlas cache captures a nested tracked Atlas subtree", () => {
  const home = resolve(WORKSPACE, "home-nested-cache");
  initRepository(home);
  commitAll(home, "home");
  const remote = createBareRemote("tracked-nested", [
    page(
      "nested/.atlas/index.md",
      "anchor:root",
      "anchor",
      "Nested Root",
      "atlas: {}",
      "# Nested Root",
    ),
  ]);
  const tracked = trackedAtlasDeclaration(
    "github.com",
    "owner",
    "tracked-nested",
    "nested",
  );
  const result = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    { resolveRemote: () => remote },
  );
  assert.equal(result.state, "resolved");
  assert.equal(result.snapshot.capturedFiles[0]?.path, ".atlas/index.md");
});

test("Atlas cache resolves first contact, records Atlas Lock, and degrades to cached offline", () => {
  const home = resolve(WORKSPACE, "home-cache");
  initRepository(home);
  commitAll(home, "home");

  const remote = createBareRemote("tracked-cache", [
    page(
      ".atlas/index.md",
      "anchor:root",
      "anchor",
      "Tracked Home",
      "atlas: {}",
      "# Tracked Home",
    ),
  ]);
  const tracked = trackedAtlasDeclaration("github.com", "owner", "tracked-cache");

  const first = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    { resolveRemote: () => remote },
  );
  assert.equal(first.state, "resolved");
  assert.equal(first.snapshot.findings.length, 0);
  assert.ok(existsSync(first.snapshot.cacheDirectory));
  const atlasLock = JSON.parse(
    readFileSync(resolve(home, ".atlas", "atlas-cache", "atlas-lock.json"), "utf8"),
  ) as { readonly dependencies: readonly { readonly cacheKey: string }[] };
  assert.equal(atlasLock.dependencies[0]?.cacheKey, atlasCacheKey(tracked.locator));

  rmSync(remote, { force: true, recursive: true });
  const offline = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    { resolveRemote: () => remote },
  );
  assert.equal(offline.state, "resolved");
  assert.equal(offline.snapshot.findings[0]?.code, "ATLAS_CROSS_ATLAS_CACHED_OFFLINE");
});

test("Atlas cache reports first-contact unreachable without cache", () => {
  const home = resolve(WORKSPACE, "home-unreachable");
  initRepository(home);
  commitAll(home, "home");
  const tracked = trackedAtlasDeclaration("github.com", "owner", "missing-remote");
  const result = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    { resolveRemote: () => resolve(WORKSPACE, "no-such-remote.git") },
  );
  assert.equal(result.state, "unreachable");
  assert.equal(result.findings[0]?.code, "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE");
});

test("Atlas cache reports bare repository bootstrap failure", () => {
  const home = resolve(WORKSPACE, "home-bootstrap-fail");
  initRepository(home);
  commitAll(home, "home");
  const tracked = trackedAtlasDeclaration("github.com", "owner", "bootstrap-fail");
  const result = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    {
      bootstrap: () => ({ reason: "nope", state: "failed" as const }),
    },
  );
  assert.equal(result.state, "unreachable");
});

test("Atlas cache publication tolerates a loser rename race", () => {
  const finalDirectory = resolve(WORKSPACE, "publish-final");
  const pendingDirectory = resolve(WORKSPACE, "publish-pending");
  rmSync(finalDirectory, { force: true, recursive: true });
  rmSync(pendingDirectory, { force: true, recursive: true });
  mkdirSync(finalDirectory, { recursive: true });
  writeFileSync(join(finalDirectory, "winner.txt"), "winner\n", "utf8");
  mkdirSync(pendingDirectory, { recursive: true });
  assert.equal(
    publishAtlasCacheDirectory(finalDirectory, pendingDirectory),
    finalDirectory,
  );
  assert.equal(existsSync(pendingDirectory), false);
});

test("Atlas cache tolerates an already-published cache directory", () => {
  const home = resolve(WORKSPACE, "home-existing-cache");
  initRepository(home);
  commitAll(home, "home");
  const remote = createBareRemote("tracked-existing", [
    page(
      ".atlas/index.md",
      "anchor:root",
      "anchor",
      "Tracked Home",
      "atlas: {}",
      "# Tracked Home",
    ),
  ]);
  const tracked = trackedAtlasDeclaration("github.com", "owner", "tracked-existing");
  const cacheKey = atlasCacheKey(tracked.locator);
  const published = resolve(home, ".atlas", "atlas-cache", "atlases", cacheKey);
  mkdirSync(resolve(published, "repository.git"), { recursive: true });
  const result = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    { resolveRemote: () => remote },
  );
  assert.equal(result.state, "unreachable");
});

test("TrackedAtlas parsing forwards invalid locator findings", () => {
  const invalidLocator = parseTrackedAtlas({
    id: "tracked-atlas:bad",
    objectId: "tracked-atlas:bad",
    page: {
      atlas: {
        branch: "main",
        locator: "https://user:secret@github.com/owner/repo.git",
        path: ".",
      },
      body: "# Bad",
      sdk: {
        id: "tracked-atlas:bad",
        type: "tracked-atlas",
        title: "Bad",
        "created-by": { kind: "human", name: "Fixture" },
        "updated-by": { kind: "human", name: "Fixture" },
      },
    },
    path: ".atlas/tracked-atlases/bad.md",
    snapshot: {
      atlas: { state: "known" },
      role: "home",
      slug: "home",
      snapshot: { state: "known" },
    },
    body: "# Bad",
    ownership: {
      createdBy: { kind: "human", name: "Fixture" },
      updatedBy: { kind: "human", name: "Fixture" },
    },
    sourceLocation: {
      body: { endLine: 1, startLine: 1 },
      frontmatter: { endLine: 1, startLine: 1 },
      path: ".atlas/tracked-atlases/bad.md",
      snapshot: {
        atlas: { state: "known" },
        role: "home",
        slug: "home",
        snapshot: { state: "known" },
      },
    },
    tags: [],
    title: "Bad",
    type: "tracked-atlas",
  } as never);
  assert.equal(invalidLocator.state, "invalid");
  assert.equal(invalidLocator.findings[0]?.code, "ATLAS_LOCATOR_CREDENTIALS_REJECTED");
});

test("Explore reports tracked snapshots that resolve without a Root Anchor", () => {
  const tracked = trackedAtlasDeclaration("github.com", "owner", "rootless-atlas");
  const trackedSlug = tracked.slug.value;
  const trackedFiles = [
    captured(
      page(
        ".atlas/concepts/answer.md",
        "concept:answer",
        "concept",
        "Answer",
        "atlas: {}",
        "# Answer\n\nneedle rootless.",
      ),
    ),
  ];
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${trackedSlug}.md`,
        `tracked-atlas:${trackedSlug}`,
        "tracked-atlas",
        "Rootless Atlas",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/rootless-atlas.git\n  path: .`,
        "# Rootless Atlas\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-track-rootless.md",
        "edge:root-track-rootless",
        "edge",
        `Track ${trackedSlug}`,
        `atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:${trackedSlug}`,
        "# Track\n\nCross-Atlas route.",
      ),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () =>
        Object.freeze({
          snapshot: Object.freeze({
            capturedFiles: Object.freeze(trackedFiles),
            findings: Object.freeze([]),
            snapshot: "rootless-sha",
            trackedAtlas: tracked,
          }),
          state: "resolved" as const,
        }),
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "needle rootless",
  });
  assert.ok(
    result.payload.degradation.diagnostics.some(
      (finding) => finding.code === "ATLAS_CROSS_EDGE_TARGET_MISMATCH",
    ),
  );
});

test("Explore crosses tracked Atlases even when the cross-Atlas Edge is declared in reverse", () => {
  const tracked = trackedAtlasDeclaration("github.com", "owner", "reverse-atlas");
  const trackedSlug = tracked.slug.value;
  const trackedFiles = [
    captured(
      page(
        ".atlas/index.md",
        "anchor:root",
        "anchor",
        "Tracked Root",
        "atlas: {}",
        "# Tracked Root",
      ),
    ),
    captured(
      page(
        ".atlas/concepts/answer.md",
        "concept:answer",
        "concept",
        "Reverse Answer",
        "atlas: {}",
        "# Reverse Answer\n\nneedle reverse.",
      ),
    ),
  ];
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${trackedSlug}.md`,
        `tracked-atlas:${trackedSlug}`,
        "tracked-atlas",
        "Reverse Atlas",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/reverse-atlas.git\n  path: .`,
        "# Reverse Atlas\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/reverse-track.md",
        "edge:reverse-track",
        "edge",
        "Reverse Track",
        `atlas:\n  from: tracked-atlas:${trackedSlug}\n  semantics: [tracks-atlas]\n  to: anchor:root`,
        "# Reverse Track\n\nCross-Atlas route.",
      ),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () =>
        Object.freeze({
          snapshot: Object.freeze({
            capturedFiles: Object.freeze(trackedFiles),
            findings: Object.freeze([]),
            snapshot: "reverse-sha",
            trackedAtlas: tracked,
          }),
          state: "resolved" as const,
        }),
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "needle reverse",
  });
  assert.equal(result.payload.results[0]?.result.id, "concept:answer");
});

test("Explore uses the tracked Atlas Root Anchor catalog for unreachable tracked knowledge", () => {
  const tracked = trackedAtlasDeclaration("github.com", "owner", "catalog-atlas");
  const trackedSlug = tracked.slug.value;
  const trackedFiles = [
    captured(
      page(
        ".atlas/index.md",
        "anchor:root",
        "anchor",
        "Tracked Root",
        "atlas: {}",
        "# Tracked Root",
      ),
    ),
    captured(
      page(
        ".atlas/concepts/catalog.md",
        "concept:catalog",
        "concept",
        "Catalog",
        "atlas: {}",
        "# Catalog\n\nneedle catalog.",
      ),
    ),
  ];
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${trackedSlug}.md`,
        `tracked-atlas:${trackedSlug}`,
        "tracked-atlas",
        "Catalog Atlas",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/catalog-atlas.git\n  path: .`,
        "# Catalog Atlas\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-track-catalog.md",
        "edge:root-track-catalog",
        "edge",
        `Track ${trackedSlug}`,
        `atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:${trackedSlug}`,
        "# Track\n\nCross-Atlas route.",
      ),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () =>
        Object.freeze({
          snapshot: Object.freeze({
            capturedFiles: Object.freeze(trackedFiles),
            findings: Object.freeze([]),
            snapshot: "catalog-sha",
            trackedAtlas: tracked,
          }),
          state: "resolved" as const,
        }),
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "needle catalog",
  });
  assert.equal(result.payload.results[0]?.result.id, "concept:catalog");
});

test("Explore crosses to the tracked Atlas Root Anchor, re-anchors, and preserves source identity", () => {
  const tracked = trackedAtlasDeclaration("github.com", "owner", "remote-atlas");
  const trackedSlug = tracked.slug.value;
  const trackedFiles = [
    captured(
      page(
        ".atlas/index.md",
        "anchor:root",
        "anchor",
        "Tracked Root",
        "atlas: {}",
        "# Tracked Root",
      ),
    ),
    captured(
      page(
        ".atlas/principles/p.md",
        "principle:p",
        "principle",
        "P",
        "atlas: {}",
        "# P\n\n## Active truths\n\n- `truth:tracked` Keep tracked evidence explicit.\n",
      ),
    ),
    captured(
      page(
        ".atlas/sources/s.md",
        "source:s",
        "source",
        "Tracked Source",
        "atlas:\n  authority: official",
        "# Tracked Source\n\nRemote fact.",
      ),
    ),
    captured(
      page(
        ".atlas/concepts/answer.md",
        "concept:answer",
        "concept",
        "Remote Answer",
        "atlas: {}",
        "# Remote Answer\n\nneedle topic.[^s]\n\n[^s]: [[.atlas/sources/s]] Source.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-answer.md",
        "edge:root-answer",
        "edge",
        "Root Answer",
        "atlas:\n  from: anchor:root\n  semantics: [covers]\n  to: concept:answer",
        "# Root Answer\n\nRemote route.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-principle.md",
        "edge:root-principle",
        "edge",
        "Root Principle",
        "atlas:\n  from: anchor:root\n  semantics: [governs]\n  to: principle:p",
        "# Root Principle\n\nGoverned.",
      ),
    ),
  ];
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${trackedSlug}.md`,
        `tracked-atlas:${trackedSlug}`,
        "tracked-atlas",
        "Remote Atlas",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/remote-atlas.git\n  path: .`,
        "# Remote Atlas\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-track-remote.md",
        "edge:root-track-remote",
        "edge",
        "Root Tracks Remote",
        `atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:${trackedSlug}`,
        "# Root Tracks Remote\n\nCross-Atlas route.",
      ),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () =>
        Object.freeze({
          snapshot: Object.freeze({
            capturedFiles: Object.freeze(trackedFiles),
            findings: Object.freeze([]),
            snapshot: "tracked-sha",
            trackedAtlas: tracked,
          }),
          state: "resolved" as const,
        }),
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "needle topic",
  });
  const firstResult = result.payload.results[0];
  assert.ok(firstResult);
  assert.equal(firstResult.result.id, "concept:answer");
  assert.ok(firstResult.result.snapshot);
  assert.equal(firstResult.result.snapshot.slug, trackedSlug);
  assert.deepEqual(
    result.payload.reanchors.map((entry) => entry.anchor.snapshot?.slug),
    ["local-home-atlas", trackedSlug],
  );
  assert.ok(firstResult.citedContext[1]?.snapshot);
  assert.equal(firstResult.citedContext[1].snapshot.slug, trackedSlug);
  assert.equal(
    result.payload.reanchors[1]?.governingTruths[0]?.truthId,
    "truth:tracked",
  );
});

test("Explore terminates recursive tracked-Atlas cycles by resolved snapshot identity", () => {
  const left = trackedAtlasDeclaration("github.com", "owner", "left");
  const right = trackedAtlasDeclaration("github.com", "owner", "right");
  const leftSlug = left.slug.value;
  const rightSlug = right.slug.value;
  const leftFiles = Object.freeze([
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Left", "atlas: {}", "# Left"),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${rightSlug}.md`,
        `tracked-atlas:${rightSlug}`,
        "tracked-atlas",
        "Right",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/right.git\n  path: .`,
        "# Right\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-right.md",
        "edge:root-right",
        "edge",
        "Right",
        `atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:${rightSlug}`,
        "# Right\n\nCross-Atlas route.",
      ),
    ),
  ]);
  const rightFiles = Object.freeze([
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Right", "atlas: {}", "# Right"),
    ),
    captured(
      page(
        ".atlas/concepts/answer.md",
        "concept:answer",
        "concept",
        "Answer",
        "atlas: {}",
        "# Answer\n\nneedle cycle.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-answer.md",
        "edge:root-answer",
        "edge",
        "Answer",
        "atlas:\n  from: anchor:root\n  semantics: [covers]\n  to: concept:answer",
        "# Answer\n\nPath.",
      ),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${leftSlug}.md`,
        `tracked-atlas:${leftSlug}`,
        "tracked-atlas",
        "Left",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/left.git\n  path: .`,
        "# Left\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-left.md",
        "edge:root-left",
        "edge",
        "Left",
        `atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:${leftSlug}`,
        "# Left\n\nCycle.",
      ),
    ),
  ]);
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: ({ trackedAtlas }: { readonly trackedAtlas: TrackedAtlas }) =>
        Object.freeze({
          snapshot: Object.freeze({
            capturedFiles:
              trackedAtlas.slug.value === rightSlug ? rightFiles : leftFiles,
            findings: Object.freeze([]),
            snapshot: trackedAtlas.slug.value === rightSlug ? "right-sha" : "left-sha",
            trackedAtlas,
          }),
          state: "resolved" as const,
        }),
    }),
    baseSnapshot: { reference: "left-sha", state: "known" },
    budgets,
    capturedFiles: leftFiles,
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "needle cycle",
  });
  assert.equal(result.completion, "completed");
  assert.equal(result.payload.results[0]?.result.id, "concept:answer");
});

test("TrackedAtlas parsing rejects wrong page type and missing locator fields", () => {
  const wrongType = parseTrackedAtlas({
    id: "concept:oops",
    objectId: "concept:oops",
    page: {
      atlas: {},
      body: "# Oops",
      sdk: {
        id: "concept:oops",
        type: "concept",
        title: "Oops",
        "created-by": { kind: "human", name: "Fixture" },
        "updated-by": { kind: "human", name: "Fixture" },
      },
    },
    path: ".atlas/concepts/oops.md",
    snapshot: {
      atlas: { state: "known" },
      role: "home",
      slug: "home",
      snapshot: { state: "known" },
    },
    body: "# Oops",
    ownership: {
      createdBy: { kind: "human", name: "Fixture" },
      updatedBy: { kind: "human", name: "Fixture" },
    },
    sourceLocation: {
      body: { endLine: 1, startLine: 1 },
      frontmatter: { endLine: 1, startLine: 1 },
      path: ".atlas/concepts/oops.md",
      snapshot: {
        atlas: { state: "known" },
        role: "home",
        slug: "home",
        snapshot: { state: "known" },
      },
    },
    tags: [],
    title: "Oops",
    type: "concept",
  } as never);
  assert.equal(wrongType.state, "invalid");
  assert.equal(wrongType.findings[0]?.code, "ATLAS_CROSS_EDGE_TARGET_MISMATCH");

  const validWithoutDefault = parseTrackedAtlas({
    id: `tracked-atlas:${deriveAtlasSlug(atlasLocatorFromParts({ atlasPath: ".", branch: "main", host: "github.com", owner: "owner", repository: "repo" })).value}`,
    objectId: "tracked-atlas:repo",
    page: {
      atlas: {
        branch: "main",
        locator: "https://github.com/owner/repo.git",
        path: ".",
      },
      body: "# Repo",
      sdk: {
        id: `tracked-atlas:${deriveAtlasSlug(atlasLocatorFromParts({ atlasPath: ".", branch: "main", host: "github.com", owner: "owner", repository: "repo" })).value}`,
        type: "tracked-atlas",
        title: "Repo",
        "created-by": { kind: "human", name: "Fixture" },
        "updated-by": { kind: "human", name: "Fixture" },
      },
    },
    path: ".atlas/tracked-atlases/repo.md",
    snapshot: {
      atlas: { state: "known" },
      role: "home",
      slug: "home",
      snapshot: { state: "known" },
    },
    body: "# Repo",
    ownership: {
      createdBy: { kind: "human", name: "Fixture" },
      updatedBy: { kind: "human", name: "Fixture" },
    },
    sourceLocation: {
      body: { endLine: 1, startLine: 1 },
      frontmatter: { endLine: 1, startLine: 1 },
      path: ".atlas/tracked-atlases/repo.md",
      snapshot: {
        atlas: { state: "known" },
        role: "home",
        slug: "home",
        snapshot: { state: "known" },
      },
    },
    tags: [],
    title: "Repo",
    type: "tracked-atlas",
  } as never);
  assert.equal(validWithoutDefault.state, "tracked");
  assert.equal(validWithoutDefault.trackedAtlas.defaultBranch, "main");

  const missingFields = parseTrackedAtlas({
    id: "tracked-atlas:missing",
    objectId: "tracked-atlas:missing",
    page: {
      atlas: {},
      body: "# Missing",
      sdk: {
        id: "tracked-atlas:missing",
        type: "tracked-atlas",
        title: "Missing",
        "created-by": { kind: "human", name: "Fixture" },
        "updated-by": { kind: "human", name: "Fixture" },
      },
    },
    path: ".atlas/tracked-atlases/missing.md",
    snapshot: {
      atlas: { state: "known" },
      role: "home",
      slug: "home",
      snapshot: { state: "known" },
    },
    body: "# Missing",
    ownership: {
      createdBy: { kind: "human", name: "Fixture" },
      updatedBy: { kind: "human", name: "Fixture" },
    },
    sourceLocation: {
      body: { endLine: 1, startLine: 1 },
      frontmatter: { endLine: 1, startLine: 1 },
      path: ".atlas/tracked-atlases/missing.md",
      snapshot: {
        atlas: { state: "known" },
        role: "home",
        slug: "home",
        snapshot: { state: "known" },
      },
    },
    tags: [],
    title: "Missing",
    type: "tracked-atlas",
  } as never);
  assert.equal(missingFields.state, "invalid");
  assert.equal(missingFields.findings[0]?.code, "ATLAS_INGEST_SOURCE_MARKER_INVALID");
});

test("Explore falls back to legacy traversal when no tracked Atlases are present", () => {
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () => {
        throw new Error("unused");
      },
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "Home",
  });
  assert.equal(hasConnectedAtlasEdges({ objects: Object.freeze([]) } as never), false);
  assert.equal(result.payload.degradation.level, "valid-structured");
});

test("Explore skips bogus connected candidates that do not resolve to a route", () => {
  const tracked = trackedAtlasDeclaration("github.com", "owner", "remote-atlas");
  const trackedSlug = tracked.slug.value;
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${trackedSlug}.md`,
        `tracked-atlas:${trackedSlug}`,
        "tracked-atlas",
        "Remote Atlas",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/remote-atlas.git\n  path: .`,
        "# Remote Atlas\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-track-remote.md",
        "edge:root-track-remote",
        "edge",
        "Root Tracks Remote",
        `atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:${trackedSlug}`,
        "# Root Tracks Remote\n\nCross-Atlas route.",
      ),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () =>
        Object.freeze({
          findings: Object.freeze([]),
          snapshot: Object.freeze({
            capturedFiles: Object.freeze([
              captured(
                page(
                  ".atlas/index.md",
                  "anchor:root",
                  "anchor",
                  "Tracked",
                  "atlas: {}",
                  "# Tracked",
                ),
              ),
            ]),
            findings: Object.freeze([]),
            snapshot: "tracked",
            trackedAtlas: tracked,
          }),
          state: "resolved" as const,
        }),
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    provider: Object.freeze({
      rank: () => Object.freeze([{ objectId: "bogus", score: 1 }]),
    }),
    query: "bogus",
  });
  assert.deepEqual(result.payload.results, []);
});

test("Explore enforces connected maxResults", () => {
  const tracked = trackedAtlasDeclaration("github.com", "owner", "remote-many");
  const trackedSlug = tracked.slug.value;
  const trackedFiles = [
    captured(
      page(
        ".atlas/index.md",
        "anchor:root",
        "anchor",
        "Tracked Root",
        "atlas: {}",
        "# Tracked Root",
      ),
    ),
    captured(
      page(
        ".atlas/concepts/one.md",
        "concept:one",
        "concept",
        "One",
        "atlas: {}",
        "# One\n\nneedle many.",
      ),
    ),
    captured(
      page(
        ".atlas/concepts/two.md",
        "concept:two",
        "concept",
        "Two",
        "atlas: {}",
        "# Two\n\nneedle many.",
      ),
    ),
  ];
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${trackedSlug}.md`,
        `tracked-atlas:${trackedSlug}`,
        "tracked-atlas",
        "Remote Atlas",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/remote-many.git\n  path: .`,
        "# Remote Atlas\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-track-many.md",
        "edge:root-track-many",
        "edge",
        "Root Tracks Many",
        `atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:${trackedSlug}`,
        "# Root Tracks Many\n\nCross-Atlas route.",
      ),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () =>
        Object.freeze({
          snapshot: Object.freeze({
            capturedFiles: Object.freeze(trackedFiles),
            findings: Object.freeze([]),
            snapshot: "many-sha",
            trackedAtlas: tracked,
          }),
          state: "resolved" as const,
        }),
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets: { ...budgets, maxResults: 1 },
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "needle many",
  });
  assert.equal(result.payload.results.length, 1);
});

test("Explore with tracked Atlases falls back when the home Root Anchor is absent", () => {
  const tracked = trackedAtlasDeclaration("github.com", "owner", "rootless-home");
  const trackedSlug = tracked.slug.value;
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () => {
        throw new Error("unused");
      },
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze([
      captured(
        page(
          `.atlas/tracked-atlases/${trackedSlug}.md`,
          `tracked-atlas:${trackedSlug}`,
          "tracked-atlas",
          "Remote Atlas",
          `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/rootless-home.git\n  path: .`,
          "# Remote Atlas\n\nTrackedAtlas declaration.",
        ),
      ),
    ]),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "none",
  });
  assert.equal(result.payload.degradation.level, "blocked");
});

test("Explore reports unreachable tracked Atlases and provider failures as degraded", () => {
  const tracked = trackedAtlasDeclaration("github.com", "owner", "remote-atlas");
  const trackedSlug = tracked.slug.value;
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
    captured(
      page(
        `.atlas/tracked-atlases/${trackedSlug}.md`,
        `tracked-atlas:${trackedSlug}`,
        "tracked-atlas",
        "Remote Atlas",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/remote-atlas.git\n  path: .`,
        "# Remote Atlas\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-track-remote.md",
        "edge:root-track-remote",
        "edge",
        "Root Tracks Remote",
        `atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:${trackedSlug}`,
        "# Root Tracks Remote\n\nCross-Atlas route.",
      ),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () =>
        Object.freeze({
          findings: Object.freeze([
            {
              attribution: {
                checkId: "test",
                kind: "sdk-core" as const,
                trusted: true as const,
              },
              code: "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE",
              "finding-schema": "1.0.0" as const,
              message: "offline",
              path: ".atlas",
              severity: "warning" as const,
            },
          ]),
          state: "unreachable" as const,
        }),
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    provider: Object.freeze({
      rank: () => {
        throw new Error("boom");
      },
    }),
    query: "needle",
  });
  assert.equal(result.payload.degradation.level, "partial-structure");
  assert.deepEqual(result.payload.results, []);
});

test("Atlas cache reports first-contact resolution failures after fetch", () => {
  const home = resolve(WORKSPACE, "home-cache-first-contact-revision");
  initRepository(home);
  commitAll(home, "home");
  const remote = createBareRemote("tracked-first-contact-revision", [
    page(
      ".atlas/index.md",
      "anchor:root",
      "anchor",
      "Tracked Home",
      "atlas: {}",
      "# Tracked Home",
    ),
  ]);
  const tracked = trackedAtlasDeclaration(
    "github.com",
    "owner",
    "tracked-first-contact-revision",
  );
  const first = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    {
      readGit: (repository: string, args: readonly string[]) =>
        args[0] === "rev-parse" && String(args[1]).startsWith("refs/heads/")
          ? { reason: "bad", state: "failed" as const }
          : spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" })
                .status === 0
            ? {
                state: "succeeded" as const,
                stdout: spawnSync("git", ["-C", repository, ...args], {
                  encoding: "utf8",
                }).stdout,
              }
            : { reason: "bad", state: "failed" as const },
      resolveRemote: () => remote,
    },
  );
  assert.equal(first.state, "unreachable");
});

test("Atlas cache reports a second-contact first-contact failure when the remote disappears immediately after publication", () => {
  const home = resolve(WORKSPACE, "home-cache-second-contact");
  initRepository(home);
  commitAll(home, "home");
  const remote = createBareRemote("tracked-second-contact", [
    page(
      ".atlas/index.md",
      "anchor:root",
      "anchor",
      "Tracked Home",
      "atlas: {}",
      "# Tracked Home",
    ),
  ]);
  const tracked = trackedAtlasDeclaration(
    "github.com",
    "owner",
    "tracked-second-contact",
  );
  let calls = 0;
  const result = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    {
      resolveRemote: () =>
        calls++ === 0 ? remote : resolve(WORKSPACE, "missing-after-publication.git"),
    },
  );
  assert.equal(result.state, "unreachable");
  assert.equal(result.findings[0]?.code, "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE");
});

test("Atlas cache reports unreadable revisions and missing cached trees", () => {
  const home = resolve(WORKSPACE, "home-cache-errors");
  initRepository(home);
  commitAll(home, "home");
  const tracked = trackedAtlasDeclaration("github.com", "owner", "remote-errors");
  const remote = createBareRemote("tracked-errors", [
    page("README.md", "ignored", "anchor", "Ignored", "atlas: {}", "# ignored"),
  ]);
  const seeded = resolveAtlasCache(
    {
      homeAtlasDirectory: home,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked,
    },
    { resolveRemote: () => remote },
  );
  assert.equal(seeded.state, "unreachable");

  const home2 = resolve(WORKSPACE, "home-cache-revision");
  initRepository(home2);
  commitAll(home2, "home");
  const remote2 = createBareRemote("tracked-revision", [
    page(
      ".atlas/index.md",
      "anchor:root",
      "anchor",
      "Tracked Home",
      "atlas: {}",
      "# Tracked Home",
    ),
  ]);
  const tracked2 = trackedAtlasDeclaration("github.com", "owner", "tracked-revision");
  const first = resolveAtlasCache(
    {
      homeAtlasDirectory: home2,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked2,
    },
    { resolveRemote: () => remote2 },
  );
  assert.equal(first.state, "resolved");
  rmSync(remote2, { force: true, recursive: true });
  const unreadable = resolveAtlasCache(
    {
      homeAtlasDirectory: home2,
      introducedByAnchorId: "anchor:root",
      introducedByEdgeId: "edge:track",
      trackedAtlas: tracked2,
    },
    {
      readGit: (repository: string, args: readonly string[]) =>
        args[0] === "rev-parse" && String(args[1]).startsWith("refs/heads/")
          ? { reason: "bad", state: "failed" as const }
          : spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" })
                .status === 0
            ? {
                state: "succeeded" as const,
                stdout: spawnSync("git", ["-C", repository, ...args], {
                  encoding: "utf8",
                }).stdout,
              }
            : { reason: "bad", state: "failed" as const },
      resolveRemote: (() => {
        let calls = 0;
        return () => (calls++ === 0 ? remote2 : resolve(WORKSPACE, "gone.git"));
      })(),
    },
  );
  assert.equal(unreadable.state, "unreachable");
});

test("Local Explore cache resolver forwards tracked Atlas requests", () => {
  const home = resolve(WORKSPACE, "home-local-resolver");
  initRepository(home);
  commitAll(home, "home");
  const tracked = trackedAtlasDeclaration("github.com", "owner", "missing-remote");
  const result = localAtlasCacheResolver(home).resolve({
    introducedByAnchorId: "anchor:root",
    introducedByEdgeId: "edge:track",
    trackedAtlas: tracked,
  });
  assert.equal(result.state, "unreachable");
});

test("Atlas tree capture uses default trusted Git runners", () => {
  const remote = createBareRemote("tracked-local-explore", [
    page(
      ".atlas/index.md",
      "anchor:root",
      "anchor",
      "Tracked Home",
      "atlas: {}",
      "# Tracked Home",
    ),
  ]);
  const revision = spawnSync("git", ["--git-dir", remote, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  assert.equal(revision.status, 0, revision.stderr);
  const capture = captureAtlasTree(remote, revision.stdout.trim(), ".atlas", ".", {
    maxFileBytes: 8192,
    maxFiles: 128,
    maxTotalBytes: 65536,
  });
  assert.equal(capture.state, "captured");
});

test("Explore reports tracked-Atlas target mismatch deterministically", () => {
  const homeFiles = [
    captured(
      page(".atlas/index.md", "anchor:root", "anchor", "Home", "atlas: {}", "# Home"),
    ),
    captured(
      page(
        ".atlas/tracked-atlases/bad.md",
        "tracked-atlas:bad",
        "tracked-atlas",
        "Bad",
        `atlas:\n  branch: main\n  default-branch: main\n  locator: https://github.com/owner/real.git\n  path: .`,
        "# Bad\n\nTrackedAtlas declaration.",
      ),
    ),
    captured(
      page(
        ".atlas/edges/root-bad.md",
        "edge:root-bad",
        "edge",
        "Bad",
        "atlas:\n  from: anchor:root\n  semantics: [tracks-atlas]\n  to: tracked-atlas:bad",
        "# Bad\n\nCross-Atlas route.",
      ),
    ),
  ];
  const result = runExploreOperation({
    atlasCacheResolver: Object.freeze({
      resolve: () => {
        throw new Error("should not resolve mismatched declaration");
      },
    }),
    baseSnapshot: { reference: "home-sha", state: "known" },
    budgets,
    capturedFiles: Object.freeze(homeFiles),
    homeAtlas: { reference: "local-home-atlas", state: "known" },
    query: "missing",
  });
  assert.equal(result.payload.degradation.level, "partial-structure");
  assert.ok(
    result.payload.degradation.diagnostics.some(
      (finding) => finding.code === "ATLAS_CROSS_EDGE_TARGET_MISMATCH",
    ),
  );
});
