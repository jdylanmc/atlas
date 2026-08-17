#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  MAX_REALM_FILE_BYTES,
  MAX_REALM_FILES,
  MAX_REALM_TOTAL_BYTES,
  compareText,
  type OperationResult,
} from "../domain/contracts.ts";
import type { SourceFile } from "../realm/load.ts";
import { failedWeaveResult, weaveRealm } from "../weave/weave.ts";

interface CommandIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function combineRealmDigest(files: readonly SourceFile[]): string {
  const hash = createHash("sha256");
  const ordered = [...files].sort((left, right) => compareText(left.path, right.path));
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(ordered.length));
  hash.update(length);
  for (const file of ordered) {
    const path = Buffer.from(file.path, "utf8");
    length.writeBigUInt64BE(BigInt(path.byteLength));
    hash.update(length);
    hash.update(path);
    length.writeBigUInt64BE(BigInt(file.bytes.byteLength));
    hash.update(length);
    hash.update(file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

export function assertRealmDirectory(directory: string, realAtlasRoot: string): void {
  const realDirectory = realpathSync(directory);
  if (
    (realDirectory !== realAtlasRoot &&
      !realDirectory.startsWith(`${realAtlasRoot}${sep}`)) ||
    !lstatSync(directory).isDirectory()
  ) {
    throw new Error(`Realm directory escaped .atlas: ${directory}`);
  }
}

export function isStableContainedPath(
  before: string,
  after: string,
  realAtlasRoot: string,
): boolean {
  return before === after && after.startsWith(`${realAtlasRoot}${sep}`);
}

interface FileSnapshot {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

export function assertStableFileRead(
  before: FileSnapshot,
  after: FileSnapshot,
  bytesRead: number,
  path: string,
): void {
  if (
    ![
      before.dev === after.dev,
      before.ino === after.ino,
      before.size === after.size,
      before.mtimeMs === after.mtimeMs,
      before.ctimeMs === after.ctimeMs,
      after.size === bytesRead,
    ].every(Boolean)
  ) {
    throw new Error(`Realm file changed while loading: ${path}`);
  }
}

export function readRegularFile(path: string, realAtlasRoot: string): Buffer {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const descriptorStat = fstatSync(descriptor);
    const realPathBefore = realpathSync(path);
    const pathStat = statSync(path);
    const realPathAfter = realpathSync(path);
    if (
      !descriptorStat.isFile() ||
      !isStableContainedPath(realPathBefore, realPathAfter, realAtlasRoot) ||
      descriptorStat.dev !== pathStat.dev ||
      descriptorStat.ino !== pathStat.ino
    ) {
      throw new Error(`Realm path must be a regular file: ${path}`);
    }
    const buffer = Buffer.alloc(MAX_REALM_FILE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.byteLength - bytesRead,
        null,
      );
      if (count === 0) {
        break;
      }
      bytesRead += count;
    }
    if (bytesRead > MAX_REALM_FILE_BYTES) {
      throw new Error(
        `Realm file exceeds ${String(MAX_REALM_FILE_BYTES)} bytes: ${path}`,
      );
    }
    const finalStat = fstatSync(descriptor);
    assertStableFileRead(descriptorStat, finalStat, bytesRead, path);
    return Buffer.from(buffer.subarray(0, bytesRead));
  } finally {
    closeSync(descriptor);
  }
}

export function enforceRealmBudget(fileCount: number, totalBytes: number): void {
  if (fileCount > MAX_REALM_FILES) {
    throw new Error(`Realm exceeds ${String(MAX_REALM_FILES)} files`);
  }
  if (totalBytes > MAX_REALM_TOTAL_BYTES) {
    throw new Error(`Realm exceeds ${String(MAX_REALM_TOTAL_BYTES)} aggregate bytes`);
  }
}

export function readRealmFiles(realmHost: string): readonly SourceFile[] {
  const host = realpathSync(realmHost);
  const atlasRoot = resolve(host, ".atlas");
  const realAtlasRoot = realpathSync(atlasRoot);
  assertRealmDirectory(atlasRoot, atlasRoot);
  const files: SourceFile[] = [];
  let totalBytes = 0;
  let visitedEntries = 0;
  const visit = (directory: string): void => {
    assertRealmDirectory(directory, realAtlasRoot);
    const handle = opendirSync(directory);
    const entries: Dirent[] = [];
    try {
      let entry = handle.readSync();
      while (entry !== null) {
        visitedEntries += 1;
        enforceRealmBudget(visitedEntries, totalBytes);
        entries.push(entry);
        entry = handle.readSync();
      }
    } finally {
      handle.closeSync();
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Realm path must not be a symbolic link: ${path}`);
      }
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        const bytes = readRegularFile(path, realAtlasRoot);
        totalBytes += bytes.byteLength;
        enforceRealmBudget(files.length + 1, totalBytes);
        files.push(
          Object.freeze({
            path: relative(host, path).split(sep).join("/"),
            bytes,
            digest: sha256(bytes),
          }),
        );
      } else {
        throw new Error(`Realm path must be a regular file: ${path}`);
      }
    }
  };
  visit(atlasRoot);
  return Object.freeze(files);
}

export function serializeOperationResult(result: OperationResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function usage(io: CommandIo): number {
  io.stderr("usage: atlas weave --json [--realm PATH]\n");
  return 2;
}

export function main(arguments_: readonly string[], io: CommandIo): number {
  if (arguments_[0] !== "weave" || arguments_[1] !== "--json") {
    return usage(io);
  }
  let realmHost = process.cwd();
  if (arguments_.length !== 2) {
    const value = arguments_[3];
    if (
      arguments_.length !== 4 ||
      arguments_[2] !== "--realm" ||
      value === undefined ||
      value.startsWith("-")
    ) {
      return usage(io);
    }
    realmHost = value;
  }
  let result: OperationResult;
  try {
    result = weaveRealm(readRealmFiles(realmHost), combineRealmDigest);
  } catch {
    result = failedWeaveResult("Realm loading failed.");
  }
  io.stdout(serializeOperationResult(result));
  return result.status === "completed" ? 0 : 1;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exitCode = main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
