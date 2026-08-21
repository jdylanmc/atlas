#!/usr/bin/env node
/** Atlas command-line interface. */

import { lstatSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  exitCodeForLintOperationResult,
  lintCommandExitCodes,
  lintCommandUsage,
  missingAtlasLintOperationResult,
  runLintCommandOperation,
  serializeLintMachineResult,
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
): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    throw new UnreadableAtlasError("Atlas files could not be listed.");
  }

  for (const entry of entries.toSorted(compareNames)) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new UnreadableAtlasError("Atlas files could not be captured safely.");
    }
    if (entry.isDirectory()) {
      collectAtlasFiles(root, path, files);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      files.push({ bytes: readFileSync(path), path: repositoryPath(root, path) });
    } catch {
      throw new UnreadableAtlasError("Atlas files could not be read.");
    }
  }
}

function captureAtlasHostDirectory(
  atlasHostDirectory: string,
): readonly LintCommandCapturedFile[] {
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
  collectAtlasFiles(root, atlasRoot, files);
  return files;
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
      captureAtlasHostDirectory(command.atlasHostDirectory),
    );
    process.stdout.write(serializeLintMachineResult(result));
    return exitCodeForLintOperationResult(result);
  } catch (error: unknown) {
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
