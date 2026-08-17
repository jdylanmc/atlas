import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  RealmLoadError,
  type FileTreeEntry,
  type ReadOnlyFileTree,
} from "../realm/load_realm_text.ts";

function containedPath(root: string, segments: readonly string[]): string {
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    throw new RealmLoadError("INVALID_PATH");
  }

  return resolve(root, ...segments);
}

async function entryKind(path: string): Promise<FileTreeEntry["kind"]> {
  const status = await lstat(path);
  if (status.isSymbolicLink()) {
    return "symbolic-link";
  }
  if (status.isDirectory()) {
    return "directory";
  }
  if (status.isFile()) {
    return "file";
  }
  return "unsupported";
}

export function createNodeReadOnlyFileTree(realmHostPath: string): ReadOnlyFileTree {
  const root = resolve(realmHostPath);
  return Object.freeze({
    async listDirectory(
      segments: readonly string[],
    ): Promise<readonly FileTreeEntry[]> {
      const directory = containedPath(root, segments);
      try {
        if ((await entryKind(directory)) === "symbolic-link") {
          throw new RealmLoadError("SYMLINK_NOT_ALLOWED");
        }
        const names = await readdir(directory);
        return await Promise.all(
          names.map(async (name) =>
            Object.freeze({
              kind: await entryKind(resolve(directory, name)),
              name,
            }),
          ),
        );
      } catch (error: unknown) {
        if (error instanceof RealmLoadError) {
          throw error;
        }
        throw new RealmLoadError("IO_ERROR");
      }
    },

    async readFile(segments: readonly string[]): Promise<Uint8Array> {
      const path = containedPath(root, segments);
      try {
        const kind = await entryKind(path);
        if (kind === "symbolic-link") {
          throw new RealmLoadError("SYMLINK_NOT_ALLOWED");
        }
        if (kind !== "file") {
          throw new RealmLoadError("UNSUPPORTED_ENTRY");
        }
        return new Uint8Array(await readFile(path));
      } catch (error: unknown) {
        if (error instanceof RealmLoadError) {
          throw error;
        }
        throw new RealmLoadError("IO_ERROR");
      }
    },
  });
}
