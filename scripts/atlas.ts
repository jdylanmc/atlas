#!/usr/bin/env node
/** Atlas command-line interface. */

import { lstatSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  exitCodeForLintOperationResult,
  lintCommandCaptureBudgets,
  lintCommandExitCodes,
  lintCommandUsage,
  missingAtlasLintOperationResult,
  runLintCommandOperation,
  serializeLintMachineResult,
  type LintCommandCaptureBudgets,
  type LintCommandCapturedFile,
  unreadableAtlasLintOperationResult,
  usageLintOperationResult,
} from "../src/interfaces/lint_command.ts";

interface ParsedLintCommand {
  readonly atlasHostDirectory: string;
  readonly machine: true;
}

class UsageError extends Error {}
class MissingAtlasError extends Error {}
class UnreadableAtlasError extends Error {}
export class CaptureBudgetError extends Error {
  readonly capturedFiles: readonly LintCommandCapturedFile[];

  constructor(message: string, capturedFiles: readonly LintCommandCapturedFile[]) {
    super(message);
    this.capturedFiles = capturedFiles;
  }
}

type ReadFile = (path: string) => Uint8Array;

function compareNames(left: Dirent, right: Dirent): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function repositoryPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function collectAtlasFiles(
  root: string,
  directory: string,
  files: LintCommandCapturedFile[],
  budgets: LintCommandCaptureBudgets,
  readFile: ReadFile,
  totalBytes: { value: number },
  depth: number,
): void {
  if (depth > budgets.maxTraversalDepth) {
    throw new UnreadableAtlasError("Atlas capture exceeded traversal depth.");
  }
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    throw new UnreadableAtlasError("Atlas files could not be listed.");
  }

  for (const entry of entries.toSorted(compareNames)) {
    const path = join(directory, entry.name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      throw new UnreadableAtlasError("Atlas files could not be inspected.");
    }
    if (stat.isSymbolicLink()) {
      throw new UnreadableAtlasError("Atlas files could not be captured safely.");
    }
    if (stat.isDirectory()) {
      collectAtlasFiles(root, path, files, budgets, readFile, totalBytes, depth + 1);
      continue;
    }
    if (!stat.isFile()) continue;
    if (files.length >= budgets.maxFiles) {
      throw new UnreadableAtlasError("Atlas capture exceeded file count.");
    }
    const relativePath = repositoryPath(root, path);
    if (stat.size > budgets.maxFileBytes) {
      throw new CaptureBudgetError("A captured Atlas file exceeds the byte budget.", [
        ...files,
        { bytes: new Uint8Array(budgets.maxFileBytes + 1), path: relativePath },
      ]);
    }
    if (totalBytes.value + stat.size > budgets.maxTotalBytes) {
      throw new CaptureBudgetError(
        "Captured Atlas files exceed the total byte budget.",
        [
          ...files,
          {
            bytes: new Uint8Array(budgets.maxTotalBytes - totalBytes.value + 1),
            path: relativePath,
          },
        ],
      );
    }
    try {
      const bytes = readFile(path);
      if (bytes.byteLength > budgets.maxFileBytes) {
        throw new CaptureBudgetError("A captured Atlas file exceeds the byte budget.", [
          ...files,
          { bytes, path: relativePath },
        ]);
      }
      if (totalBytes.value + bytes.byteLength > budgets.maxTotalBytes) {
        throw new CaptureBudgetError(
          "Captured Atlas files exceed the total byte budget.",
          [...files, { bytes, path: relativePath }],
        );
      }
      totalBytes.value += bytes.byteLength;
      files.push({ bytes, path: relativePath });
    } catch (error: unknown) {
      if (error instanceof CaptureBudgetError) throw error;
      throw new UnreadableAtlasError("Atlas files could not be read.");
    }
  }
}

export function captureAtlasHostDirectory(
  atlasHostDirectory: string,
  budgets: LintCommandCaptureBudgets,
  readFile: ReadFile = readFileSync,
): readonly LintCommandCapturedFile[] {
  if (
    !Number.isSafeInteger(budgets.maxFileBytes) ||
    budgets.maxFileBytes < 0 ||
    !Number.isSafeInteger(budgets.maxTotalBytes) ||
    budgets.maxTotalBytes < 0 ||
    !Number.isSafeInteger(budgets.maxFiles) ||
    budgets.maxFiles < 0 ||
    !Number.isSafeInteger(budgets.maxTraversalDepth) ||
    budgets.maxTraversalDepth < 0
  ) {
    throw new UnreadableAtlasError("Atlas capture budgets are invalid.");
  }
  const root = resolve(atlasHostDirectory);
  const atlasRoot = resolve(root, ".atlas");
  let stat;
  try {
    stat = lstatSync(atlasRoot, { throwIfNoEntry: false });
  } catch {
    throw new UnreadableAtlasError("Atlas .atlas directory could not be inspected.");
  }
  if (stat === undefined) {
    throw new MissingAtlasError(
      "Atlas Host Directory does not contain a .atlas directory.",
    );
  }
  if (!stat.isDirectory()) {
    throw new MissingAtlasError(
      "Atlas Host Directory does not contain a .atlas directory.",
    );
  }
  const files: LintCommandCapturedFile[] = [];
  collectAtlasFiles(root, atlasRoot, files, budgets, readFile, { value: 0 }, 1);
  return files;
}

function resultForCaptureBudgetError(error: CaptureBudgetError): number {
  const result = runLintCommandOperation(error.capturedFiles);
  process.stdout.write(serializeLintMachineResult(result));
  return exitCodeForLintOperationResult(result);
}

function parseLintCommand(arguments_: readonly string[]): ParsedLintCommand {
  if (arguments_[0] !== "lint") {
    throw new UsageError(lintCommandUsage);
  }

  let machine = false;
  let atlasHostDirectory = ".";
  let machineSeen = false;
  let atlasHostDirectorySeen = false;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--machine") {
      if (machineSeen) throw new UsageError(lintCommandUsage);
      machine = true;
      machineSeen = true;
      continue;
    }
    if (argument === "--atlas-host-directory") {
      if (atlasHostDirectorySeen) throw new UsageError(lintCommandUsage);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(lintCommandUsage);
      }
      atlasHostDirectory = value;
      atlasHostDirectorySeen = true;
      index += 1;
      continue;
    }
    throw new UsageError(lintCommandUsage);
  }

  if (!machine) {
    throw new UsageError(lintCommandUsage);
  }
  return { atlasHostDirectory, machine: true };
}

export function main(arguments_: readonly string[]): number {
  let command: ParsedLintCommand;
  try {
    command = parseLintCommand(arguments_);
  } catch (error: unknown) {
    if (!(error instanceof UsageError)) throw error;
    const result = usageLintOperationResult(error.message);
    process.stdout.write(serializeLintMachineResult(result));
    console.error(error.message);
    return exitCodeForLintOperationResult(result);
  }

  try {
    const result = runLintCommandOperation(
      captureAtlasHostDirectory(command.atlasHostDirectory, lintCommandCaptureBudgets),
    );
    process.stdout.write(serializeLintMachineResult(result));
    return exitCodeForLintOperationResult(result);
  } catch (error: unknown) {
    if (error instanceof CaptureBudgetError) return resultForCaptureBudgetError(error);
    if (error instanceof MissingAtlasError) {
      const result = missingAtlasLintOperationResult(error.message);
      process.stdout.write(serializeLintMachineResult(result));
      console.error(error.message);
      return exitCodeForLintOperationResult(result);
    }
    if (!(error instanceof UnreadableAtlasError)) throw error;
    const result = unreadableAtlasLintOperationResult(error.message);
    process.stdout.write(serializeLintMachineResult(result));
    console.error(error.message);
    return lintCommandExitCodes.operationNotCompleted;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
