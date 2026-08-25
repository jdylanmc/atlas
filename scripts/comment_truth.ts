#!/usr/bin/env node
/** Validate that src/** doc comments name a real test file for every absolute claim. */

import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Finding } from "../src/domain/finding.ts";
import { validateCommentTruth } from "../src/lint/validate_comment_truth.ts";
import { collectContracts, ContractError } from "./vocabulary_agreement.ts";

export const CONTRACT_ROOT = "src";
export const TEST_ROOT = "tests";

function readText(root: string, relativePath: string): string {
  try {
    return readFileSync(`${root}/${relativePath}`, "utf8");
  } catch {
    throw new ContractError(`${relativePath} must be readable text`);
  }
}

/**
 * Every `tests/*.test.ts` file this repository actually ships, so a doc
 * comment naming one is naming a suite that really runs rather than a
 * plausible-looking path no test file backs.
 */
export function collectTestFiles(root: string): ReadonlySet<string> {
  let entries;
  try {
    entries = readdirSync(`${root}/${TEST_ROOT}`, { withFileTypes: true });
  } catch {
    throw new ContractError(`${TEST_ROOT} must be a readable directory`);
  }
  return new Set(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
      .map((entry) => `${TEST_ROOT}/${entry.name}`),
  );
}

export function validateRepository(root: string): readonly Finding[] {
  const testFiles = collectTestFiles(root);
  const files = collectContracts(root, CONTRACT_ROOT).map((path) => ({
    content: readText(root, path),
    path,
  }));
  return validateCommentTruth(files, testFiles);
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
    console.error("usage: comment_truth.ts validate");
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
  console.log("validated comment truth");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
