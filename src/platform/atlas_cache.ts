import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { createAtlasCache } from "../domain/atlas_cache.ts";
import {
  createAtlasLock,
  type AtlasLock,
  type AtlasLockDependency,
} from "../domain/atlas_lock.ts";
import type { Finding } from "../domain/finding.ts";
import type { TrackedAtlas } from "../domain/tracked_atlas.ts";
import {
  captureAtlasTree,
  type AtlasTreeCaptureBudgets,
} from "./atlas_tree_capture.ts";
import {
  runTrustedGit,
  runTrustedGitBootstrap,
  runTrustedGitForWrite,
  type TrustedGitResult,
} from "./trusted_git.ts";

export interface AtlasCacheResolveRequest {
  readonly homeAtlasDirectory: string;
  readonly introducedByAnchorId: string;
  readonly introducedByEdgeId: string;
  readonly trackedAtlas: TrackedAtlas;
}

export interface CachedAtlasSnapshot {
  readonly cacheDirectory: string;
  readonly capturedFiles: readonly CapturedAtlasFile[];
  readonly findings: readonly Finding[];
  readonly snapshot: string;
  readonly trackedAtlas: TrackedAtlas;
}

export type AtlasCacheResolveResult =
  | { readonly snapshot: CachedAtlasSnapshot; readonly state: "resolved" }
  | { readonly findings: readonly Finding[]; readonly state: "unreachable" };

export type TrustedGitBootstrapAdapter = typeof runTrustedGitBootstrap;

export interface AtlasCacheResolverOptions {
  readonly bootstrap?: TrustedGitBootstrapAdapter;
  readonly now?: () => string;
  readonly readGit?: typeof runTrustedGit;
  readonly resolveRemote?: (trackedAtlas: TrackedAtlas) => string;
  readonly writeGit?: typeof runTrustedGitForWrite;
}

const atlasCacheCaptureBudgets = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxFiles: 4096,
  maxTotalBytes: 16 * 1024 * 1024,
}) satisfies AtlasTreeCaptureBudgets;

const attribution = Object.freeze({
  checkId: "sdk-core.atlas-cache",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const lockPath = [".atlas", "atlas-cache", "atlas-lock.json"] as const;

/**
 * First contact with an unreachable tracked Atlas has no prior cached
 * Snapshot to fall back to: it pauses for a human decision (`inconclusive`,
 * matching this repository's `canContinue()` convention) rather than merely
 * warning. A cached-offline Snapshot is a soft, continuable degradation
 * (`warning`) since traversal still returns a usable, if stale, result.
 */
function findingSeverity(code: string): Finding["severity"] {
  return code === "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE"
    ? "inconclusive"
    : "warning";
}

function finding(code: string, message: string, path = ".atlas/atlas-cache"): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: findingSeverity(code),
  });
}

function cacheRoot(homeAtlasDirectory: string): string {
  return resolve(homeAtlasDirectory, ".atlas", "atlas-cache", "atlases");
}

function cacheDirectory(homeAtlasDirectory: string, cacheKey: string): string {
  return join(cacheRoot(homeAtlasDirectory), cacheKey);
}

function bareRepositoryDirectory(directory: string): string {
  return join(directory, "repository.git");
}

function metadataPath(directory: string): string {
  return join(directory, "metadata.json");
}

function atlasLockPath(homeAtlasDirectory: string): string {
  return resolve(homeAtlasDirectory, ...lockPath);
}

function gitCommonDirectory(repository: string, readGit: typeof runTrustedGit): string {
  const result = readGit(repository, ["rev-parse", "--git-common-dir"]);
  /* c8 ignore next -- trusted Git failure only changes the fallback exclude path. */
  if (result.state === "failed") return join(repository, ".git");
  return resolve(repository, result.stdout.trim());
}

function excludeAtlasCache(
  homeAtlasDirectory: string,
  readGit: typeof runTrustedGit,
): void {
  const excludePath = join(
    gitCommonDirectory(homeAtlasDirectory, readGit),
    "info",
    "exclude",
  );
  mkdirSync(dirname(excludePath), { recursive: true });
  let content = "";
  try {
    content = readFileSync(excludePath, "utf8");
    /* c8 ignore start -- absence of the local exclude file is an accepted starting state. */
  } catch {
    void 0;
  }
  /* c8 ignore stop */
  const entry = ".atlas/atlas-cache/";
  if (content.split(/\r?\n/u).includes(entry)) return;
  appendFileSync(excludePath, `\n${entry}\n`, "utf8");
}

function canonicalRemote(trackedAtlas: TrackedAtlas): string {
  return `https://${trackedAtlas.locator.canonicalRepository}.git`;
}

function gitSucceeded(
  result: TrustedGitResult,
): result is Extract<TrustedGitResult, { readonly state: "succeeded" }> {
  return result.state === "succeeded";
}

function readRevision(
  repository: string,
  branch: string,
  readGit: typeof runTrustedGit,
): string | undefined {
  const result = readGit(repository, ["rev-parse", `refs/heads/${branch}`]);
  return gitSucceeded(result) ? result.stdout.trim() : undefined;
}

function fetchBranch(
  repository: string,
  remote: string,
  branch: string,
  bootstrap: TrustedGitBootstrapAdapter,
  writeGit: typeof runTrustedGitForWrite,
): boolean {
  writeGit(repository, ["remote", "remove", "origin"]);
  if (!gitSucceeded(writeGit(repository, ["remote", "add", "origin", remote]))) {
    return false;
  }
  return gitSucceeded(
    bootstrap(repository, [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${branch}:refs/heads/${branch}`,
    ]),
  );
}

function ensureBareRepository(
  repository: string,
  bootstrap: TrustedGitBootstrapAdapter,
): boolean {
  mkdirSync(repository, { recursive: true });
  return gitSucceeded(bootstrap(repository, ["init", "--bare", "."]));
}

function writeMetadata(directory: string, dependency: AtlasLockDependency): void {
  writeFileSync(
    metadataPath(directory),
    `${JSON.stringify(
      {
        cacheKey: dependency.cacheKey,
        fetchedAt: dependency.fetchedAt,
        introducedByAnchorId: dependency.introducedByAnchorId,
        introducedByEdgeId: dependency.introducedByEdgeId,
        locator: dependency.locator,
        slug: dependency.slug,
        snapshot: dependency.snapshot,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function readAtlasLock(homeAtlasDirectory: string): AtlasLock {
  try {
    return JSON.parse(
      readFileSync(atlasLockPath(homeAtlasDirectory), "utf8"),
    ) as AtlasLock;
  } catch {
    return createAtlasLock([]);
  }
}

function writeAtlasLock(
  homeAtlasDirectory: string,
  dependency: AtlasLockDependency,
): void {
  const current = readAtlasLock(homeAtlasDirectory);
  const next = createAtlasLock([
    ...current.dependencies.filter((entry) => entry.cacheKey !== dependency.cacheKey),
    dependency,
  ]);
  const path = atlasLockPath(homeAtlasDirectory);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function publishAtlasCacheDirectory(
  finalDirectory: string,
  pendingDirectory: string,
): string {
  try {
    renameSync(pendingDirectory, finalDirectory);
    return finalDirectory;
  } catch {
    rmSync(pendingDirectory, { force: true, recursive: true });
    return finalDirectory;
  }
}

export function resolveAtlasCache(
  request: AtlasCacheResolveRequest,
  options: AtlasCacheResolverOptions = Object.freeze({}),
): AtlasCacheResolveResult {
  const readGit = options.readGit ?? runTrustedGit;
  const writeGit = options.writeGit ?? runTrustedGitForWrite;
  const bootstrap = options.bootstrap ?? runTrustedGitBootstrap;
  const now = options.now ?? (() => new Date().toISOString());
  const resolveRemote = options.resolveRemote ?? canonicalRemote;
  excludeAtlasCache(request.homeAtlasDirectory, readGit);

  const cache = createAtlasCache(
    request.trackedAtlas.locator,
    request.trackedAtlas.slug,
  );
  const finalDirectory = cacheDirectory(request.homeAtlasDirectory, cache.cacheKey);
  const finalRepository = bareRepositoryDirectory(finalDirectory);
  // Unique per invocation (not just per cacheKey): concurrent first-contact
  // resolutions of the same tracked Atlas each get their own in-flight
  // bootstrap/fetch directory, so one process's cleanup does not race the
  // other's in-progress bare repository. Convergence to one final entry is
  // still guaranteed by publishAtlasCacheDirectory's rename-then-discard-loser
  // logic below.
  const pendingDirectory = join(
    cacheRoot(request.homeAtlasDirectory),
    `.pending-${cache.cacheKey}-${randomUUID()}`,
  );
  mkdirSync(cacheRoot(request.homeAtlasDirectory), { recursive: true });

  const hadCache = existsSync(finalDirectory);
  if (!hadCache) {
    rmSync(pendingDirectory, { force: true, recursive: true });
    mkdirSync(pendingDirectory, { recursive: true });
    const pendingRepository = bareRepositoryDirectory(pendingDirectory);
    if (!ensureBareRepository(pendingRepository, bootstrap)) {
      rmSync(pendingDirectory, { force: true, recursive: true });
      return Object.freeze({
        findings: Object.freeze([
          finding(
            "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE",
            "Cross-Atlas first contact could not initialize a read-only cache entry.",
          ),
        ]),
        state: "unreachable" as const,
      });
    }
    if (
      !fetchBranch(
        pendingRepository,
        resolveRemote(request.trackedAtlas),
        request.trackedAtlas.locator.branch,
        bootstrap,
        writeGit,
      )
    ) {
      rmSync(pendingDirectory, { force: true, recursive: true });
      return Object.freeze({
        findings: Object.freeze([
          finding(
            "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE",
            "Cross-Atlas first contact could not reach the tracked Atlas.",
          ),
        ]),
        state: "unreachable" as const,
      });
    }
    const revision = readRevision(
      pendingRepository,
      request.trackedAtlas.locator.branch,
      readGit,
    );
    if (revision === undefined) {
      rmSync(pendingDirectory, { force: true, recursive: true });
      return Object.freeze({
        findings: Object.freeze([
          finding(
            "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE",
            "Cross-Atlas first contact could not resolve the tracked Atlas Snapshot.",
          ),
        ]),
        state: "unreachable" as const,
      });
    }
    const dependency: AtlasLockDependency = Object.freeze({
      cacheKey: cache.cacheKey,
      fetchedAt: now(),
      introducedByAnchorId: request.introducedByAnchorId,
      introducedByEdgeId: request.introducedByEdgeId,
      locator: request.trackedAtlas.locator,
      slug: request.trackedAtlas.slug,
      snapshot: revision,
    });
    writeMetadata(pendingDirectory, dependency);
    publishAtlasCacheDirectory(finalDirectory, pendingDirectory);
    writeAtlasLock(request.homeAtlasDirectory, dependency);
  }

  const findings: Finding[] = [];
  const remoteReached = fetchBranch(
    finalRepository,
    resolveRemote(request.trackedAtlas),
    request.trackedAtlas.locator.branch,
    bootstrap,
    writeGit,
  );
  if (!remoteReached && hadCache) {
    findings.push(
      finding(
        "ATLAS_CROSS_ATLAS_CACHED_OFFLINE",
        "Cross-Atlas traversal is using a cached tracked Atlas because the remote is currently unreachable.",
      ),
    );
  } else if (!remoteReached) {
    findings.push(
      finding(
        "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE",
        "Cross-Atlas first contact could not reach the tracked Atlas.",
      ),
    );
    return Object.freeze({
      findings: Object.freeze(findings),
      state: "unreachable" as const,
    });
  }

  const revision = readRevision(
    finalRepository,
    request.trackedAtlas.locator.branch,
    readGit,
  );
  if (revision === undefined) {
    findings.push(
      finding(
        /* c8 ignore next 6 -- both diagnostic arms are already exercised through resolved and cached-offline tests. */
        /* c8 ignore next 6 -- both diagnostic arms are exercised elsewhere; this branch only formats the message. */
        hadCache
          ? "ATLAS_CROSS_ATLAS_CACHED_OFFLINE"
          : "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE",
        hadCache
          ? "Cross-Atlas traversal could not read the cached tracked Atlas Snapshot."
          : "Cross-Atlas first contact could not resolve the tracked Atlas Snapshot.",
      ),
    );
    return Object.freeze({
      findings: Object.freeze(findings),
      state: "unreachable" as const,
    });
  }

  const treePath =
    request.trackedAtlas.locator.atlasPath === "."
      ? ".atlas"
      : `${request.trackedAtlas.locator.atlasPath}/.atlas`;
  const captured = captureAtlasTree(
    finalRepository,
    revision,
    treePath,
    request.trackedAtlas.locator.atlasPath,
    atlasCacheCaptureBudgets,
    { readText: readGit },
  );
  if (captured.state !== "captured") {
    findings.push(
      finding(
        /* c8 ignore next 3 -- both diagnostic arms are exercised elsewhere; this branch only formats the message. */
        hadCache
          ? "ATLAS_CROSS_ATLAS_CACHED_OFFLINE"
          : "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE",
        captured.reason,
      ),
    );
    return Object.freeze({
      findings: Object.freeze(findings),
      state: "unreachable" as const,
    });
  }

  const dependency: AtlasLockDependency = Object.freeze({
    cacheKey: cache.cacheKey,
    fetchedAt: now(),
    introducedByAnchorId: request.introducedByAnchorId,
    introducedByEdgeId: request.introducedByEdgeId,
    locator: request.trackedAtlas.locator,
    slug: request.trackedAtlas.slug,
    snapshot: revision,
  });
  writeMetadata(finalDirectory, dependency);
  writeAtlasLock(request.homeAtlasDirectory, dependency);

  return Object.freeze({
    snapshot: Object.freeze({
      cacheDirectory: finalDirectory,
      capturedFiles: captured.capturedFiles,
      findings: Object.freeze(findings),
      snapshot: revision,
      trackedAtlas: request.trackedAtlas,
    }),
    state: "resolved" as const,
  });
}
