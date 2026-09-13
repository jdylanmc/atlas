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
  readonly wrongPolicyVerdict?: string;
  readonly opaqueExamples?: {
    readonly governor: string;
    readonly documentId: string;
  };
  readonly dependency?: {
    readonly kind?: "edge" | "metadata" | "prose";
    readonly survivingPrinciple?: boolean;
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
  const opaqueExamples = probe.opaqueExamples;
  const preservedOpaque =
    opaqueExamples === undefined
      ? []
      : [
          {
            fixture: "retirement-dependent-concept.md",
            path: ".atlas/notes/concepts/not-a-page.md",
          },
          {
            fixture: "retirement-dependent-edge.md",
            path: ".atlas/notes/edges/not-a-page.md",
          },
        ].map(({ fixture, path }) => ({
          path,
          content: readFileSync(
            new URL(`./fixtures/governance/${fixture}`, import.meta.url),
            "utf8",
          )
            .replaceAll("{governor}", opaqueExamples.governor)
            .replace("{document-id}", opaqueExamples.documentId),
        }));
  for (const example of preservedOpaque) {
    const path = join(repository, example.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, example.content, { flag: "wx" });
  }
  git(["add", "--", probe.path, ...preservedOpaque.map(({ path }) => path)]);
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
  let survivor: { readonly path: string; readonly content: string } | undefined;
  try {
    writeFileSync(inputPath, JSON.stringify(request));
    if (probe.wrongPolicyVerdict !== undefined) {
      const wrongPolicyVerdict = probe.wrongPolicyVerdict;
      // Keep these fixtures sensitive to the replaced raw-text identity shortcut.
      assert.equal(/^\s*id:\s*([^\s]+)\s*$/mu.exec(original)?.[1], wrongPolicyVerdict);
      assert.ok(fields.semanticVerdicts !== undefined);
      const wrongFields = {
        ...fields,
        semanticVerdicts: fields.semanticVerdicts.map((verdict) => ({
          ...verdict,
          policyId: wrongPolicyVerdict,
        })),
      };
      const wrongRequest = {
        ...wrongFields,
        attestation: {
          ...request.attestation,
          payloadDigest: attestationPayloadDigest(
            operation,
            nonce,
            governanceAttestationPayload(wrongFields),
          ),
        },
      };
      writeFileSync(inputPath, JSON.stringify(wrongRequest));
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
      for (const code of [
        "ATLAS_GOVERNANCE_POLICY_VERDICT_MISSING",
        "ATLAS_GOVERNANCE_POLICY_VERDICT_UNMATCHED",
      ]) {
        assert.ok(
          refusal.handoff.validationState.findings.some((entry) => entry.code === code),
          refused.stdout,
        );
      }
      assert.deepEqual(refusal.payload.workflowState.effectReceipts, []);
      assert.equal(git(["rev-parse", "HEAD"]).trim(), before);
      assert.equal(readFileSync(target, "utf8"), original);
      assert.equal(git(["branch", "--list", "atlas-governance-*"]).trim(), "");
      writeFileSync(inputPath, JSON.stringify(request));
    }
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
        if (
          (probe.dependency.kind !== undefined &&
            path.startsWith(".atlas/principles/")) ||
          (probe.dependency.kind === "edge" && path.startsWith(".atlas/concepts/"))
        )
          continue;
        let content = readFileSync(
          new URL(`./fixtures/governance/${fixture}`, import.meta.url),
          "utf8",
        )
          .replaceAll("{governor}", probe.dependency.governor)
          .replace(
            "{document-id}",
            probe.dependency.kind === "metadata" || probe.dependency.kind === "prose"
              ? "concept:retirement-dependent"
              : probe.dependency.documentId,
          )
          .replace("{document-path}", probe.path.slice(0, -3))
          .replace("{relative-path}", `../${probe.path.slice(".atlas/".length)}`);
        if (probe.dependency.kind !== undefined) {
          content = content.replace(
            "from: concept:retirement-dependent",
            "from: anchor:root",
          );
        }
        if (probe.dependency.kind === "metadata") {
          content = content.replace(
            `This claim is an accepted Contradiction of ${probe.dependency.governor}.\n`,
            "",
          );
        } else if (probe.dependency.kind === "prose") {
          content = content.replace(
            `atlas:\n  contradicts: "${probe.dependency.governor}"`,
            "atlas: {}",
          );
        }
        const absolute = join(repository, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, { flag: "wx" });
        dependentPaths.push(path);
      }
      if (probe.dependency.survivingPrinciple === true) {
        survivor = {
          path: ".atlas/principles/retirement-survivor.md",
          content: readFileSync(
            new URL(
              "./fixtures/governance/retirement-surviving-principle.md",
              import.meta.url,
            ),
            "utf8",
          ).replace("{governor}", probe.dependency.governor),
        };
        mkdirSync(dirname(join(repository, survivor.path)), { recursive: true });
        writeFileSync(join(repository, survivor.path), survivor.content, {
          flag: "wx",
        });
        git(["add", "--", survivor.path]);
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
    for (const example of preservedOpaque) {
      assert.equal(git(["show", `${proposal}:${example.path}`]), example.content);
      assert.equal(
        readFileSync(join(repository, example.path), "utf8"),
        example.content,
      );
    }
    if (survivor !== undefined) {
      assert.equal(git(["show", `${proposal}:${survivor.path}`]), survivor.content);
      assert.equal(
        readFileSync(join(repository, survivor.path), "utf8"),
        survivor.content,
      );
    }
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
