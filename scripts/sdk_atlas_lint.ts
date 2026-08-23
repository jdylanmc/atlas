#!/usr/bin/env node
/** Validate the committed SDK Atlas with the Lint machine contract. */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AtlasLoadError,
  normalizeAtlasTextPath,
  type AtlasTextFile,
} from "../src/atlas/load_atlas_text.ts";
import { classifyAtlasTextPath } from "../src/atlas/parse_atlas_pages.ts";
import { checkFinding, type Finding } from "../src/domain/finding.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
} from "../src/operations/operation_result.ts";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const ATLAS_COMMAND = "scripts/atlas.ts";
const SUCCESS_EXIT_CODE = 0;

interface OperationIdentityShape {
  readonly kind: "lint";
  readonly subject: "atlas-host-directory" | "captured-home-atlas";
}

interface HandoffResultShape {
  readonly disposition: "success" | "failed";
  readonly summary: string;
}

interface LintPayload {
  readonly findings: readonly Finding[];
  readonly opaque?: readonly AtlasTextFile[];
  readonly outcome: "valid" | "invalid";
  readonly pages?: readonly AtlasTextFile[];
}

export interface CompletedLintOperationResult {
  readonly completion: "completed";
  readonly disposition: "success" | "failed";
  readonly handoff: {
    readonly "operation-handoff-schema": typeof operationHandoffSchemaVersion;
    readonly operation: OperationIdentityShape;
    readonly result: HandoffResultShape;
    readonly validationState: {
      readonly findings: readonly Finding[];
      readonly state: "passed" | "failed" | "not-completed";
    };
  };
  readonly operation: OperationIdentityShape;
  readonly payload: {
    readonly lint: LintPayload;
    readonly state: "completed";
  };
  readonly "operation-result-schema": typeof operationResultSchemaVersion;
}

export interface NotCompletedLintOperationResult {
  readonly completion: "not-completed";
  readonly disposition: "failed";
  readonly handoff: {
    readonly "operation-handoff-schema": typeof operationHandoffSchemaVersion;
    readonly operation: OperationIdentityShape;
    readonly result: HandoffResultShape;
    readonly validationState: {
      readonly findings: readonly Finding[];
      readonly state: "not-completed";
    };
  };
  readonly operation: OperationIdentityShape;
  readonly payload: {
    readonly findings: readonly Finding[];
    readonly state: "not-completed";
  };
  readonly "operation-result-schema": typeof operationResultSchemaVersion;
}

export type LintOperationMachineResult =
  CompletedLintOperationResult | NotCompletedLintOperationResult;

export interface LintMachineRun {
  readonly error?: Error;
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

export type RunLintMachine = (atlasHostDirectory: string) => LintMachineRun;

export interface SdkAtlasLintGateResult {
  readonly exitCode: number;
  readonly stderr: readonly string[];
  readonly stdout: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMachineResult(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Lint did not print a JSON Operation Result.");
  }
}

function readFindings(value: unknown, field: string): readonly Finding[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of Findings.`);
  }
  const findings: Finding[] = [];
  for (const finding of value as readonly unknown[]) {
    if (!checkFinding(finding)) {
      throw new Error(`${field} contains a malformed Finding.`);
    }
    findings.push(finding);
  }
  return findings;
}

function readOperationIdentity(value: unknown, field: string): OperationIdentityShape {
  if (!isRecord(value)) throw new Error(`${field} must be an operation identity.`);
  if (value["kind"] !== "lint") {
    throw new Error(`${field}.kind must be lint.`);
  }
  if (
    value["subject"] !== "atlas-host-directory" &&
    value["subject"] !== "captured-home-atlas"
  ) {
    throw new Error(`${field}.subject is not recognized.`);
  }
  return value as unknown as OperationIdentityShape;
}

function readHandoffResult(value: unknown, field: string): HandoffResultShape {
  if (!isRecord(value)) throw new Error(`${field} must be a handoff result.`);
  if (value["disposition"] !== "success" && value["disposition"] !== "failed") {
    throw new Error(`${field}.disposition must be success or failed.`);
  }
  if (typeof value["summary"] !== "string" || value["summary"].length === 0) {
    throw new Error(`${field}.summary must be a non-empty string.`);
  }
  return value as unknown as HandoffResultShape;
}

function readAtlasTextFiles(
  value: unknown,
  field: string,
  expectedClassification: "opaque" | "page",
): readonly AtlasTextFile[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of Atlas text files.`);
  }
  const files: AtlasTextFile[] = [];
  for (const file of value as readonly unknown[]) {
    if (!isRecord(file)) {
      throw new Error(`${field} contains a malformed Atlas text file.`);
    }
    if (typeof file["content"] !== "string" || typeof file["path"] !== "string") {
      throw new Error(`${field} contains a malformed Atlas text file.`);
    }
    const keys = Object.keys(file).toSorted();
    if (keys.length !== 2 || keys[0] !== "content" || keys[1] !== "path") {
      throw new Error(`${field} contains a malformed Atlas text file.`);
    }
    let normalizedPath: string;
    try {
      normalizedPath = normalizeAtlasTextPath(file["path"]);
    } catch (error: unknown) {
      if (error instanceof AtlasLoadError && error.code === "INVALID_PATH") {
        throw new Error(
          `${field} contains invalid Atlas path: ${JSON.stringify(file["path"])}.`,
          { cause: error },
        );
      }
      throw error;
    }
    if (normalizedPath !== file["path"]) {
      throw new Error(
        `${field} contains non-canonical Atlas path: ${JSON.stringify(file["path"])} normalized to ${JSON.stringify(normalizedPath)}.`,
      );
    }
    if (classifyAtlasTextPath(normalizedPath) !== expectedClassification) {
      throw new Error(
        `${field} contains ${expectedClassification === "page" ? "an opaque" : "a page"} Atlas path: ${JSON.stringify(normalizedPath)}.`,
      );
    }
    files.push(file as unknown as AtlasTextFile);
  }
  return files;
}

function validateDistinctAtlasTextPaths(
  pages: readonly AtlasTextFile[],
  opaque: readonly AtlasTextFile[],
): void {
  const seen = new Set<string>();
  for (const file of [...pages, ...opaque]) {
    if (seen.has(file.path)) {
      throw new Error(
        `Valid Atlas Lint Result contains duplicate Atlas path: ${JSON.stringify(file.path)}.`,
      );
    }
    seen.add(file.path);
  }
}

export function readLintOperationResult(value: unknown): LintOperationMachineResult {
  if (!isRecord(value)) throw new Error("Lint result must be an object.");
  if (value["operation-result-schema"] !== operationResultSchemaVersion) {
    throw new Error("Lint result must use Operation Result schema 1.0.0.");
  }
  if (value["completion"] !== "completed" && value["completion"] !== "not-completed") {
    throw new Error("Lint result completion is not recognized.");
  }
  if (value["disposition"] !== "success" && value["disposition"] !== "failed") {
    throw new Error("Lint result must carry a success or failed disposition.");
  }

  const operation = readOperationIdentity(value["operation"], "operation");
  const handoff = value["handoff"];
  const payload = value["payload"];
  if (!isRecord(handoff)) throw new Error("Lint result must carry a handoff.");
  if (!isRecord(payload)) throw new Error("Lint result must carry a payload.");
  if (handoff["operation-handoff-schema"] !== operationHandoffSchemaVersion) {
    throw new Error("Lint handoff must use Operation Handoff schema 1.0.0.");
  }
  const handoffOperation = readOperationIdentity(
    handoff["operation"],
    "handoff.operation",
  );
  if (handoffOperation.subject !== operation.subject) {
    throw new Error("Lint handoff operation must match the Operation Result.");
  }
  const handoffResult = readHandoffResult(handoff["result"], "handoff.result");
  if (handoffResult.disposition !== value["disposition"]) {
    throw new Error("Lint handoff result disposition must match the Operation Result.");
  }

  const validationState = handoff["validationState"];
  if (!isRecord(validationState)) {
    throw new Error("Lint handoff must carry a validation state.");
  }

  if (value["completion"] === "not-completed") {
    if (value["disposition"] !== "failed") {
      throw new Error("A not-completed Lint result must fail.");
    }
    if (payload["state"] !== "not-completed") {
      throw new Error("A not-completed Lint payload must report state not-completed.");
    }
    if (validationState["state"] !== "not-completed") {
      throw new Error(
        "A not-completed Lint validation state must report not-completed.",
      );
    }
    const handoffFindings = readFindings(
      validationState["findings"],
      "handoff.validationState.findings",
    );
    const payloadFindings = readFindings(payload["findings"], "payload.findings");
    if (JSON.stringify(handoffFindings) !== JSON.stringify(payloadFindings)) {
      throw new Error("Lint handoff Findings must match payload Findings.");
    }
    return value as unknown as NotCompletedLintOperationResult;
  }

  if (operation.subject !== "captured-home-atlas") {
    throw new Error("Completed Lint operation subject must be captured-home-atlas.");
  }
  if (payload["state"] !== "completed") {
    throw new Error("Completed Lint payload must report state completed.");
  }
  const lint = payload["lint"];
  if (!isRecord(lint)) throw new Error("Lint payload must carry an Atlas Lint Result.");
  if (
    validationState["state"] !== "passed" &&
    validationState["state"] !== "failed" &&
    validationState["state"] !== "not-completed"
  ) {
    throw new Error("Lint validation state is not recognized.");
  }
  if (lint["outcome"] !== "valid" && lint["outcome"] !== "invalid") {
    throw new Error("Lint payload must report a valid or invalid Atlas Lint Result.");
  }

  const handoffFindings = readFindings(
    validationState["findings"],
    "handoff.validationState.findings",
  );
  const lintFindings = readFindings(lint["findings"], "payload.lint.findings");
  if (JSON.stringify(handoffFindings) !== JSON.stringify(lintFindings)) {
    throw new Error("Lint handoff Findings must match payload Lint Findings.");
  }
  if (lint["outcome"] === "valid") {
    const pages = readAtlasTextFiles(lint["pages"], "payload.lint.pages", "page");
    const opaque = readAtlasTextFiles(lint["opaque"], "payload.lint.opaque", "opaque");
    validateDistinctAtlasTextPaths(pages, opaque);
  }
  return value as unknown as CompletedLintOperationResult;
}

export function formatFinding(finding: Finding): string {
  const position =
    finding.location === undefined
      ? ""
      : `:${String(finding.location.start.line)}:${String(finding.location.start.column)}`;
  return `${finding.severity}: ${finding.path}${position}: ${finding.code} ${finding.message}`;
}

export function resultFindings(result: LintOperationMachineResult): readonly Finding[] {
  if (result.completion === "not-completed") {
    return [...result.payload.findings, ...result.handoff.validationState.findings];
  }
  return [...result.payload.lint.findings, ...result.handoff.validationState.findings];
}

export function errorFindings(result: LintOperationMachineResult): readonly Finding[] {
  const seen = new Set<string>();
  return resultFindings(result).filter((finding) => {
    if (finding.severity !== "error") return false;
    const key = JSON.stringify(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runAtlasLintMachine(atlasHostDirectory: string): LintMachineRun {
  const lint = spawnSync(
    process.execPath,
    [ATLAS_COMMAND, "lint", "--machine", "--atlas-host-directory", atlasHostDirectory],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return lint.error === undefined
    ? {
        status: lint.status,
        stderr: lint.stderr,
        stdout: lint.stdout,
      }
    : {
        error: lint.error,
        status: lint.status,
        stderr: lint.stderr,
        stdout: lint.stdout,
      };
}

export function runSdkAtlasLintGate(
  atlasHostDirectory: string,
  runLintMachine: RunLintMachine = runAtlasLintMachine,
): SdkAtlasLintGateResult {
  const lint = runLintMachine(atlasHostDirectory);
  if (lint.error !== undefined) {
    return {
      exitCode: 1,
      stderr: [`error: SDK Atlas Lint could not start: ${lint.error.message}`],
      stdout: [],
    };
  }

  let result: LintOperationMachineResult;
  try {
    result = readLintOperationResult(parseMachineResult(lint.stdout.trim()));
  } catch (error) {
    const stderr = [
      `error: SDK Atlas Lint produced an invalid machine result: ${(error as Error).message}`,
    ];
    if (lint.stderr.trim()) stderr.push(lint.stderr.trim());
    return { exitCode: 1, stderr, stdout: [] };
  }

  const errors = errorFindings(result);
  if (result.completion !== "completed") {
    const stderr = ["error: SDK Atlas is not a Valid Atlas Lint Result."];
    stderr.push(...errors.map(formatFinding));
    if (errors.length === 0) {
      stderr.push(
        `Lint status=${String(lint.status)} disposition=${result.disposition} completion=${result.completion} outcome=none validation=${result.handoff.validationState.state}`,
      );
    }
    return { exitCode: 1, stderr, stdout: [] };
  }

  if (
    lint.status !== SUCCESS_EXIT_CODE ||
    result.disposition !== "success" ||
    result.payload.lint.outcome !== "valid" ||
    result.handoff.validationState.state !== "passed" ||
    errors.length > 0
  ) {
    const stderr = ["error: SDK Atlas is not a Valid Atlas Lint Result."];
    stderr.push(...errors.map(formatFinding));
    if (errors.length === 0) {
      stderr.push(
        `Lint status=${String(lint.status)} disposition=${result.disposition} completion=${result.completion} outcome=${result.payload.lint.outcome} validation=${result.handoff.validationState.state}`,
      );
    }
    return { exitCode: 1, stderr, stdout: [] };
  }

  return {
    exitCode: 0,
    stderr: [],
    stdout: [
      `validated SDK Atlas Lint: ${String(result.payload.lint.pages?.length ?? 0)} page(s), ${String(result.payload.lint.opaque?.length ?? 0)} opaque record(s), 0 error Findings`,
    ],
  };
}

function parseAtlasHostDirectory(arguments_: readonly string[]): string | undefined {
  if (arguments_.length === 1 && arguments_[0] === "validate") return ".";
  if (
    arguments_.length === 3 &&
    arguments_[0] === "validate" &&
    arguments_[1] === "--atlas-host-directory" &&
    arguments_[2] !== undefined &&
    !arguments_[2].startsWith("--")
  ) {
    return arguments_[2];
  }
  return undefined;
}

export function main(arguments_: readonly string[]): number {
  const atlasHostDirectory = parseAtlasHostDirectory(arguments_);
  if (atlasHostDirectory === undefined) {
    console.error("usage: sdk_atlas_lint.ts validate [--atlas-host-directory PATH]");
    return 2;
  }

  const result = runSdkAtlasLintGate(atlasHostDirectory);
  for (const line of result.stdout) console.log(line);
  for (const line of result.stderr) console.error(line);
  return result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
