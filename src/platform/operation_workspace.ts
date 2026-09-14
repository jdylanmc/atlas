import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  runTrustedGit,
  runTrustedGitBytesCommand,
  type TrustedGitBytesResult,
} from "./trusted_git.ts";

interface WorkspaceTreeEntry {
  readonly mode: "100644" | "100755" | "120000" | "160000";
  readonly object: string;
  readonly path: string;
  readonly type: "blob" | "commit";
}

export interface OperationWorkspaceGit {
  readonly run: typeof runTrustedGit;
  readonly runBytesCommand: typeof runTrustedGitBytesCommand;
}

const defaultOperationWorkspaceGit: OperationWorkspaceGit = Object.freeze({
  run: runTrustedGit,
  runBytesCommand: runTrustedGitBytesCommand,
});

function failed(message: string): never {
  throw new Error(`Operation Workspace completion failed: ${message}`);
}

function treeEntries(
  repository: string,
  revision: string,
  git: OperationWorkspaceGit,
): readonly WorkspaceTreeEntry[] {
  const result = git.run(repository, ["ls-tree", "-rz", "-r", "--full-tree", revision]);
  if (result.state === "failed") failed("Git could not list the committed tree.");
  const entries: WorkspaceTreeEntry[] = [];
  for (const raw of result.stdout.split("\0")) {
    if (raw === "") continue;
    const separator = raw.indexOf("\t");
    if (separator < 0) failed("Git returned a malformed tree entry.");
    const [mode, type, object, extra] = raw.slice(0, separator).split(" ");
    const path = raw.slice(separator + 1);
    if (extra !== undefined) failed("Git returned an unsupported tree entry.");
    if (object === undefined) failed("Git returned an unsupported tree entry.");
    if (path === "") failed("Git returned an unsupported tree entry.");
    const supportedBlob =
      type === "blob" && (mode === "100644" || mode === "100755" || mode === "120000");
    const supportedGitlink = type === "commit" && mode === "160000";
    if (!supportedBlob && !supportedGitlink) {
      failed("Git returned an unsupported tree entry.");
    }
    entries.push({
      mode,
      object,
      path,
      type,
    });
  }
  return Object.freeze(entries);
}

function workspacePath(workspace: string, path: string): string {
  const root = resolve(workspace);
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (isAbsolute(path) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    failed("the committed tree contains a path outside the workspace.");
  }
  return absolute;
}

function blobBytes(
  repository: string,
  entry: WorkspaceTreeEntry,
  cache: Map<string, Uint8Array>,
  git: OperationWorkspaceGit,
): Uint8Array {
  const cached = cache.get(entry.object);
  if (cached !== undefined) return cached;
  const sizeResult = git.run(repository, ["cat-file", "-s", entry.object]);
  if (sizeResult.state === "failed") failed("Git could not size a committed blob.");
  const size = Number(sizeResult.stdout.trim());
  if (!Number.isSafeInteger(size))
    failed("Git returned an invalid committed blob size.");
  if (size < 0) failed("Git returned an invalid committed blob size.");
  const result: TrustedGitBytesResult = git.runBytesCommand({
    args: ["cat-file", "blob", entry.object],
    directory: repository,
    maxBuffer: size + 1,
    repository,
  });
  if (result.state === "failed") {
    failed("Git could not read the exact committed blob bytes.");
  }
  if (result.stdout.byteLength !== size) {
    failed("Git could not read the exact committed blob bytes.");
  }
  cache.set(entry.object, result.stdout);
  return result.stdout;
}

function ensureParentDirectories(workspace: string, path: string): void {
  const root = resolve(workspace);
  const parent = dirname(workspacePath(workspace, path));
  const fromRoot = relative(root, parent);
  let current = root;
  for (const component of fromRoot === "" ? [] : fromRoot.split(sep)) {
    current = resolve(current, component);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined) {
      mkdirSync(current);
      continue;
    }
    if (!stat.isDirectory()) {
      failed(`a workspace parent is not an owned directory: ${path}`);
    }
  }
}

function pathMatchesEntry(
  repository: string,
  workspace: string,
  entry: WorkspaceTreeEntry,
  cache: Map<string, Uint8Array>,
  git: OperationWorkspaceGit,
): boolean {
  const path = workspacePath(workspace, entry.path);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return false;
  const bytes = blobBytes(repository, entry, cache, git);
  if (entry.mode === "120000") {
    return (
      stat.isSymbolicLink() &&
      Buffer.from(readlinkSync(path, { encoding: "buffer" })).equals(Buffer.from(bytes))
    );
  }
  return stat.isFile() && Buffer.from(readFileSync(path)).equals(Buffer.from(bytes));
}

function removeBaseOnlyPaths(
  repository: string,
  workspace: string,
  baseEntries: readonly WorkspaceTreeEntry[],
  committedPaths: ReadonlySet<string>,
  cache: Map<string, Uint8Array>,
  git: OperationWorkspaceGit,
): void {
  for (const entry of baseEntries.toSorted(
    (left, right) => right.path.length - left.path.length,
  )) {
    if (committedPaths.has(entry.path)) continue;
    if (entry.mode === "160000") continue;
    const path = workspacePath(workspace, entry.path);
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) continue;
    if (!pathMatchesEntry(repository, workspace, entry, cache, git)) {
      failed(`a removed tracked path contains unowned changes: ${entry.path}`);
    }
    rmSync(path, { force: true, recursive: true });
  }
}

function materializeEntry(
  repository: string,
  workspace: string,
  entry: WorkspaceTreeEntry,
  baseEntry: WorkspaceTreeEntry | undefined,
  cache: Map<string, Uint8Array>,
  git: OperationWorkspaceGit,
): void {
  if (entry.mode === "160000") return;
  const path = workspacePath(workspace, entry.path);
  ensureParentDirectories(workspace, entry.path);
  if (pathMatchesEntry(repository, workspace, entry, cache, git)) {
    if (entry.mode === "100644") chmodSync(path, 0o644);
    if (entry.mode === "100755") chmodSync(path, 0o755);
    return;
  }
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing !== undefined) {
    if (baseEntry === undefined) {
      failed(`a committed path contains unowned changes: ${entry.path}`);
    }
    if (!pathMatchesEntry(repository, workspace, baseEntry, cache, git)) {
      failed(`a committed path contains unowned changes: ${entry.path}`);
    }
    rmSync(path, { force: true, recursive: true });
  }
  const bytes = blobBytes(repository, entry, cache, git);
  if (entry.mode === "120000") {
    symlinkSync(Buffer.from(bytes), path);
    return;
  }
  writeFileSync(path, bytes, {
    flag: "wx",
    mode: entry.mode === "100755" ? 0o755 : 0o644,
  });
}

/**
 * Completes a newly owned Operation Workspace from committed Git object bytes.
 * tests/governance_cli.test.ts pins that direct object reads do not invoke
 * tracked filters or checkout hooks.
 */
export function completeOperationWorkspace(
  workspace: string,
  baseRevision: string,
  committedRevision: string,
  git: OperationWorkspaceGit = defaultOperationWorkspaceGit,
): void {
  const baseEntries = treeEntries(workspace, baseRevision, git);
  const committedEntries = treeEntries(workspace, committedRevision, git);
  const baseByPath = new Map(baseEntries.map((entry) => [entry.path, entry]));
  const committedPaths = new Set(committedEntries.map((entry) => entry.path));
  const cache = new Map<string, Uint8Array>();
  removeBaseOnlyPaths(workspace, workspace, baseEntries, committedPaths, cache, git);
  for (const entry of committedEntries) {
    materializeEntry(
      workspace,
      workspace,
      entry,
      baseByPath.get(entry.path),
      cache,
      git,
    );
  }
}
