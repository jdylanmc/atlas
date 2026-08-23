#!/usr/bin/env node
/** Atlas command-line interface. */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { exitCodeForInitializeOperationResult, initializeCommandExitCodes, initializeCommandUsage, runInitializeCommandOperation, serializeInitializeMachineResult, usageInitializeOperationResult, } from "../src/interfaces/initialize_command.js";
import { exitCodeForLintOperationResult, lintCommandCaptureBudgets, lintCommandExitCodes, lintCommandUsage, missingAtlasLintOperationResult, runLintCommandOperation, serializeLintMachineResult, unreadableAtlasLintOperationResult, usageLintOperationResult, } from "../src/interfaces/lint_command.js";
class UsageError extends Error {
}
class MissingAtlasError extends Error {
}
class UnreadableAtlasError extends Error {
}
export class CaptureBudgetError extends Error {
    capturedFiles;
    constructor(message, capturedFiles) {
        super(message);
        this.capturedFiles = capturedFiles;
    }
}
function compareNames(left, right) {
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}
function repositoryPath(root, absolutePath) {
    return relative(root, absolutePath).split(sep).join("/");
}
function collectAtlasFiles(root, directory, files, budgets, readFile, totalBytes, depth) {
    if (depth > budgets.maxTraversalDepth) {
        throw new UnreadableAtlasError("Atlas capture exceeded traversal depth.");
    }
    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    }
    catch {
        throw new UnreadableAtlasError("Atlas files could not be listed.");
    }
    for (const entry of entries.toSorted(compareNames)) {
        const path = join(directory, entry.name);
        let stat;
        try {
            stat = lstatSync(path);
        }
        catch {
            throw new UnreadableAtlasError("Atlas files could not be inspected.");
        }
        if (stat.isSymbolicLink()) {
            throw new UnreadableAtlasError("Atlas files could not be captured safely.");
        }
        if (stat.isDirectory()) {
            collectAtlasFiles(root, path, files, budgets, readFile, totalBytes, depth + 1);
            continue;
        }
        if (!stat.isFile())
            continue;
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
            throw new CaptureBudgetError("Captured Atlas files exceed the total byte budget.", [
                ...files,
                {
                    bytes: new Uint8Array(budgets.maxTotalBytes - totalBytes.value + 1),
                    path: relativePath,
                },
            ]);
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
                throw new CaptureBudgetError("Captured Atlas files exceed the total byte budget.", [...files, { bytes, path: relativePath }]);
            }
            totalBytes.value += bytes.byteLength;
            files.push({ bytes, path: relativePath });
        }
        catch (error) {
            if (error instanceof CaptureBudgetError)
                throw error;
            throw new UnreadableAtlasError("Atlas files could not be read.");
        }
    }
}
export function captureAtlasHostDirectory(atlasHostDirectory, budgets, readFile = readFileSync) {
    if (!Number.isSafeInteger(budgets.maxFileBytes) ||
        budgets.maxFileBytes < 0 ||
        !Number.isSafeInteger(budgets.maxTotalBytes) ||
        budgets.maxTotalBytes < 0 ||
        !Number.isSafeInteger(budgets.maxFiles) ||
        budgets.maxFiles < 0 ||
        !Number.isSafeInteger(budgets.maxTraversalDepth) ||
        budgets.maxTraversalDepth < 0) {
        throw new UnreadableAtlasError("Atlas capture budgets are invalid.");
    }
    const root = resolve(atlasHostDirectory);
    const atlasRoot = resolve(root, ".atlas");
    let stat;
    try {
        stat = lstatSync(atlasRoot, { throwIfNoEntry: false });
    }
    catch {
        throw new UnreadableAtlasError("Atlas .atlas directory could not be inspected.");
    }
    if (stat === undefined) {
        throw new MissingAtlasError("Atlas Host Directory does not contain a .atlas directory.");
    }
    if (!stat.isDirectory()) {
        throw new MissingAtlasError("Atlas Host Directory does not contain a .atlas directory.");
    }
    const files = [];
    collectAtlasFiles(root, atlasRoot, files, budgets, readFile, { value: 0 }, 1);
    return files;
}
function resultForCaptureBudgetError(error) {
    const result = runLintCommandOperation(error.capturedFiles);
    process.stdout.write(serializeLintMachineResult(result));
    return exitCodeForLintOperationResult(result);
}
function parseLintCommand(arguments_) {
    let machine = false;
    let atlasHostDirectory = ".";
    let machineSeen = false;
    let atlasHostDirectorySeen = false;
    for (let index = 1; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === "--machine") {
            if (machineSeen)
                throw new UsageError(lintCommandUsage);
            machine = true;
            machineSeen = true;
            continue;
        }
        if (argument === "--atlas-host-directory") {
            if (atlasHostDirectorySeen)
                throw new UsageError(lintCommandUsage);
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
function parseInitializeCommand(arguments_) {
    let machine = false;
    let atlasHostDirectory = ".";
    let resumeProposalBranch;
    let machineSeen = false;
    let atlasHostDirectorySeen = false;
    let resumeProposalBranchSeen = false;
    for (let index = 1; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === "--machine") {
            if (machineSeen)
                throw new UsageError(initializeCommandUsage);
            machine = true;
            machineSeen = true;
            continue;
        }
        if (argument === "--atlas-host-directory") {
            if (atlasHostDirectorySeen)
                throw new UsageError(initializeCommandUsage);
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
            if (resumeProposalBranchSeen)
                throw new UsageError(initializeCommandUsage);
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
    if (!machine)
        throw new UsageError(initializeCommandUsage);
    return {
        atlasHostDirectory,
        machine: true,
        ...(resumeProposalBranch === undefined ? {} : { resumeProposalBranch }),
    };
}
function mainLint(arguments_) {
    let command;
    try {
        command = parseLintCommand(arguments_);
    }
    catch (error) {
        if (!(error instanceof UsageError))
            throw error;
        const result = usageLintOperationResult(error.message);
        process.stdout.write(serializeLintMachineResult(result));
        console.error(error.message);
        return exitCodeForLintOperationResult(result);
    }
    try {
        const result = runLintCommandOperation(captureAtlasHostDirectory(command.atlasHostDirectory, lintCommandCaptureBudgets));
        process.stdout.write(serializeLintMachineResult(result));
        return exitCodeForLintOperationResult(result);
    }
    catch (error) {
        if (error instanceof CaptureBudgetError)
            return resultForCaptureBudgetError(error);
        if (error instanceof MissingAtlasError) {
            const result = missingAtlasLintOperationResult(error.message);
            process.stdout.write(serializeLintMachineResult(result));
            console.error(error.message);
            return exitCodeForLintOperationResult(result);
        }
        if (!(error instanceof UnreadableAtlasError))
            throw error;
        const result = unreadableAtlasLintOperationResult(error.message);
        process.stdout.write(serializeLintMachineResult(result));
        console.error(error.message);
        return lintCommandExitCodes.operationNotCompleted;
    }
}
function mainInitialize(arguments_) {
    let command;
    try {
        command = parseInitializeCommand(arguments_);
    }
    catch (error) {
        if (!(error instanceof UsageError))
            throw error;
        const result = usageInitializeOperationResult(error.message);
        process.stdout.write(serializeInitializeMachineResult(result));
        console.error(error.message);
        return initializeCommandExitCodes.usage;
    }
    const result = runInitializeCommandOperation(command.atlasHostDirectory, command.resumeProposalBranch);
    process.stdout.write(serializeInitializeMachineResult(result));
    return exitCodeForInitializeOperationResult(result);
}
export function main(arguments_) {
    if (arguments_[0] === "lint")
        return mainLint(arguments_);
    if (arguments_[0] === "initialize")
        return mainInitialize(arguments_);
    console.error(lintCommandUsage);
    return lintCommandExitCodes.usage;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    process.exitCode = main(process.argv.slice(2));
}
