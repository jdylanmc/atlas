import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  correspondenceRefusalResult,
  exitCodeForIngestOperationResult,
  ingestCommandExitCodes,
  ingestCommandInputBudgets,
  parseIngestRequest,
  parseIngestScope,
  planCrawlAssignment,
  serializeIngestMachineResult,
  usageIngestOperationResult,
} from "../src/interfaces/ingest_command.ts";
import type { AtlasIngestRequest } from "../src/operations/ingest_operation.ts";
import {
  createLocalAtlasIngestState,
  runLocalAtlasIngest,
} from "../src/platform/local_atlas_ingest.ts";

const ROOT = resolve(import.meta.dirname, "..");
const COMMAND = resolve(ROOT, "scripts", "atlas.ts");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "ingest-cli");

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function gitWithDate(
  repository: string,
  args: readonly string[],
  isoDate: string,
): string {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: isoDate,
      GIT_COMMITTER_DATE: isoDate,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function gitMaybe(repository: string, args: readonly string[]): number | null {
  return spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" }).status;
}

function runAtlas(arguments_: readonly string[]): CommandResult {
  const result = spawnSync(process.execPath, [COMMAND, ...arguments_], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function fixtureJson(name: string): string {
  return resolve(ROOT, "tests", "fixtures", "ingest", name);
}

function ingestRequest(name = "request-valid.json"): AtlasIngestRequest {
  return JSON.parse(readFileSync(fixtureJson(name), "utf8")) as AtlasIngestRequest;
}

function initAtlasRepository(repository: string): string {
  rmSync(repository, { force: true, recursive: true });
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-b", "main"]);
  cpSync(
    resolve(ROOT, "tests", "fixtures", "complete-atlas", ".atlas"),
    resolve(repository, ".atlas"),
    { recursive: true },
  );
  writeFileSync(resolve(repository, "README.md"), "# host\n", "utf8");
  // Committed at the exact instant the ingest fixtures assert as this Source's
  // revisionTime, so Ingest's independent Git capture at "docs/readme.md"
  // corroborates every fixture that asserts this content unmutated.
  mkdirSync(resolve(repository, "docs"), { recursive: true });
  writeFileSync(
    resolve(repository, "docs", "readme.md"),
    "Atlas SDK is a deterministic library. The Lint gate runs with no network access.",
    "utf8",
  );
  git(repository, ["add", ".atlas", "README.md", "docs/readme.md"]);
  gitWithDate(
    repository,
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Initial Atlas",
    ],
    "2026-08-20T00:00:00Z",
  );
  return git(repository, ["rev-parse", "HEAD"]);
}

function parseIngestResult(stdout: string): ReturnType<typeof runLocalAtlasIngest> {
  const parsed = JSON.parse(stdout) as ReturnType<typeof runLocalAtlasIngest>;
  assert.equal(parsed["operation-result-schema"], "1.0.0");
  assert.equal(parsed.handoff["operation-handoff-schema"], "1.0.0");
  assert.deepEqual(parsed.handoff.operation, parsed.operation);
  return parsed;
}

test("atlas ingest plan emits a Crawler assignment only for an approved Ingest Scope", () => {
  const command = runAtlas([
    "ingest",
    "plan",
    "--machine",
    "--ingest-scope",
    fixtureJson("scope-approved.json"),
  ]);

  assert.equal(command.status, ingestCommandExitCodes.success);
  assert.equal(command.stderr, "");
  const assignment = JSON.parse(command.stdout) as Readonly<Record<string, unknown>>;
  assert.equal(assignment["crawl-assignment-schema"], "1.0.0");
  assert.equal(assignment["sourceId"], "source:readme");
  assert.equal(
    (assignment["attestation"] as Readonly<Record<string, unknown>>)["approver"],
    "Fixture Maintainer",
  );
  assert.equal(assignment["refreshWindowDays"], 30);
});

test("atlas ingest plan refuses invalid approval and Ingest Scope timestamps", () => {
  const badApproval = runAtlas([
    "ingest",
    "plan",
    "--machine",
    "--ingest-scope",
    fixtureJson("scope-bad-approved-at.json"),
  ]);
  assert.equal(badApproval.status, ingestCommandExitCodes.approvalRequired);
  assert.equal(
    parseIngestResult(badApproval.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_APPROVAL_REQUIRED",
  );

  const dateOnlyApproval = runAtlas([
    "ingest",
    "plan",
    "--machine",
    "--ingest-scope",
    fixtureJson("scope-date-only-approved-at.json"),
  ]);
  assert.equal(dateOnlyApproval.status, ingestCommandExitCodes.approvalRequired);
  assert.equal(
    parseIngestResult(dateOnlyApproval.stdout).handoff.validationState.findings[0]
      ?.code,
    "ATLAS_INGEST_APPROVAL_REQUIRED",
  );

  const badAsOf = runAtlas([
    "ingest",
    "plan",
    "--machine",
    "--ingest-scope",
    fixtureJson("scope-bad-asof.json"),
  ]);
  assert.equal(badAsOf.status, ingestCommandExitCodes.operationFailed);
  assert.equal(
    parseIngestResult(badAsOf.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_SCOPE_AS_OF_INVALID",
  );

  const dateOnlyAsOf = runAtlas([
    "ingest",
    "plan",
    "--machine",
    "--ingest-scope",
    fixtureJson("scope-date-only-asof.json"),
  ]);
  assert.equal(dateOnlyAsOf.status, ingestCommandExitCodes.operationFailed);
  assert.equal(
    parseIngestResult(dateOnlyAsOf.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_SCOPE_AS_OF_INVALID",
  );
});

test("atlas ingest reconcile refuses invalid Ingest Scope and Source timestamps", () => {
  const badAsOfRepository = resolve(WORKSPACE, "bad-asof");
  initAtlasRepository(badAsOfRepository);
  const badAsOf = runAtlas([
    "ingest",
    "reconcile",
    "--machine",
    "--ingest-request",
    fixtureJson("request-bad-asof.json"),
    "--atlas-host-directory",
    badAsOfRepository,
  ]);
  assert.equal(badAsOf.status, ingestCommandExitCodes.operationFailed);
  assert.equal(
    parseIngestResult(badAsOf.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_SCOPE_AS_OF_INVALID",
  );

  const dateOnlyAsOfRepository = resolve(WORKSPACE, "date-only-asof");
  initAtlasRepository(dateOnlyAsOfRepository);
  const dateOnlyAsOf = runAtlas([
    "ingest",
    "reconcile",
    "--machine",
    "--ingest-request",
    fixtureJson("request-date-only-asof.json"),
    "--atlas-host-directory",
    dateOnlyAsOfRepository,
  ]);
  assert.equal(dateOnlyAsOf.status, ingestCommandExitCodes.operationFailed);
  assert.equal(
    parseIngestResult(dateOnlyAsOf.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_SCOPE_AS_OF_INVALID",
  );

  const badRevisionRepository = resolve(WORKSPACE, "bad-revision-time");
  initAtlasRepository(badRevisionRepository);
  const badRevisionTime = runAtlas([
    "ingest",
    "reconcile",
    "--machine",
    "--ingest-request",
    fixtureJson("request-bad-revision-time.json"),
    "--atlas-host-directory",
    badRevisionRepository,
  ]);
  assert.equal(badRevisionTime.status, ingestCommandExitCodes.operationFailed);
  assert.equal(
    parseIngestResult(badRevisionTime.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_SOURCE_REVISION_TIME_INVALID",
  );

  const dateOnlyRevisionRepository = resolve(WORKSPACE, "date-only-revision-time");
  initAtlasRepository(dateOnlyRevisionRepository);
  const dateOnlyRevisionTime = runAtlas([
    "ingest",
    "reconcile",
    "--machine",
    "--ingest-request",
    fixtureJson("request-date-only-revision-time.json"),
    "--atlas-host-directory",
    dateOnlyRevisionRepository,
  ]);
  assert.equal(dateOnlyRevisionTime.status, ingestCommandExitCodes.operationFailed);
  assert.equal(
    parseIngestResult(dateOnlyRevisionTime.stdout).handoff.validationState.findings[0]
      ?.code,
    "ATLAS_INGEST_SOURCE_REVISION_TIME_INVALID",
  );
});

test("atlas ingest reconcile refuses oversized JSON before reading it", () => {
  const repository = resolve(WORKSPACE, "oversized-request");
  initAtlasRepository(repository);
  const path = resolve(WORKSPACE, "oversized-request.json");
  writeFileSync(
    path,
    `{"padding":"${"x".repeat(ingestCommandInputBudgets.maxFileBytes)}"}`,
  );

  const command = runAtlas([
    "ingest",
    "reconcile",
    "--machine",
    "--ingest-request",
    path,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, ingestCommandExitCodes.usage);
  assert.equal(command.stderr, "");
  assert.equal(
    parseIngestResult(command.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_INPUT_TOO_LARGE",
  );
});

test("atlas ingest reconcile pauses scope expansion as a human decision", () => {
  const repository = resolve(WORKSPACE, "scope-expansion");
  initAtlasRepository(repository);

  const command = runAtlas([
    "ingest",
    "reconcile",
    "--machine",
    "--ingest-request",
    fixtureJson("request-scope-expansion.json"),
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, ingestCommandExitCodes.scopeAwaitingApproval);
  assert.equal(command.stderr, "");
  const result = parseIngestResult(command.stdout);
  assert.equal(result.completion, "not-completed");
  assert.equal(result.handoff.unresolvedHumanDecisions.state, "pending");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_SCOPE_EXPANSION_PENDING",
  );
});

test("atlas ingest reconcile creates one local proposal without moving the target branch", () => {
  const repository = resolve(WORKSPACE, "valid-reconcile");
  const mainBefore = initAtlasRepository(repository);
  rmSync(resolve(repository, ".git", "info", "exclude"), { force: true });

  const command = runAtlas([
    "ingest",
    "reconcile",
    "--machine",
    "--ingest-request",
    fixtureJson("request-valid.json"),
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, ingestCommandExitCodes.success, command.stderr);
  assert.equal(command.stderr, "");
  const result = parseIngestResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.payload.state, "completed");
  assert.equal(result.payload.lint?.payload.state, "completed");
  assert.equal(result.payload.lint.payload.lint.outcome, "valid");
  assert.equal(git(repository, ["rev-parse", "main"]), mainBefore);
  assert.notEqual(
    gitMaybe(repository, ["show", "main:.atlas/concepts/determinism.md"]),
    0,
  );
  assert.match(
    git(repository, [
      "show",
      `${result.payload.workflowState.proposalBranch}:.atlas/concepts/determinism.md`,
    ]),
    /Atlas SDK is a deterministic library/u,
  );
  assert.match(
    readFileSync(resolve(repository, ".git", "info", "exclude"), "utf8"),
    /^\.atlas-operation-workspaces\/$/mu,
  );
  assert.equal(
    existsSync(
      resolve(
        repository,
        ".atlas-operation-workspaces",
        result.payload.workflowState.proposalBranch,
        ".atlas",
        "index.md",
      ),
    ),
    true,
  );
});

test("Local Atlas Ingest refuses capture failures and unsafe workspace paths as values", () => {
  const request = ingestRequest();
  const missing = runLocalAtlasIngest(
    resolve(WORKSPACE, "missing-repository"),
    request,
  );
  assert.equal(missing.completion, "not-completed");
  assert.equal(
    missing.handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_CAPTURE_FAILED",
  );
  assert.equal(
    exitCodeForIngestOperationResult(missing),
    ingestCommandExitCodes.operationNotCompleted,
  );
  assert.throws(() =>
    createLocalAtlasIngestState(resolve(WORKSPACE, "missing-repository"), request),
  );

  const largeRepository = resolve(WORKSPACE, "large-atlas");
  initAtlasRepository(largeRepository);
  writeFileSync(
    resolve(largeRepository, ".atlas", "large.md"),
    "x".repeat(1024 * 1024 + 1),
    "utf8",
  );
  git(largeRepository, ["add", ".atlas/large.md"]);
  git(largeRepository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Add large Atlas file",
  ]);
  assert.throws(() => createLocalAtlasIngestState(largeRepository, request));
  assert.equal(
    runLocalAtlasIngest(largeRepository, request).handoff.validationState.findings[0]
      ?.code,
    "ATLAS_INGEST_CAPTURE_FAILED",
  );

  const repository = resolve(WORKSPACE, "symlink-workspace");
  const outside = resolve(WORKSPACE, "symlink-outside");
  initAtlasRepository(repository);
  const state = createLocalAtlasIngestState(repository, request);
  rmSync(outside, { force: true, recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, resolve(repository, ".atlas-operation-workspaces"));

  const refused = runLocalAtlasIngest(repository, request);

  assert.equal(refused.completion, "not-completed");
  assert.equal(
    refused.handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_WORKSPACE_PATH_INVALID",
  );
  assert.equal(
    existsSync(
      resolve(outside, state.proposalBranch, ".atlas", "sources", "readme.md"),
    ),
    false,
  );
});

test("Local Atlas Ingest preserves an existing Operation Workspace", () => {
  const repository = resolve(WORKSPACE, "existing-workspace");
  initAtlasRepository(repository);
  const first = runLocalAtlasIngest(repository, ingestRequest());
  assert.equal(first.completion, "completed");
  const branch = first.payload.workflowState.proposalBranch;
  const sentinel = resolve(
    repository,
    ".atlas-operation-workspaces",
    branch,
    ".atlas",
    "REVIEW-NOTES.md",
  );
  mkdirSync(dirname(sentinel), { recursive: true });
  writeFileSync(sentinel, "SENTINEL: human review notes\n", "utf8");

  const second = runLocalAtlasIngest(repository, ingestRequest());

  assert.equal(second.completion, "not-completed");
  assert.equal(
    second.handoff.validationState.findings[0]?.code,
    "ATLAS_INGEST_WORKSPACE_EXISTS",
  );
  assert.equal(readFileSync(sentinel, "utf8"), "SENTINEL: human review notes\n");
});

test("Ingest command helpers preserve machine JSON and all exit classes", () => {
  const invalidScope = parseIngestScope(null);
  assert.equal(invalidScope.ok, false);

  const unapprovedScope = parseIngestScope(
    JSON.parse(readFileSync(fixtureJson("scope-unapproved.json"), "utf8")),
  );
  assert.equal(unapprovedScope.ok, true);
  const approval = planCrawlAssignment(unapprovedScope.value);
  assert.equal(approval.state, "refused");
  assert.equal(
    exitCodeForIngestOperationResult(approval.result),
    ingestCommandExitCodes.approvalRequired,
  );

  const baseline = ingestRequest();
  const withExpiry = parseIngestScope({
    ...baseline.scope,
    attestation: { ...baseline.scope.attestation, expiresAt: "2099-01-01T00:00:00Z" },
  });
  assert.equal(withExpiry.ok, true);
  for (const badScope of [
    { ...baseline.scope, "ingest-scope-schema": "2.0.0" },
    { ...baseline.scope, authority: "trusted" },
    { ...baseline.scope, freshnessWindowDays: "30" },
    { ...baseline.scope, includedPaths: "docs" },
    {
      ...baseline.scope,
      attestation: {
        ...baseline.scope.attestation,
        "approval-attestation-schema": "2.0.0",
      },
    },
  ]) {
    assert.equal(parseIngestScope(badScope).ok, false);
  }
  assert.equal(
    parseIngestRequest({
      ...baseline,
      candidateGraph: { ...baseline.candidateGraph, disputes: {} },
    }).ok,
    false,
  );
  // A Candidate Graph asserting more distinct Source locators than the
  // budget allows is refused before Ingest would shell out one or two trusted
  // Git subprocesses per locator to independently capture each one.
  assert.equal(
    parseIngestRequest({
      ...baseline,
      candidateGraph: {
        ...baseline.candidateGraph,
        sources: Array.from(
          { length: ingestCommandInputBudgets.maxSources + 1 },
          (_, index) => ({
            ...baseline.candidateGraph.sources[0],
            id: `source:readme-${String(index)}`,
            locator: `docs/readme-${String(index)}.md`,
          }),
        ),
      },
    }).ok,
    false,
  );
  const requestWithContradiction = {
    ...baseline,
    candidateGraph: {
      ...baseline.candidateGraph,
      concepts: [
        {
          ...baseline.candidateGraph.concepts[0],
          contradiction: {
            acceptedBy: "Fixture Maintainer",
            atlasPolicyId: "policy:publication",
          },
        },
      ],
      disputes: [
        {
          leftConceptId: "concept:determinism",
          rightConceptId: "concept:other",
        },
      ],
    },
  };
  const parsed = parseIngestRequest(requestWithContradiction);
  assert.equal(parsed.ok, true);
  assert.equal(
    parseIngestRequest({
      ...baseline,
      candidateGraph: {
        ...baseline.candidateGraph,
        concepts: [
          {
            ...baseline.candidateGraph.concepts[0],
            contradiction: {
              acceptedBy: "Fixture Maintainer",
              principleTruthId: "truth:no-model",
            },
          },
        ],
      },
    }).ok,
    true,
  );

  const usage = usageIngestOperationResult("bad arguments");
  assert.equal(serializeIngestMachineResult(usage), `${JSON.stringify(usage)}\n`);
  assert.equal(exitCodeForIngestOperationResult(usage), ingestCommandExitCodes.usage);

  const correspondence = correspondenceRefusalResult([
    {
      attribution: { checkId: "test", kind: "sdk-core", trusted: true },
      code: "ATLAS_INGEST_SOURCE_CORRESPONDENCE",
      "finding-schema": "1.0.0",
      message: "wrong source",
      path: ".atlas",
      severity: "error",
    },
  ]);
  assert.equal(
    exitCodeForIngestOperationResult(correspondence),
    ingestCommandExitCodes.operationFailed,
  );
});
