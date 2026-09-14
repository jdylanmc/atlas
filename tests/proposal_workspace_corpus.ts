import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export interface ProposalWorkspaceFilterCase {
  readonly expectation: "accept";
  readonly filterMode: "process" | "smudge";
  readonly gate: "proposal-workspace";
  readonly kind: "filter-free-completion";
  readonly name: string;
  readonly operation: "governance";
}

export interface ProposalWorkspaceRebaseCase {
  readonly expectation: "accept";
  readonly gate: "proposal-workspace";
  readonly kind: "rebase-completion";
  readonly name: string;
  readonly operation: "ingest";
}

export type ProposalWorkspaceCase =
  ProposalWorkspaceFilterCase | ProposalWorkspaceRebaseCase;

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
      assert.equal(names.has(name), false, `${path}.name must be unique`);
      names.add(name);
      assert.equal(candidate["gate"], "proposal-workspace");
      assert.equal(candidate["expectation"], "accept");
      if (candidate["kind"] === "filter-free-completion") {
        assert.equal(candidate["operation"], "governance");
        assert.ok(
          candidate["filterMode"] === "smudge" || candidate["filterMode"] === "process",
        );
        return {
          expectation: "accept",
          filterMode: candidate["filterMode"],
          gate: "proposal-workspace",
          kind: "filter-free-completion",
          name,
          operation: "governance",
        };
      }
      assert.equal(candidate["kind"], "rebase-completion");
      assert.equal(candidate["operation"], "ingest");
      return {
        expectation: "accept",
        gate: "proposal-workspace",
        kind: "rebase-completion",
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
