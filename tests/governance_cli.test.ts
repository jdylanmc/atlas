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
import test, { after } from "node:test";
import {
  exitCodeForGovernOperationResult,
  governCommandExitCodes,
  governCommandInputBudgets,
  invalidInputGovernOperationResult,
  oversizedInputGovernOperationResult,
  parseGovernRequest,
  serializeGovernMachineResult,
  usageGovernOperationResult,
} from "../src/interfaces/governance_command.ts";
import type {
  AtlasGovernanceRequest,
  AtlasGovernanceResult,
} from "../src/operations/governance_operation.ts";
import {
  createLocalAtlasGovernanceState,
  notCompletedLocalGovernanceResult,
  runLocalAtlasGovernance,
} from "../src/platform/local_atlas_governance.ts";

const ROOT = resolve(import.meta.dirname, "..");
const COMMAND = resolve(ROOT, "scripts", "atlas.ts");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "govern-cli");

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function git(repository: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runAtlas(arguments_: readonly string[]): CommandResult {
  const result = spawnSync(process.execPath, [COMMAND, ...arguments_], {
    cwd: ROOT,
    encoding: "utf8",
    // The machine Operation Result echoes the accepted Change Set, so worst-case
    // stdout exceeds spawnSync's 1 MiB default and the input budget; a consumer
    // must size its buffer above the input, exactly as documented on
    // governCommandInputBudgets.
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function fixtureJson(name: string): string {
  return resolve(ROOT, "tests", "fixtures", "governance", name);
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
  git(repository, ["add", ".atlas", "README.md"]);
  git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Initial Atlas",
  ]);
  return git(repository, ["rev-parse", "HEAD"]);
}

function parseGovernResult(stdout: string): AtlasGovernanceResult {
  const parsed = JSON.parse(stdout) as AtlasGovernanceResult;
  assert.equal(parsed["operation-result-schema"], "1.0.0");
  assert.equal(parsed.handoff["operation-handoff-schema"], "1.0.0");
  assert.deepEqual(parsed.handoff.operation, parsed.operation);
  return parsed;
}

// An amend request whose Atlas Change Set matches the deterministic workflow
// state, so the operation accepts it and produces a Linted Atlas Proposal.
function amendPrincipleRequest(repository: string): AtlasGovernanceRequest {
  const base = {
    "governance-request-schema": "1.0.0" as const,
    action: "amend" as const,
    approvedAt: "2026-08-22T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    subject: "principle" as const,
  };
  const state = createLocalAtlasGovernanceState(repository, base);
  const principle = readFileSync(
    resolve(repository, ".atlas", "principles", "determinism.md"),
    "utf8",
  )
    .replace(
      "- `truth:ordering` Findings and serialized pages are ordered by Unicode code\n  points alone.",
      "- `truth:ordering` Findings and serialized pages are ordered by Unicode code\n  points alone.\n- `truth:no-model` Trusted validation runs where a model cannot reach it.",
    )
    .replace(
      "### 1 - 2026-08-17\n\nAdded `truth:ordering` under Maintainer approval.",
      "### 1 - 2026-08-17\n\nAdded `truth:ordering` under Maintainer approval.\n\n### 2 - 2026-08-22\n\nAdded `truth:no-model` under Maintainer approval.",
    );
  const changelog = `${readFileSync(
    resolve(repository, ".atlas", "CHANGELOG.md"),
    "utf8",
  )}\n## 2026-08-22\n\n- ${state.operationId}: Amended Determinism Principle.\n`;
  return {
    ...base,
    changeSet: {
      baseSnapshotDigest: state.baseSnapshotDigest,
      changes: [
        { content: changelog, path: ".atlas/CHANGELOG.md" },
        { content: principle, path: ".atlas/principles/determinism.md" },
      ],
      targetHead: state.targetHead,
    },
  };
}

// A policy maintenance request carrying a semantic Policy verdict. The verdict
// re-enters as validated input; the caller controls only its outcome and the
// Challenge position, never whether the SDK "agrees" with it.
function policyRequest(
  repository: string,
  verdict: "fail" | "pass",
  position: "agree" | "disagree",
  verdictPolicyId = "policy:publication",
): AtlasGovernanceRequest {
  const base = {
    "governance-request-schema": "1.0.0" as const,
    action: "create" as const,
    approvedAt: "2026-08-22T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    subject: "atlas-policy" as const,
  };
  const state = createLocalAtlasGovernanceState(repository, base);
  const policy = [
    "---",
    "sdk:",
    "  atlas-sdk-schema: 1.0.0",
    '  created-at: "2026-08-22T00:00:00Z"',
    "  created-by:",
    "    kind: human",
    "    name: Fixture Maintainer",
    "  id: policy:publication",
    "  local-atlas-schema: 1.0.0",
    "  tags: []",
    "  title: Publication",
    "  type: policy",
    '  updated-at: "2026-08-22T00:00:00Z"',
    "  updated-by:",
    "    kind: human",
    "    name: Fixture Maintainer",
    "atlas: {}",
    "---",
    "",
    "# Publication",
    "",
    "## Scope",
    "",
    "Publication is governed by this Policy.",
    "",
    "## Evaluation",
    "",
    "Semantic evaluation with Challenge is required.",
    "",
    "## Consequence",
    "",
    "Violations block only the governed operation.",
    "",
  ].join("\n");
  const changelog = `${readFileSync(
    resolve(repository, ".atlas", "CHANGELOG.md"),
    "utf8",
  )}\n## 2026-08-22\n\n- ${state.operationId}: Created Publication Policy.\n`;
  return {
    ...base,
    changeSet: {
      baseSnapshotDigest: state.baseSnapshotDigest,
      changes: [
        { content: changelog, path: ".atlas/CHANGELOG.md" },
        { content: policy, path: ".atlas/types/policy/publication.md" },
      ],
      targetHead: state.targetHead,
    },
    semanticVerdicts: [
      {
        challenge: {
          argument: "The cited Atlas locations support this result.",
          evidence: [".atlas/index.md#L1"],
          position,
        },
        evidence: [".atlas/index.md#L1"],
        policyId: verdictPolicyId,
        verdict,
      },
    ],
  };
}

// A create request for a fresh Principle page and its Changelog entry, so the
// operation exercises the create route rather than the amend route.
function createPrincipleRequest(repository: string): AtlasGovernanceRequest {
  const base = {
    "governance-request-schema": "1.0.0" as const,
    action: "create" as const,
    approvedAt: "2026-08-22T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    subject: "principle" as const,
  };
  const state = createLocalAtlasGovernanceState(repository, base);
  const page = [
    "---",
    "sdk:",
    "  atlas-sdk-schema: 1.0.0",
    '  created-at: "2026-08-22T00:00:00Z"',
    "  created-by:",
    "    kind: human",
    "    name: Fixture Maintainer",
    "  id: principle:no-model",
    "  local-atlas-schema: 1.0.0",
    "  tags: []",
    "  title: No Model",
    "  type: principle",
    '  updated-at: "2026-08-22T00:00:00Z"',
    "  updated-by:",
    "    kind: human",
    "    name: Fixture Maintainer",
    "atlas: {}",
    "---",
    "",
    "# No Model",
    "",
    "## Active truths",
    "",
    "- `truth:no-model` Trusted validation runs where a model cannot reach it.",
    "",
    "## Amendments",
    "",
    "### 1 - 2026-08-22",
    "",
    "Added `truth:no-model` under Maintainer approval.",
    "",
  ].join("\n");
  const changelog = `${readFileSync(
    resolve(repository, ".atlas", "CHANGELOG.md"),
    "utf8",
  )}\n## 2026-08-22\n\n- ${state.operationId}: Created No Model Principle.\n`;
  return {
    ...base,
    changeSet: {
      baseSnapshotDigest: state.baseSnapshotDigest,
      changes: [
        { content: changelog, path: ".atlas/CHANGELOG.md" },
        { content: page, path: ".atlas/principles/no-model.md" },
      ],
      targetHead: state.targetHead,
    },
  };
}

// A Principle whose active truths are all removed. Under `retire` the operation
// permits an empty active-truth set (governance_operation.ts relaxes the
// truth-required rule for retire); under `amend` the same Change Set is refused.
function emptiedPrincipleContent(repository: string): string {
  return readFileSync(
    resolve(repository, ".atlas", "principles", "determinism.md"),
    "utf8",
  )
    .replace(
      "\n- `truth:ordering` Findings and serialized pages are ordered by Unicode code\n  points alone.",
      "",
    )
    .replace(
      "### 1 - 2026-08-17\n\nAdded `truth:ordering` under Maintainer approval.",
      "### 1 - 2026-08-17\n\nAdded `truth:ordering` under Maintainer approval.\n\n### 2 - 2026-08-22\n\nRetired the Principle and invalidated `truth:ordering` under Maintainer approval.",
    );
}

function retirePrincipleRequest(
  repository: string,
  action: "amend" | "retire",
): AtlasGovernanceRequest {
  const base = {
    "governance-request-schema": "1.0.0" as const,
    action,
    approvedAt: "2026-08-22T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    subject: "principle" as const,
  };
  const state = createLocalAtlasGovernanceState(repository, base);
  const changelog = `${readFileSync(
    resolve(repository, ".atlas", "CHANGELOG.md"),
    "utf8",
  )}\n## 2026-08-22\n\n- ${state.operationId}: Retired Determinism Principle.\n`;
  return {
    ...base,
    changeSet: {
      baseSnapshotDigest: state.baseSnapshotDigest,
      changes: [
        { content: changelog, path: ".atlas/CHANGELOG.md" },
        {
          content: emptiedPrincipleContent(repository),
          path: ".atlas/principles/determinism.md",
        },
      ],
      targetHead: state.targetHead,
    },
  };
}

function withoutSemanticVerdicts(
  request: AtlasGovernanceRequest,
): AtlasGovernanceRequest {
  const copy: Record<string, unknown> = { ...request };
  delete copy["semanticVerdicts"];
  return copy as unknown as AtlasGovernanceRequest;
}

test("atlas govern amends a Principle into one Linted Atlas Proposal", () => {
  const repository = resolve(WORKSPACE, "amend");
  const mainBefore = initAtlasRepository(repository);
  const request = amendPrincipleRequest(repository);
  const requestPath = resolve(WORKSPACE, "amend-request.json");
  writeFileSync(requestPath, JSON.stringify(request), "utf8");

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    requestPath,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.success, command.stdout);
  assert.equal(command.stderr, "");
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.ok(result.payload.lint);
  assert.equal(result.payload.lint.payload.state, "completed");
  assert.equal(result.payload.lint.payload.lint.outcome, "valid");
  assert.equal(git(repository, ["rev-parse", "main"]), mainBefore);
  assert.match(
    git(repository, [
      "show",
      `${result.payload.workflowState.proposalBranch}:.atlas/principles/determinism.md`,
    ]),
    /truth:no-model/u,
  );
});

test("atlas govern creates a Principle into one Linted Atlas Proposal", () => {
  const repository = resolve(WORKSPACE, "create-principle");
  const mainBefore = initAtlasRepository(repository);
  const requestPath = resolve(WORKSPACE, "create-principle-request.json");
  writeFileSync(
    requestPath,
    JSON.stringify(createPrincipleRequest(repository)),
    "utf8",
  );

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    requestPath,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.success, command.stdout);
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.ok(result.payload.lint);
  assert.equal(result.payload.lint.payload.state, "completed");
  assert.equal(result.payload.lint.payload.state, "completed");
  assert.equal(result.payload.lint.payload.lint.outcome, "valid");
  assert.equal(git(repository, ["rev-parse", "main"]), mainBefore);
  // The new Principle exists only on the proposal branch, never on the target.
  assert.notEqual(
    spawnSync("git", [
      "-C",
      repository,
      "cat-file",
      "-e",
      "main:.atlas/principles/no-model.md",
    ]).status,
    0,
  );
  assert.match(
    git(repository, [
      "show",
      `${result.payload.workflowState.proposalBranch}:.atlas/principles/no-model.md`,
    ]),
    /principle:no-model/u,
  );
});

test("atlas govern retires a Principle with zero active truths, where amend is refused", () => {
  const repository = resolve(WORKSPACE, "retire-principle");
  const mainBefore = initAtlasRepository(repository);
  const requestPath = resolve(WORKSPACE, "retire-principle-request.json");
  writeFileSync(
    requestPath,
    JSON.stringify(retirePrincipleRequest(repository, "retire")),
    "utf8",
  );

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    requestPath,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.success, command.stdout);
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.ok(result.payload.lint);
  assert.equal(result.payload.lint.payload.state, "completed");
  assert.equal(result.payload.lint.payload.lint.outcome, "valid");
  assert.equal(git(repository, ["rev-parse", "main"]), mainBefore);

  // The contrast that proves the relaxation is real: the identical zero-truth
  // Change Set is refused under `amend`, which is not exempt from the
  // active-truth requirement. If this stopped failing, retire would prove
  // nothing about the action-specific branch.
  const amendRepository = resolve(WORKSPACE, "amend-zero-truth");
  initAtlasRepository(amendRepository);
  const refused = runLocalAtlasGovernance(
    amendRepository,
    retirePrincipleRequest(amendRepository, "amend"),
  );
  assert.equal(refused.completion, "not-completed");
  assert.ok(
    refused.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_REQUIRED",
    ),
  );
});

test("atlas govern creates an Atlas Policy through one reviewable proposal with its verdict", () => {
  const repository = resolve(WORKSPACE, "create-policy");
  const mainBefore = initAtlasRepository(repository);
  const requestPath = resolve(WORKSPACE, "create-policy-request.json");
  writeFileSync(
    requestPath,
    JSON.stringify(policyRequest(repository, "pass", "agree")),
    "utf8",
  );

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    requestPath,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.success, command.stdout);
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.ok(result.payload.lint);
  assert.equal(result.payload.lint.payload.state, "completed");
  assert.equal(result.payload.lint.payload.lint.outcome, "valid");
  assert.equal(git(repository, ["rev-parse", "main"]), mainBefore);
  assert.match(
    git(repository, [
      "show",
      `${result.payload.workflowState.proposalBranch}:.atlas/types/policy/publication.md`,
    ]),
    /policy:publication/u,
  );
});

test("atlas govern refuses an Atlas Policy mutation that supplies no semantic verdict", () => {
  const repository = resolve(WORKSPACE, "policy-no-verdict");
  initAtlasRepository(repository);
  const requestPath = resolve(WORKSPACE, "policy-no-verdict-request.json");
  writeFileSync(
    requestPath,
    JSON.stringify(withoutSemanticVerdicts(policyRequest(repository, "pass", "agree"))),
    "utf8",
  );

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    requestPath,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.operationFailed);
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_POLICY_DOCTRINE_UNSUPPORTED",
  );
  assert.equal("lint" in result.payload, false);
});

test("atlas govern refuses an Atlas Policy mutation whose verdict misses a Policy target", () => {
  const repository = resolve(WORKSPACE, "policy-verdict-miss");
  initAtlasRepository(repository);
  const result = runLocalAtlasGovernance(
    repository,
    policyRequest(repository, "pass", "agree", "policy:unrelated"),
  );

  assert.equal(result.completion, "not-completed");
  const codes = result.handoff.validationState.findings.map((entry) => entry.code);
  assert.ok(codes.includes("ATLAS_GOVERNANCE_POLICY_VERDICT_MISSING"));
  assert.ok(codes.includes("ATLAS_GOVERNANCE_POLICY_VERDICT_UNMATCHED"));
  assert.equal(
    exitCodeForGovernOperationResult(result),
    governCommandExitCodes.operationFailed,
  );
});

test("atlas govern refuses a blank Maintainer approver as machine JSON", () => {
  const repository = resolve(WORKSPACE, "blank-approver");
  initAtlasRepository(repository);

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    fixtureJson("request-blank-approver.json"),
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.approvalRequired);
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_APPROVAL_REQUIRED",
  );
  assert.equal("changeSet" in result.payload, false);
});

test("atlas govern refuses a whitespace-only Maintainer approver", () => {
  const repository = resolve(WORKSPACE, "whitespace-approver");
  initAtlasRepository(repository);

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    fixtureJson("request-whitespace-approver.json"),
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.approvalRequired);
  assert.equal(
    parseGovernResult(command.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_APPROVAL_REQUIRED",
  );
});

test("atlas govern refuses an approval instant that is not a comparable date-time", () => {
  const repository = resolve(WORKSPACE, "bad-approved-at");
  initAtlasRepository(repository);
  // A non-blank approvedAt is not enough: a leap second and a date-only string
  // both pass the schema yet yield NaN from Date.parse, so an auditor ordering
  // or aging approvals would silently compare against a non-instant. The shared
  // one-rule gate (dateTimeMilliseconds) refuses both.
  for (const fixture of [
    "request-leap-second-approver.json",
    "request-date-only-approver.json",
  ]) {
    const command = runAtlas([
      "govern",
      "--machine",
      "--request",
      fixtureJson(fixture),
      "--atlas-host-directory",
      repository,
    ]);
    assert.equal(command.status, governCommandExitCodes.approvalRequired, fixture);
    assert.equal(
      parseGovernResult(command.stdout).handoff.validationState.findings[0]?.code,
      "ATLAS_GOVERNANCE_APPROVAL_REQUIRED",
      fixture,
    );
  }
});

test("atlas govern refuses to delete governance knowledge as a write primitive", () => {
  const repository = resolve(WORKSPACE, "delete-bypass");
  initAtlasRepository(repository);

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    fixtureJson("request-delete.json"),
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.operationFailed);
  assert.equal(
    parseGovernResult(command.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_DELETE_RETIRES_TRUTHS",
  );
});

test("atlas govern blocks a failing semantic Policy verdict without a proposal", () => {
  const repository = resolve(WORKSPACE, "fail-verdict");
  initAtlasRepository(repository);
  const requestPath = resolve(WORKSPACE, "fail-verdict-request.json");
  writeFileSync(
    requestPath,
    JSON.stringify(policyRequest(repository, "fail", "agree")),
    "utf8",
  );

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    requestPath,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.semanticVerdictFailed);
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_SEMANTIC_VERDICT_FAILED",
  );
  assert.equal("lint" in result.payload, false);
});

test("atlas govern escalates verdict and Challenge disagreement to a human", () => {
  const repository = resolve(WORKSPACE, "disagreement");
  initAtlasRepository(repository);
  const requestPath = resolve(WORKSPACE, "disagreement-request.json");
  writeFileSync(
    requestPath,
    JSON.stringify(policyRequest(repository, "pass", "disagree")),
    "utf8",
  );

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    requestPath,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.escalationRequired);
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "not-completed");
  assert.equal(result.handoff.unresolvedHumanDecisions.state, "pending");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_SEMANTIC_DISAGREEMENT",
  );
});

test("atlas govern reports argument, oversized, and malformed input as machine JSON", () => {
  const missingRequest = runAtlas(["govern", "--machine"]);
  assert.equal(missingRequest.status, governCommandExitCodes.usage);
  assert.equal(
    parseGovernResult(missingRequest.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_USAGE",
  );
  assert.match(missingRequest.stderr, /usage: atlas govern/u);

  for (const badArguments of [
    ["govern", "--request", fixtureJson("request-delete.json")],
    [
      "govern",
      "--machine",
      "--machine",
      "--request",
      fixtureJson("request-delete.json"),
    ],
    ["govern", "--machine", "--request"],
    ["govern", "--machine", "--request", "a.json", "--request", "b.json"],
    [
      "govern",
      "--machine",
      "--request",
      fixtureJson("request-delete.json"),
      "--atlas-host-directory",
    ],
    [
      "govern",
      "--machine",
      "--request",
      fixtureJson("request-delete.json"),
      "--atlas-host-directory",
      "x",
      "--atlas-host-directory",
      "y",
    ],
    ["govern", "--machine", "--unknown"],
  ]) {
    const usage = runAtlas(badArguments);
    assert.equal(usage.status, governCommandExitCodes.usage, badArguments.join(" "));
    assert.equal(
      parseGovernResult(usage.stdout).handoff.validationState.findings[0]?.code,
      "ATLAS_GOVERNANCE_USAGE",
    );
  }

  const malformed = runAtlas([
    "govern",
    "--machine",
    "--request",
    fixtureJson("request-malformed.json"),
    "--atlas-host-directory",
    ".",
  ]);
  assert.equal(malformed.status, governCommandExitCodes.usage);
  assert.equal(
    parseGovernResult(malformed.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_INPUT_INVALID",
  );

  const missingFile = runAtlas([
    "govern",
    "--machine",
    "--request",
    resolve(WORKSPACE, "no-such-request.json"),
  ]);
  assert.equal(missingFile.status, governCommandExitCodes.usage);
  assert.equal(
    parseGovernResult(missingFile.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_INPUT_INVALID",
  );

  const oversizedPath = resolve(WORKSPACE, "oversized-request.json");
  mkdirSync(WORKSPACE, { recursive: true });
  writeFileSync(
    oversizedPath,
    `{"padding":"${"x".repeat(governCommandInputBudgets.maxFileBytes)}"}`,
    "utf8",
  );
  const oversized = runAtlas(["govern", "--machine", "--request", oversizedPath]);
  assert.equal(oversized.status, governCommandExitCodes.usage);
  assert.equal(
    parseGovernResult(oversized.stdout).handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_INPUT_TOO_LARGE",
  );
});

test("Local Atlas Governance refuses capture failures and unsafe workspace paths", () => {
  const request = amendBaseRequest();
  const missing = runLocalAtlasGovernance(
    resolve(WORKSPACE, "missing-repository"),
    request,
  );
  assert.equal(missing.completion, "not-completed");
  assert.equal(
    missing.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_CAPTURE_FAILED",
  );
  assert.equal(
    exitCodeForGovernOperationResult(missing),
    governCommandExitCodes.operationNotCompleted,
  );
  assert.throws(() =>
    createLocalAtlasGovernanceState(resolve(WORKSPACE, "missing-repository"), request),
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
  assert.throws(() => createLocalAtlasGovernanceState(largeRepository, request));
  assert.equal(
    runLocalAtlasGovernance(largeRepository, request).handoff.validationState
      .findings[0]?.code,
    "ATLAS_GOVERNANCE_CAPTURE_FAILED",
  );

  const repository = resolve(WORKSPACE, "symlink-workspace");
  const outside = resolve(WORKSPACE, "symlink-outside");
  initAtlasRepository(repository);
  const validRequest = amendPrincipleRequest(repository);
  const state = createLocalAtlasGovernanceState(repository, validRequest);
  rmSync(outside, { force: true, recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, resolve(repository, ".atlas-operation-workspaces"));

  const refused = runLocalAtlasGovernance(repository, validRequest);

  assert.equal(refused.completion, "not-completed");
  assert.equal(
    refused.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_WORKSPACE_PATH_INVALID",
  );
  assert.equal(existsSync(resolve(outside, state.proposalBranch, ".atlas")), false);
});

// A request whose approval and structure are valid but which adds a page that
// fails Lint, so the proposal is refused only after the worktree is created.
function amendWithLintFailureRequest(repository: string): AtlasGovernanceRequest {
  const valid = amendPrincipleRequest(repository);
  const changeSet = valid.changeSet;
  if (changeSet === undefined) throw new Error("amend request must carry a change set");
  return {
    ...valid,
    changeSet: {
      ...changeSet,
      changes: [
        ...changeSet.changes,
        { content: "not a page, no frontmatter\n", path: ".atlas/concepts/broken.md" },
      ],
    },
  };
}

test("Local Atlas Governance tears down a failed proposal so a corrected retry at the same HEAD succeeds", () => {
  const repository = resolve(WORKSPACE, "retry-after-failure");
  const mainBefore = initAtlasRepository(repository);

  const failing = runLocalAtlasGovernance(
    repository,
    amendWithLintFailureRequest(repository),
  );
  assert.equal(failing.completion, "not-completed");
  const branch = failing.payload.workflowState.proposalBranch;
  // The failed attempt left neither the branch nor the Operation Workspace behind.
  assert.equal(git(repository, ["branch", "--list", branch]), "");
  assert.equal(
    existsSync(resolve(repository, ".atlas-operation-workspaces", branch)),
    false,
  );

  // The corrected retry targets the same deterministic branch and now succeeds
  // instead of wedging on ATLAS_GOVERNANCE_WORKSPACE_EXISTS.
  const corrected = runLocalAtlasGovernance(
    repository,
    amendPrincipleRequest(repository),
  );
  assert.equal(corrected.completion, "completed");
  assert.equal(corrected.disposition, "success");
  assert.equal(corrected.payload.workflowState.proposalBranch, branch);
  assert.equal(git(repository, ["rev-parse", "main"]), mainBefore);
});

test("Local Atlas Governance preserves an existing Operation Workspace", () => {
  const repository = resolve(WORKSPACE, "existing-workspace");
  initAtlasRepository(repository);
  rmSync(resolve(repository, ".git", "info", "exclude"), { force: true });
  const request = amendPrincipleRequest(repository);
  const first = runLocalAtlasGovernance(repository, request);
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

  const second = runLocalAtlasGovernance(repository, request);

  assert.equal(second.completion, "not-completed");
  assert.equal(
    second.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_WORKSPACE_EXISTS",
  );
  assert.equal(readFileSync(sentinel, "utf8"), "SENTINEL: human review notes\n");
});

// A minimal amend request that never reaches Lint; used only to exercise the
// platform adapter's capture and workspace guards.
function amendBaseRequest(): AtlasGovernanceRequest {
  return {
    "governance-request-schema": "1.0.0",
    action: "amend",
    approvedAt: "2026-08-22T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    subject: "principle",
  };
}

test("atlas govern refuses to establish a Principle without Maintainer approval even with a valid change set", () => {
  const repository = resolve(WORKSPACE, "no-approval-establish");
  const mainBefore = initAtlasRepository(repository);
  // An otherwise-valid amend whose Maintainer approval metadata is absent
  // entirely. If any seam self-approved on the agent's behalf, the operation
  // would proceed and commit a proposal; it must refuse and mutate nothing.
  const approved = amendPrincipleRequest(repository);
  const request: Record<string, unknown> = { ...approved };
  delete request["approvedBy"];
  delete request["approvedAt"];
  const requestPath = resolve(WORKSPACE, "no-approval-request.json");
  writeFileSync(requestPath, JSON.stringify(request), "utf8");

  const command = runAtlas([
    "govern",
    "--machine",
    "--request",
    requestPath,
    "--atlas-host-directory",
    repository,
  ]);

  assert.equal(command.status, governCommandExitCodes.approvalRequired);
  const result = parseGovernResult(command.stdout);
  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_APPROVAL_REQUIRED",
  );
  assert.equal(git(repository, ["rev-parse", "main"]), mainBefore);
  assert.equal(git(repository, ["branch", "--list", "atlas-governance-*"]), "");
});

test("Governance command helpers preserve machine JSON and every exit class", () => {
  const repository = resolve(WORKSPACE, "helpers");
  initAtlasRepository(repository);

  const success = runLocalAtlasGovernance(
    repository,
    amendPrincipleRequest(repository),
  );
  assert.equal(
    exitCodeForGovernOperationResult(success),
    governCommandExitCodes.success,
  );

  const failVerdict = runLocalAtlasGovernance(
    repository,
    policyRequest(repository, "fail", "agree"),
  );
  assert.equal(
    exitCodeForGovernOperationResult(failVerdict),
    governCommandExitCodes.semanticVerdictFailed,
  );

  const disagreement = runLocalAtlasGovernance(
    repository,
    policyRequest(repository, "pass", "disagree"),
  );
  assert.equal(
    exitCodeForGovernOperationResult(disagreement),
    governCommandExitCodes.escalationRequired,
  );

  const capture = notCompletedLocalGovernanceResult("reason", "summary");
  assert.equal(
    exitCodeForGovernOperationResult(capture),
    governCommandExitCodes.operationNotCompleted,
  );

  const usage = usageGovernOperationResult("bad arguments");
  assert.equal(serializeGovernMachineResult(usage), `${JSON.stringify(usage)}\n`);
  assert.equal(exitCodeForGovernOperationResult(usage), governCommandExitCodes.usage);
  assert.equal(
    exitCodeForGovernOperationResult(invalidInputGovernOperationResult("bad input")),
    governCommandExitCodes.usage,
  );
  assert.equal(
    exitCodeForGovernOperationResult(oversizedInputGovernOperationResult("too big")),
    governCommandExitCodes.usage,
  );
});

test("Governance request parser refuses every malformed axis as a determinate value", () => {
  assert.equal(parseGovernRequest(null).ok, false);
  assert.equal(parseGovernRequest([]).ok, false);
  assert.equal(parseGovernRequest({}).ok, false);

  const base = {
    "governance-request-schema": "1.0.0",
    action: "create",
    subject: "principle",
  };
  assert.equal(parseGovernRequest(base).ok, true);

  const badCases: readonly unknown[] = [
    { ...base, "governance-request-schema": "2.0.0" },
    { ...base, action: "establish" },
    { ...base, action: 7 },
    { ...base, subject: "region" },
    { ...base, approvedBy: 42 },
    { ...base, approvedBy: "x".repeat(governCommandInputBudgets.maxStringBytes + 1) },
    { ...base, changeSet: [] },
    { ...base, changeSet: { baseSnapshotDigest: "d", targetHead: "t", changes: {} } },
    {
      ...base,
      changeSet: {
        baseSnapshotDigest: "d",
        targetHead: "t",
        changes: Array.from(
          { length: governCommandInputBudgets.maxChanges + 1 },
          () => ({ content: "c", path: ".atlas/x.md" }),
        ),
      },
    },
    {
      ...base,
      changeSet: {
        baseSnapshotDigest: "d",
        targetHead: "t",
        changes: [
          {
            content: "x".repeat(governCommandInputBudgets.maxChangeContentBytes + 1),
            path: ".atlas/x.md",
          },
        ],
      },
    },
    {
      ...base,
      changeSet: {
        baseSnapshotDigest: "d",
        targetHead: "t",
        changes: [
          {
            content: "c",
            path: "x".repeat(governCommandInputBudgets.maxPathBytes + 1),
          },
        ],
      },
    },
    { ...base, changeSet: { baseSnapshotDigest: "d", targetHead: "t", changes: [42] } },
    { ...base, semanticVerdicts: {} },
    {
      ...base,
      semanticVerdicts: Array.from(
        { length: governCommandInputBudgets.maxSemanticVerdicts + 1 },
        () => ({
          challenge: { argument: "a", evidence: [], position: "agree" },
          evidence: [],
          policyId: "policy:x",
          verdict: "pass",
        }),
      ),
    },
    {
      ...base,
      semanticVerdicts: [
        {
          challenge: { argument: "a", evidence: [], position: "maybe" },
          evidence: [],
          policyId: "policy:x",
          verdict: "pass",
        },
      ],
    },
    {
      ...base,
      semanticVerdicts: [
        {
          challenge: { argument: "a", evidence: [], position: "agree" },
          evidence: [],
          policyId: "policy:x",
          verdict: "maybe",
        },
      ],
    },
    {
      ...base,
      semanticVerdicts: [
        {
          challenge: {
            argument: "a",
            evidence: Array.from(
              { length: governCommandInputBudgets.maxEvidencePerList + 1 },
              () => ".atlas/index.md#L1",
            ),
            position: "agree",
          },
          evidence: [],
          policyId: "policy:x",
          verdict: "pass",
        },
      ],
    },
  ];
  for (const badCase of badCases) {
    assert.equal(
      parseGovernRequest(badCase).ok,
      false,
      JSON.stringify(badCase).slice(0, 80),
    );
  }

  const wellFormed = parseGovernRequest({
    ...base,
    action: "amend",
    subject: "atlas-policy",
    approvedAt: "2026-08-22T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    changeSet: {
      baseSnapshotDigest: "d",
      targetHead: "t",
      changes: [{ content: "c", path: ".atlas/types/policy/x.md" }],
    },
    semanticVerdicts: [
      {
        challenge: {
          argument: "a",
          evidence: [".atlas/index.md#L1"],
          position: "disagree",
        },
        evidence: [".atlas/index.md#L1"],
        policyId: "policy:x",
        verdict: "fail",
      },
    ],
  });
  assert.equal(wellFormed.ok, true);
});

after(() => {
  rmSync(WORKSPACE, { force: true, recursive: true });
});
