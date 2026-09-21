import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export interface ProposalWorkspaceFilterCase {
  readonly expectation: "accept";
  readonly filterMode: "process" | "smudge";
  readonly finding: string;
  readonly gate: "proposal-workspace";
  readonly kind: "filter-free-completion";
  readonly name: string;
  readonly operation: "governance";
}

export interface ProposalWorkspaceRebaseCase {
  readonly expectation: "accept";
  readonly finding: string;
  readonly gate: "proposal-workspace";
  readonly kind: "rebase-completion";
  readonly name: string;
  readonly operation: "ingest" | "initialization";
}

export interface ProposalWorkspaceOwnershipConflictCase {
  readonly conflict: {
    readonly content: string;
    readonly kind: "file" | "parent";
    readonly path: string;
  };
  readonly expectation: "reject";
  readonly expectedCode:
    | "ATLAS_GOVERNANCE_RUNTIME_FAILED"
    | "ATLAS_INGEST_RUNTIME_FAILED"
    | "ATLAS_INITIALIZATION_RUNTIME_FAILED";
  readonly finding: "BALERION-87-R2-01" | "BOLAS-87-R2-01";
  readonly gate: "proposal-workspace";
  readonly kind: "ownership-conflict";
  readonly name: string;
  readonly operation: "governance" | "ingest" | "initialization";
}

export interface ProposalWorkspaceGitlinkCase {
  readonly expectation: "accept";
  readonly finding: "BALERION-87-R2-02";
  readonly gate: "proposal-workspace";
  readonly kind: "gitlink-rebase-completion";
  readonly name: string;
  readonly operation: "governance" | "ingest";
}

export interface ProposalWorkspaceRetryCase {
  readonly expectation: "accept";
  readonly finding: "BOLAS-87-R2-02";
  readonly gate: "proposal-workspace";
  readonly kind: "retry-after-owned-failure";
  readonly name: string;
  readonly operation: "ingest";
}

export type ProposalWorkspaceCase =
  | ProposalWorkspaceFilterCase
  | ProposalWorkspaceGitlinkCase
  | ProposalWorkspaceOwnershipConflictCase
  | ProposalWorkspaceRebaseCase
  | ProposalWorkspaceRetryCase;

export interface ProposalWorkspaceCorpus {
  readonly cases: readonly ProposalWorkspaceCase[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): string {
  const field = value[key];
  assert.ok(typeof field === "string", `${path}.${key} must be a string`);
  return field;
}

export function readProposalWorkspaceCorpus(): ProposalWorkspaceCorpus {
  const value = JSON.parse(
    readFileSync(
      new URL("./adversarial/proposal-workspace.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  assert.ok(isRecord(value), "proposal workspace corpus must be an object");
  assert.equal(value["schema"], 1);
  const reviewResolutionRule = requiredString(
    value,
    "reviewResolutionRule",
    "proposalWorkspace",
  );
  assert.ok(Array.isArray(value["cases"]));
  const names = new Set<string>();
  const cases = value["cases"].map(
    (candidate: unknown, index: number): ProposalWorkspaceCase => {
      const path = `proposalWorkspace.cases[${String(index)}]`;
      assert.ok(isRecord(candidate), `${path} must be an object`);
      const name = requiredString(candidate, "name", path);
      const finding = requiredString(candidate, "finding", path);
      assert.equal(names.has(name), false, `${path}.name must be unique`);
      names.add(name);
      assert.equal(candidate["gate"], "proposal-workspace");
      if (candidate["kind"] === "filter-free-completion") {
        assert.equal(candidate["operation"], "governance");
        assert.equal(candidate["expectation"], "accept");
        assert.ok(
          candidate["filterMode"] === "smudge" || candidate["filterMode"] === "process",
        );
        return {
          expectation: "accept",
          filterMode: candidate["filterMode"],
          finding,
          gate: "proposal-workspace",
          kind: "filter-free-completion",
          name,
          operation: "governance",
        };
      }
      if (candidate["kind"] === "rebase-completion") {
        assert.ok(
          candidate["operation"] === "ingest" ||
            candidate["operation"] === "initialization",
        );
        assert.equal(candidate["expectation"], "accept");
        return {
          expectation: "accept",
          finding,
          gate: "proposal-workspace",
          kind: "rebase-completion",
          name,
          operation: candidate["operation"],
        };
      }
      if (candidate["kind"] === "gitlink-rebase-completion") {
        assert.ok(
          candidate["operation"] === "governance" ||
            candidate["operation"] === "ingest",
        );
        assert.equal(candidate["expectation"], "accept");
        assert.equal(finding, "BALERION-87-R2-02");
        return {
          expectation: "accept",
          finding: "BALERION-87-R2-02",
          gate: "proposal-workspace",
          kind: "gitlink-rebase-completion",
          name,
          operation: candidate["operation"],
        };
      }
      if (candidate["kind"] === "ownership-conflict") {
        assert.ok(
          candidate["operation"] === "governance" ||
            candidate["operation"] === "ingest" ||
            candidate["operation"] === "initialization",
        );
        assert.equal(candidate["expectation"], "reject");
        assert.equal(
          finding,
          candidate["operation"] === "initialization"
            ? "BOLAS-87-R2-01"
            : "BALERION-87-R2-01",
        );
        assert.ok(isRecord(candidate["conflict"]));
        const conflictPath = `${path}.conflict`;
        const kind = requiredString(candidate["conflict"], "kind", conflictPath);
        assert.ok(kind === "file" || kind === "parent");
        const expectedCode = requiredString(candidate, "expectedCode", path);
        assert.ok(
          expectedCode === "ATLAS_GOVERNANCE_RUNTIME_FAILED" ||
            expectedCode === "ATLAS_INGEST_RUNTIME_FAILED" ||
            expectedCode === "ATLAS_INITIALIZATION_RUNTIME_FAILED",
        );
        return {
          conflict: {
            content: requiredString(candidate["conflict"], "content", conflictPath),
            kind,
            path: requiredString(candidate["conflict"], "path", conflictPath),
          },
          expectation: "reject",
          expectedCode,
          finding:
            candidate["operation"] === "initialization"
              ? "BOLAS-87-R2-01"
              : "BALERION-87-R2-01",
          gate: "proposal-workspace",
          kind: "ownership-conflict",
          name,
          operation: candidate["operation"],
        };
      }
      assert.equal(candidate["kind"], "retry-after-owned-failure");
      assert.equal(candidate["operation"], "ingest");
      assert.equal(candidate["expectation"], "accept");
      assert.equal(finding, "BOLAS-87-R2-02");
      return {
        expectation: "accept",
        finding: "BOLAS-87-R2-02",
        gate: "proposal-workspace",
        kind: "retry-after-owned-failure",
        name,
        operation: "ingest",
      };
    },
  );
  return Object.freeze({
    cases: Object.freeze(cases),
    reviewResolutionRule,
    schema: 1,
  });
}
