#!/usr/bin/env node
/** Atlas command-line interface. */

import { lstatSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  exitCodeForInitializeOperationResult,
  initializeCommandExitCodes,
  initializeCommandUsage,
  runInitializeCommandOperation,
  serializeInitializeMachineResult,
  usageInitializeOperationResult,
} from "../src/interfaces/initialize_command.ts";
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
import {
  exitCodeForExploreOperationResult,
  exploreCommandBudgets,
  exploreCommandExitCodes,
  exploreCommandUsage,
  oversizedQueryExploreOperationResult,
  serializeExploreMachineResult,
  usageExploreOperationResult,
} from "../src/interfaces/explore_command.ts";
import {
  correspondenceRefusalResult,
  exitCodeForIngestOperationResult,
  exitCodeForIngestPlanOutcome,
  ingestCommandExitCodes,
  ingestCommandInputBudgets,
  ingestCommandUsage,
  ingestPlanCommandUsage,
  ingestReconcileCommandUsage,
  invalidInputIngestOperationResult,
  parseIngestRequest,
  oversizedInputIngestOperationResult,
  parseIngestScope,
  planCrawlAssignment,
  serializeCrawlAssignmentMachineResult,
  serializeIngestMachineResult,
  usageIngestOperationResult,
  validateRequestCorrespondence,
} from "../src/interfaces/ingest_command.ts";
import { runLocalAtlasIngest } from "../src/platform/local_atlas_ingest.ts";
import { runLocalAtlasExplore } from "../src/platform/local_atlas_explore.ts";

interface ParsedLintCommand {
  readonly atlasHostDirectory: string;
  readonly machine: true;
}

interface ParsedInitializeCommand {
  readonly atlasHostDirectory: string;
  readonly machine: true;
  readonly resumeProposalBranch?: string;
}

interface ParsedExploreCommand {
  readonly atlasHostDirectory: string;
  readonly machine: true;
  readonly query: string;
}

interface ParsedIngestPlanCommand {
  readonly ingestScopePath: string;
  readonly machine: true;
  readonly subcommand: "plan";
}

interface ParsedIngestReconcileCommand {
  readonly atlasHostDirectory: string;
  readonly ingestRequestPath: string;
  readonly machine: true;
  readonly subcommand: "reconcile";
}

type ParsedIngestCommand = ParsedIngestPlanCommand | ParsedIngestReconcileCommand;

class UsageError extends Error {}
class MissingAtlasError extends Error {}
class UnreadableAtlasError extends Error {}
class IngestInputBudgetError extends Error {}
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

function parseInitializeCommand(
  arguments_: readonly string[],
): ParsedInitializeCommand {
  let machine = false;
  let atlasHostDirectory = ".";
  let resumeProposalBranch: string | undefined;
  let machineSeen = false;
  let atlasHostDirectorySeen = false;
  let resumeProposalBranchSeen = false;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--machine") {
      if (machineSeen) throw new UsageError(initializeCommandUsage);
      machine = true;
      machineSeen = true;
      continue;
    }
    if (argument === "--atlas-host-directory") {
      if (atlasHostDirectorySeen) throw new UsageError(initializeCommandUsage);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(initializeCommandUsage);
      }
      atlasHostDirectory = value;
      atlasHostDirectorySeen = true;
      index += 1;
      continue;
    }
    if (argument === "--resume-proposal-branch") {
      if (resumeProposalBranchSeen) throw new UsageError(initializeCommandUsage);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(initializeCommandUsage);
      }
      resumeProposalBranch = value;
      resumeProposalBranchSeen = true;
      index += 1;
      continue;
    }
    throw new UsageError(initializeCommandUsage);
  }
  if (!machine) throw new UsageError(initializeCommandUsage);
  return {
    atlasHostDirectory,
    machine: true,
    ...(resumeProposalBranch === undefined ? {} : { resumeProposalBranch }),
  };
}

function mainLint(arguments_: readonly string[]): number {
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

function mainInitialize(arguments_: readonly string[]): number {
  let command: ParsedInitializeCommand;
  try {
    command = parseInitializeCommand(arguments_);
  } catch (error: unknown) {
    if (!(error instanceof UsageError)) throw error;
    const result = usageInitializeOperationResult(error.message);
    process.stdout.write(serializeInitializeMachineResult(result));
    console.error(error.message);
    return initializeCommandExitCodes.usage;
  }
  const result = runInitializeCommandOperation(
    command.atlasHostDirectory,
    command.resumeProposalBranch,
  );
  process.stdout.write(serializeInitializeMachineResult(result));
  return exitCodeForInitializeOperationResult(result);
}

function parseExploreCommand(arguments_: readonly string[]): ParsedExploreCommand {
  let machine = false;
  let atlasHostDirectory = ".";
  let query: string | undefined;
  let machineSeen = false;
  let atlasHostDirectorySeen = false;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) throw new UsageError(exploreCommandUsage);
    if (argument === "--machine") {
      if (machineSeen) throw new UsageError(exploreCommandUsage);
      machine = true;
      machineSeen = true;
      continue;
    }
    if (argument === "--atlas-host-directory") {
      if (atlasHostDirectorySeen) throw new UsageError(exploreCommandUsage);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(exploreCommandUsage);
      }
      atlasHostDirectory = value;
      atlasHostDirectorySeen = true;
      index += 1;
      continue;
    }
    if (argument.startsWith("--") || query !== undefined) {
      throw new UsageError(exploreCommandUsage);
    }
    query = argument;
  }
  if (!machine || query === undefined || query.trim() === "") {
    throw new UsageError(exploreCommandUsage);
  }
  return { atlasHostDirectory, machine: true, query };
}

function mainExplore(arguments_: readonly string[]): number {
  let command: ParsedExploreCommand;
  try {
    command = parseExploreCommand(arguments_);
  } catch (error: unknown) {
    if (!(error instanceof UsageError)) throw error;
    const result = usageExploreOperationResult(error.message);
    process.stdout.write(serializeExploreMachineResult(result));
    console.error(error.message);
    return exploreCommandExitCodes.usage;
  }
  if (command.query.length > exploreCommandBudgets.maxQueryCharacters) {
    const result = oversizedQueryExploreOperationResult(
      "Explore query exceeds the declared character budget.",
    );
    process.stdout.write(serializeExploreMachineResult(result));
    return exitCodeForExploreOperationResult(result);
  }
  const result = runLocalAtlasExplore(
    command.atlasHostDirectory,
    command.query,
    exploreCommandBudgets,
  );
  process.stdout.write(serializeExploreMachineResult(result));
  return exitCodeForExploreOperationResult(result);
}

function parseIngestCommand(arguments_: readonly string[]): ParsedIngestCommand {
  const subcommand = arguments_[1];
  if (subcommand === "plan") return parseIngestPlanCommand(arguments_);
  if (subcommand === "reconcile") return parseIngestReconcileCommand(arguments_);
  throw new UsageError(ingestCommandUsage);
}

function parseIngestPlanCommand(
  arguments_: readonly string[],
): ParsedIngestPlanCommand {
  let machine = false;
  let ingestScopePath: string | undefined;
  let machineSeen = false;
  let ingestScopeSeen = false;
  for (let index = 2; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--machine") {
      if (machineSeen) throw new UsageError(ingestPlanCommandUsage);
      machine = true;
      machineSeen = true;
      continue;
    }
    if (argument === "--ingest-scope") {
      if (ingestScopeSeen) throw new UsageError(ingestPlanCommandUsage);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(ingestPlanCommandUsage);
      }
      ingestScopePath = value;
      ingestScopeSeen = true;
      index += 1;
      continue;
    }
    throw new UsageError(ingestPlanCommandUsage);
  }
  if (!machine || ingestScopePath === undefined) {
    throw new UsageError(ingestPlanCommandUsage);
  }
  return { ingestScopePath, machine: true, subcommand: "plan" };
}

function parseIngestReconcileCommand(
  arguments_: readonly string[],
): ParsedIngestReconcileCommand {
  let machine = false;
  let ingestRequestPath: string | undefined;
  let atlasHostDirectory = ".";
  let machineSeen = false;
  let ingestRequestSeen = false;
  let atlasHostDirectorySeen = false;
  for (let index = 2; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--machine") {
      if (machineSeen) throw new UsageError(ingestReconcileCommandUsage);
      machine = true;
      machineSeen = true;
      continue;
    }
    if (argument === "--ingest-request") {
      if (ingestRequestSeen) throw new UsageError(ingestReconcileCommandUsage);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(ingestReconcileCommandUsage);
      }
      ingestRequestPath = value;
      ingestRequestSeen = true;
      index += 1;
      continue;
    }
    if (argument === "--atlas-host-directory") {
      if (atlasHostDirectorySeen) throw new UsageError(ingestReconcileCommandUsage);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(ingestReconcileCommandUsage);
      }
      atlasHostDirectory = value;
      atlasHostDirectorySeen = true;
      index += 1;
      continue;
    }
    throw new UsageError(ingestReconcileCommandUsage);
  }
  if (!machine || ingestRequestPath === undefined) {
    throw new UsageError(ingestReconcileCommandUsage);
  }
  return {
    atlasHostDirectory,
    ingestRequestPath,
    machine: true,
    subcommand: "reconcile",
  };
}

function readJsonFile(path: string, maxFileBytes?: number): unknown {
  const absolutePath = resolve(path);
  if (maxFileBytes !== undefined) {
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > maxFileBytes) {
      throw new IngestInputBudgetError(
        `Ingest input exceeds the ${String(maxFileBytes)} byte budget.`,
      );
    }
    const bytes = readFileSync(absolutePath);
    if (bytes.byteLength > maxFileBytes) {
      throw new IngestInputBudgetError(
        `Ingest input exceeds the ${String(maxFileBytes)} byte budget.`,
      );
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  }
  return JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
}

function mainIngestPlan(command: ParsedIngestPlanCommand): number {
  let input: unknown;
  try {
    input = readJsonFile(
      command.ingestScopePath,
      ingestCommandInputBudgets.maxFileBytes,
    );
  } catch (error: unknown) {
    const result =
      error instanceof IngestInputBudgetError
        ? oversizedInputIngestOperationResult(error.message)
        : invalidInputIngestOperationResult(
            "The Ingest Scope file could not be read as JSON.",
          );
    process.stdout.write(serializeIngestMachineResult(result));
    return exitCodeForIngestOperationResult(result);
  }
  const parsed = parseIngestScope(input);
  if (!parsed.ok) {
    process.stdout.write(serializeIngestMachineResult(parsed.result));
    return exitCodeForIngestOperationResult(parsed.result);
  }
  const outcome = planCrawlAssignment(parsed.value);
  if (outcome.state === "refused") {
    process.stdout.write(serializeIngestMachineResult(outcome.result));
    return exitCodeForIngestPlanOutcome(outcome);
  }
  process.stdout.write(serializeCrawlAssignmentMachineResult(outcome.assignment));
  return exitCodeForIngestPlanOutcome(outcome);
}

function mainIngestReconcile(command: ParsedIngestReconcileCommand): number {
  let input: unknown;
  try {
    input = readJsonFile(
      command.ingestRequestPath,
      ingestCommandInputBudgets.maxFileBytes,
    );
  } catch (error: unknown) {
    const result =
      error instanceof IngestInputBudgetError
        ? oversizedInputIngestOperationResult(error.message)
        : invalidInputIngestOperationResult(
            "The Ingest request file could not be read as JSON.",
          );
    process.stdout.write(serializeIngestMachineResult(result));
    return exitCodeForIngestOperationResult(result);
  }
  const parsed = parseIngestRequest(input);
  if (!parsed.ok) {
    process.stdout.write(serializeIngestMachineResult(parsed.result));
    return exitCodeForIngestOperationResult(parsed.result);
  }
  const correspondence = validateRequestCorrespondence(parsed.value);
  if (correspondence.length > 0) {
    const result = correspondenceRefusalResult(correspondence);
    process.stdout.write(serializeIngestMachineResult(result));
    return exitCodeForIngestOperationResult(result);
  }
  const result = runLocalAtlasIngest(command.atlasHostDirectory, parsed.value);
  process.stdout.write(serializeIngestMachineResult(result));
  return exitCodeForIngestOperationResult(result);
}

function mainIngest(arguments_: readonly string[]): number {
  let command: ParsedIngestCommand;
  try {
    command = parseIngestCommand(arguments_);
  } catch (error: unknown) {
    if (!(error instanceof UsageError)) throw error;
    const result = usageIngestOperationResult(error.message);
    process.stdout.write(serializeIngestMachineResult(result));
    console.error(error.message);
    return ingestCommandExitCodes.usage;
  }
  return command.subcommand === "plan"
    ? mainIngestPlan(command)
    : mainIngestReconcile(command);
}

export function main(arguments_: readonly string[]): number {
  if (arguments_[0] === "lint") return mainLint(arguments_);
  if (arguments_[0] === "initialize") return mainInitialize(arguments_);
  if (arguments_[0] === "explore") return mainExplore(arguments_);
  if (arguments_[0] === "ingest") return mainIngest(arguments_);
  console.error(lintCommandUsage);
  return lintCommandExitCodes.usage;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
