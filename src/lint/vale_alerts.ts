import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { Finding, FindingLocation } from "../domain/finding.ts";
import {
  proseLintConfigPath,
  type ProseLintOutcome,
  type ProseLintRequest,
} from "./prose_lint.ts";
import { sdkFindings } from "./sdk_finding.ts";

/** One completed Vale process, as the platform adapter observed it. */
export interface ValeProcessResult {
  readonly status: number | null;
  readonly stdout: string;
}

const configFinding = sdkFindings("sdk-core.prose-lint");

// Control characters and bidirectional overrides rewrite what a terminal shows
// without changing the text a reader compares, so Vale's untrusted message text
// is neutralized before it travels in a Finding.
function isUnsafeMessageCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function safeMessage(text: string): string {
  return Array.from(text, (character) =>
    isUnsafeMessageCharacter(character.codePointAt(0) as number) ? "\uFFFD" : character,
  ).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function unavailable(reason: string): ProseLintOutcome {
  return Object.freeze({ reason, state: "unavailable" as const });
}

/** A Vale check name as a Finding code: `AtlasSDK.PageLength` is `VALE_ATLASSDK_PAGELENGTH`. */
export function valeFindingCode(check: string): string {
  const stem = check
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return stem === "" ? "VALE_ALERT" : `VALE_${stem}`;
}

const valeSeverities: ReadonlySet<string> = new Set(["error", "suggestion", "warning"]);

function alertFinding(path: string, alert: unknown): Finding | undefined {
  if (!isRecord(alert)) return undefined;
  const { Check: check, Line: line, Message: message, Severity: severity } = alert;
  const span = alert["Span"];
  if (
    typeof check !== "string" ||
    check.trim() === "" ||
    typeof message !== "string" ||
    typeof severity !== "string" ||
    !valeSeverities.has(severity) ||
    !isPosition(line) ||
    !Array.isArray(span) ||
    span.length !== 2 ||
    !isPosition(span[0]) ||
    !isPosition(span[1])
  ) {
    return undefined;
  }
  const location: FindingLocation = Object.freeze({
    end: Object.freeze({ column: Math.max(span[0], span[1]) + 1, line }),
    start: Object.freeze({ column: span[0], line }),
  });
  return Object.freeze({
    attribution: Object.freeze({
      checkId: `vale.${safeMessage(check)}`,
      kind: "atlas-owned" as const,
      trusted: false as const,
    }),
    code: valeFindingCode(check),
    "finding-schema": "1.0.0" as const,
    location,
    message:
      message.trim() === ""
        ? `Vale rule ${safeMessage(check)} reported an alert.`
        : safeMessage(message),
    path,
    severity: severity as Finding["severity"],
  });
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    compareCodePoints(left.path, right.path) ||
    (left.location as FindingLocation).start.line -
      (right.location as FindingLocation).start.line ||
    (left.location as FindingLocation).start.column -
      (right.location as FindingLocation).start.column ||
    compareCodePoints(left.code, right.code) ||
    compareCodePoints(left.message, right.message)
  );
}

function alertFindings(
  output: unknown,
  pagePaths: ReadonlySet<string>,
): ProseLintOutcome {
  if (!isRecord(output)) {
    return unavailable("Vale did not return a JSON alert report.");
  }
  const findings: Finding[] = [];
  for (const [reportedPath, alerts] of Object.entries(output)) {
    // Vale echoes the path it was given; on Windows it may use backslashes.
    const path = reportedPath.replaceAll("\\", "/");
    if (!pagePaths.has(path)) {
      return unavailable("Vale reported alerts for a file Lint did not request.");
    }
    if (!Array.isArray(alerts)) {
      return unavailable("Vale returned a malformed alert report.");
    }
    for (const alert of alerts as readonly unknown[]) {
      const finding = alertFinding(path, alert);
      if (finding === undefined) {
        return unavailable("Vale returned a malformed alert report.");
      }
      findings.push(finding);
    }
  }
  return Object.freeze({
    findings: Object.freeze(findings.toSorted(compareFindings)),
    state: "completed" as const,
  });
}

/**
 * Names the Atlas file a Vale configuration error points at. Vale reports the
 * temporary workspace path it read, which is not shown: only a path naming a
 * file Lint itself loaded survives, and anything else becomes the Atlas's Vale
 * configuration. "a Vale configuration error is an Atlas error that never leaks
 * the workspace" in `tests/vale_alerts.test.ts` pins it.
 */
function configErrorPath(
  reported: unknown,
  workspaceRoot: string,
  filePaths: ReadonlySet<string>,
): string {
  if (typeof reported !== "string") return proseLintConfigPath;
  const prefix = `${workspaceRoot.replaceAll("\\", "/")}/`;
  const normalized = reported.replaceAll("\\", "/");
  const relative = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : normalized;
  return filePaths.has(relative) ? relative : proseLintConfigPath;
}

function withoutWorkspaceRoot(text: string, workspaceRoot: string): string {
  let result = text;
  for (const root of new Set([workspaceRoot, workspaceRoot.replaceAll("\\", "/")])) {
    result = result
      .replaceAll(`${root}/`, "")
      .replaceAll(`${root}\\`, "")
      .replaceAll(root, ".");
  }
  return result;
}

function configErrorFinding(
  output: unknown,
  workspaceRoot: string,
  filePaths: ReadonlySet<string>,
): Finding {
  const record = isRecord(output) ? output : {};
  const text =
    typeof record["Text"] === "string" && record["Text"].trim() !== ""
      ? withoutWorkspaceRoot(record["Text"], workspaceRoot)
      : "Vale rejected the configuration.";
  const line = record["Line"];
  const column = isPosition(record["Span"]) ? record["Span"] : 1;
  const location = isPosition(line)
    ? {
        end: { column: column + 1, line },
        start: { column, line },
      }
    : undefined;
  return configFinding(
    "ATLAS_VALE_CONFIG_INVALID",
    `The Atlas's Vale configuration could not be loaded: ${safeMessage(text)}`,
    configErrorPath(record["Path"], workspaceRoot, filePaths),
    location,
  );
}

function parseJson(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/**
 * Translates one Vale run into Lint's terms. Exit 0 and 1 carry an alert report
 * (1 means Vale saw an error-level alert, which Lint decides from the Findings
 * themselves); exit 2 carries a configuration error the Atlas must fix. Any
 * other outcome, or output Lint does not recognize, means prose Lint did not run.
 */
export function valeProseLintOutcome(
  result: ValeProcessResult,
  request: ProseLintRequest,
  workspaceRoot: string,
): ProseLintOutcome {
  const parsed = parseJson(result.stdout);
  if (result.status === 2) {
    const filePaths = new Set(request.files.map((file) => file.path));
    return Object.freeze({
      findings: Object.freeze([
        configErrorFinding(parsed?.value, workspaceRoot, filePaths),
      ]),
      state: "completed" as const,
    });
  }
  if (result.status !== 0 && result.status !== 1) {
    return unavailable("Vale exited without completing a prose Lint.");
  }
  if (parsed === undefined) {
    return unavailable("Vale did not return a JSON alert report.");
  }
  return alertFindings(parsed.value, new Set(request.pagePaths));
}
