import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  governanceAttestationOperation,
  governanceAttestationPayload,
  type AtlasGovernanceRequest,
  type AtlasGovernanceResult,
} from "../src/operations/governance_operation.ts";
import { attestationPayloadDigest } from "../src/operations/operation_support.ts";
import { parseMachineOperationResult } from "./machine_operation_result.ts";

export interface GovernanceRetirementProbe {
  readonly action: "retire" | "delete";
  readonly subject: "principle" | "atlas-policy";
  readonly fixture: string;
  readonly path: string;
  readonly reason: string;
  readonly expectedApprover: string;
  readonly expectedApprovalDate: string;
  readonly semanticVerdicts?: AtlasGovernanceRequest["semanticVerdicts"];
  readonly dependency?: {
    readonly governor: string;
    readonly documentId: string;
    readonly expectedCode: string;
    readonly expectedFindings: readonly {
      readonly path: string;
      readonly count: number;
    }[];
  };
}

export function exerciseGovernanceRetirement(
  repository: string,
  probe: GovernanceRetirementProbe,
  run: (arguments_: readonly string[]) => {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
  },
): void {
  const git = (args: readonly string[]): string =>
    execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  const original = readFileSync(
    new URL(`./fixtures/governance/${probe.fixture}`, import.meta.url),
    "utf8",
  );
  const target = join(repository, probe.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, original, { flag: "wx" });
  git(["add", "--", probe.path]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Establish fixture governance",
  ]);
  let before = git(["rev-parse", "HEAD"]).trim();
  const baseLint = run(["lint", "--machine", "--atlas-host-directory", repository]);
  assert.equal(baseLint.status, 0, baseLint.stdout);
  const beforeChangelog = readFileSync(join(repository, ".atlas/CHANGELOG.md"), "utf8");
  const fields = {
    "governance-request-schema": "1.0.0" as const,
    action: probe.action,
    subject: probe.subject,
    changes: [{ path: probe.path, content: null }],
    changelog: probe.reason,
    ...(probe.semanticVerdicts === undefined
      ? {}
      : { semanticVerdicts: probe.semanticVerdicts }),
  };
  const operation = governanceAttestationOperation(fields);
  const nonce = `fixture-retirement-${probe.subject}-${probe.action}`;
  const request = {
    ...fields,
    attestation: {
      "approval-attestation-schema": "1.0.0",
      approvedAt: `${probe.expectedApprovalDate}T00:00:00Z`,
      approver: probe.expectedApprover,
      nonce,
      operation,
      payloadDigest: attestationPayloadDigest(
        operation,
        nonce,
        governanceAttestationPayload(fields),
      ),
    },
  };
  const inputDirectory = mkdtempSync(join(dirname(repository), "retirement-input-"));
  const inputPath = join(inputDirectory, "request.json");
  try {
    writeFileSync(inputPath, JSON.stringify(request));
    if (probe.dependency !== undefined) {
      const dependentPaths: string[] = [];
      for (const [fixture, path] of [
        ["retirement-dependent-concept.md", ".atlas/concepts/retirement-dependent.md"],
        ["retirement-dependent-edge.md", ".atlas/edges/retirement-dependent.md"],
        [
          "retirement-dependent-principle.md",
          ".atlas/principles/retirement-dependent.md",
        ],
        ["retirement-evidence.md", ".atlas/sources/retirement-evidence.md"],
      ] as const) {
        const content = readFileSync(
          new URL(`./fixtures/governance/${fixture}`, import.meta.url),
          "utf8",
        )
          .replaceAll("{governor}", probe.dependency.governor)
          .replace("{document-id}", probe.dependency.documentId)
          .replace("{document-path}", probe.path.slice(0, -3))
          .replace("{relative-path}", `../${probe.path.slice(".atlas/".length)}`);
        const absolute = join(repository, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, { flag: "wx" });
        dependentPaths.push(path);
      }
      git(["add", "--", ...dependentPaths]);
      git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "Establish fixture dependency",
      ]);
      before = git(["rev-parse", "HEAD"]).trim();
      const validDependency = run([
        "lint",
        "--machine",
        "--atlas-host-directory",
        repository,
      ]);
      assert.equal(validDependency.status, 0, validDependency.stdout);
      const refused = run([
        "govern",
        "--machine",
        "--atlas-host-directory",
        repository,
        "--request",
        inputPath,
      ]);
      assert.equal(refused.status, 1, refused.stdout);
      const refusal = parseMachineOperationResult(
        refused.stdout,
      ) as AtlasGovernanceResult;
      assert.equal(refusal.completion, "not-completed");
      for (const { path, count } of probe.dependency.expectedFindings) {
        assert.equal(
          refusal.handoff.validationState.findings.filter(
            (entry) =>
              entry.code === probe.dependency?.expectedCode && entry.path === path,
          ).length,
          count,
          path,
        );
      }
      assert.equal(git(["rev-parse", "HEAD"]).trim(), before);
      assert.equal(readFileSync(target, "utf8"), original);
      assert.equal(git(["branch", "--list", "atlas-governance-*"]).trim(), "");
      for (const path of dependentPaths) unlinkSync(join(repository, path));
      git(["add", "-u", "--", ...dependentPaths]);
      git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "Reconcile obsolete fixture dependency",
      ]);
      before = git(["rev-parse", "HEAD"]).trim();
    }
    const retired = run([
      "govern",
      "--machine",
      "--atlas-host-directory",
      repository,
      "--request",
      inputPath,
    ]);
    assert.equal(retired.status, 0, retired.stdout);
    assert.equal(retired.stderr, "");
    const result = parseMachineOperationResult(retired.stdout) as AtlasGovernanceResult;
    assert.equal(result.completion, "completed");
    const branch = result.payload.workflowState.proposalBranch;
    const proposal = git(["rev-parse", branch]).trim();
    assert.equal(git(["rev-parse", "HEAD"]).trim(), before);
    assert.equal(readFileSync(target, "utf8"), original);
    assert.deepEqual(
      git(["diff", "--name-status", before, proposal]).trim().split("\n"),
      ["M\t.atlas/CHANGELOG.md", `D\t${probe.path}`],
    );
    assert.equal(
      lstatSync(join(repository, ".atlas-operation-workspaces", branch, probe.path), {
        throwIfNoEntry: false,
      }),
      undefined,
      "the retired document must not remain in the proposal worktree",
    );
    assert.equal(git(["show", `${proposal}^:${probe.path}`]), original);
    const history = git(["show", `${proposal}:.atlas/CHANGELOG.md`]);
    for (const text of [
      beforeChangelog.trim(),
      probe.path,
      probe.reason,
      JSON.stringify(probe.expectedApprover),
      probe.expectedApprovalDate,
      result.payload.workflowState.operationId,
    ])
      assert.ok(history.includes(text), text);
    assert.deepEqual(
      result.payload.changeSet?.changes.find((change) => change.path === probe.path),
      { content: null, path: probe.path },
    );
    const repeated = run([
      "govern",
      "--machine",
      "--atlas-host-directory",
      repository,
      "--request",
      inputPath,
    ]);
    assert.equal(repeated.status, 1, repeated.stdout);
    const repeatResult = parseMachineOperationResult(
      repeated.stdout,
    ) as AtlasGovernanceResult;
    assert.equal(repeatResult.completion, "not-completed");
    assert.ok(
      repeatResult.handoff.validationState.findings.some(
        ({ code }) => code === "ATLAS_GOVERNANCE_WORKSPACE_EXISTS",
      ),
    );
    assert.equal(git(["rev-parse", branch]).trim(), proposal);
    assert.equal(git(["show", `${proposal}:.atlas/CHANGELOG.md`]), history);
    assert.equal(readFileSync(target, "utf8"), original);
  } finally {
    unlinkSync(inputPath);
    rmdirSync(inputDirectory);
  }
}
