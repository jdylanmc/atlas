#!/usr/bin/env node
/** Validate that CONTEXT.md and Atlas SDK-owned contracts bind one vocabulary. */

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile()) {
    throw new ContractError(`${relativePath} must be a regular file`);
  }
  return { content: readFileSync(path, "utf8"), path: relativePath };
}

/**
 * Collects every Atlas SDK-authored contract source in stable path order. A
 * symbolic link is neither a directory nor a regular file entry here, so the
 * walk never leaves the repository.
 */
export function collectContracts(root: string, relativePath: string): string[] {
  const entries = readdirSync(resolve(root, relativePath), { withFileTypes: true });
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

export function validateRepository(root: string): readonly Finding[] {
  return validateVocabularyAgreement(
    coreArchetypes,
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
  const [command, ...options] = arguments_;
  let root = process.cwd();
  if (command !== "validate" || (options.length > 0 && options.length !== 2)) {
    console.error("usage: vocabulary_agreement.ts validate [--root PATH]");
    return 2;
  }
  if (options.length === 2) {
    if (options[0] !== "--root" || !options[1]) {
      console.error("usage: vocabulary_agreement.ts validate [--root PATH]");
      return 2;
    }
    root = options[1];
  }
  let findings: readonly Finding[];
  try {
    findings = validateRepository(root);
  } catch (error) {
    console.error(
      `error: ${
        error instanceof ContractError
          ? error.message
          : `${CONTRACT_ROOT} must be a readable directory`
      }`,
    );
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
