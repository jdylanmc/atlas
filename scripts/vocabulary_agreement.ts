#!/usr/bin/env node
/** Validate that CONTEXT.md and Atlas SDK-owned contracts bind one vocabulary. */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  contractVocabularyBindings,
  unboundGlossaryTerms,
} from "../src/domain/contract_vocabulary.ts";
import { coreArchetypes } from "../src/domain/core_archetype.ts";
import type { Finding } from "../src/domain/finding.ts";
import {
  validateVocabularyAgreement,
  type VocabularyTextFile,
} from "../src/lint/validate_vocabulary_agreement.ts";

export const GLOSSARY_PATH = "CONTEXT.md";
export const CONTRACT_ROOT = "src";

/** A contract the validator refuses to read, named by its repository path alone. */
export class ContractError extends Error {}

function readText(root: string, relativePath: string): VocabularyTextFile {
  const path = resolve(root, relativePath);
  let regular: boolean;
  try {
    regular = lstatSync(path, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    throw new ContractError(`${relativePath} must be a readable regular file`);
  }
  if (!regular) throw new ContractError(`${relativePath} must be a regular file`);
  try {
    return { content: readFileSync(path, "utf8"), path: relativePath };
  } catch {
    throw new ContractError(`${relativePath} must be readable text`);
  }
}

/**
 * Collects every Atlas SDK-authored contract source in stable path order. The
 * root component is `lstat`-checked and refused unless it is a real directory,
 * so a symlinked `src` root is rejected; every discovered child symbolic link
 * is excluded because its `Dirent` is neither a directory nor a regular file,
 * so the walk never leaves the repository through any component. Pinned by
 * `tests/vocabulary_agreement.test.ts`.
 */
export function collectContracts(root: string, relativePath: string): string[] {
  const path = resolve(root, relativePath);
  let directory: boolean;
  try {
    directory = lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    throw new ContractError(`${relativePath} must be a readable directory`);
  }
  if (!directory)
    throw new ContractError(`${relativePath} must be a readable directory`);
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    throw new ContractError(`${relativePath} must be a readable directory`);
  }
  const paths: string[] = [];
  for (const entry of entries.toSorted((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const entryPath = join(relativePath, entry.name);
    if (entry.isDirectory()) paths.push(...collectContracts(root, entryPath));
    else if (entry.isFile() && entry.name.endsWith(".ts")) paths.push(entryPath);
  }
  return paths;
}

/**
 * Validates the repository rooted at `root` against the Vocabulary Binding of
 * the running Atlas SDK, which is the binding those contracts are written for.
 */
export function validateRepository(root: string): readonly Finding[] {
  return validateVocabularyAgreement(
    coreArchetypes,
    contractVocabularyBindings,
    unboundGlossaryTerms,
    readText(root, GLOSSARY_PATH),
    collectContracts(root, CONTRACT_ROOT).map((path) => readText(root, path)),
  );
}

export function formatFinding(finding: Finding): string {
  const position =
    finding.location === undefined
      ? ""
      : `:${String(finding.location.start.line)}:${String(finding.location.start.column)}`;
  return `${finding.path}${position}: ${finding.code} ${finding.message}`;
}

export function main(arguments_: readonly string[]): number {
  if (arguments_.length !== 1 || arguments_[0] !== "validate") {
    console.error("usage: vocabulary_agreement.ts validate");
    return 2;
  }
  let findings: readonly Finding[];
  try {
    findings = validateRepository(process.cwd());
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    console.error(`error: ${error.message}`);
    return 1;
  }
  for (const finding of findings) console.error(`error: ${formatFinding(finding)}`);
  if (findings.length > 0) return 1;
  console.log("validated glossary and contract vocabulary agreement");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
