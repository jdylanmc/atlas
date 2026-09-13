import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AtlasReadinessReport } from "../src/operations/initialize_operation.ts";
import type { InitializationArtifactConflict } from "./initialization_artifact_probes.ts";

interface InstalledConsumerCase {
  readonly name: string;
  readonly gate: "installed-consumer";
  readonly expectation: "accept";
  readonly query: string;
  readonly expectedRootAnchorId: string;
  readonly expectedAtlasPaths: readonly string[];
  readonly unmergedLintCode: string;
  readonly readinessArtifacts?: {
    readonly headings: readonly string[];
    readonly governance: string;
    readonly enrichedReport: Pick<
      AtlasReadinessReport,
      "capabilities" | "unresolvedDecisions"
    >;
    readonly enrichedMarkdown: readonly string[];
    readonly conflicts: readonly InitializationArtifactConflict[];
  };
  readonly ingestPlan?: readonly (
    | {
        readonly expectation: "accept";
        readonly scopeFixture: string;
        readonly expectedAssignment: Readonly<Record<string, unknown>>;
      }
    | {
        readonly expectation: "reject";
        readonly scopeFixture: string;
        readonly expectedExit: number;
        readonly expectedCode: string;
      }
  )[];
  readonly governance?: {
    readonly change: { readonly path: string; readonly content: string };
    readonly expectedCodes: readonly string[];
  };
}

interface InstalledConsumerCorpus {
  readonly schema: 1;
  readonly reviewResolutionRule: string;
  readonly cases: readonly InstalledConsumerCase[];
}

export function readInstalledConsumerCorpus(): InstalledConsumerCorpus {
  const corpus = JSON.parse(
    readFileSync(
      new URL("./adversarial/installed-consumer.json", import.meta.url),
      "utf8",
    ),
  ) as InstalledConsumerCorpus;
  assert.equal(corpus.schema, 1);
  assert.match(corpus.reviewResolutionRule, /review finding/u);
  assert.equal(Array.isArray(corpus.cases), true);
  assert.ok(corpus.cases.length > 0);
  assert.equal(new Set(corpus.cases.map(({ name }) => name)).size, corpus.cases.length);
  for (const entry of corpus.cases) {
    assert.equal(entry.gate, "installed-consumer");
    assert.equal(entry.expectation, "accept");
    for (const value of [
      entry.name,
      entry.query,
      entry.expectedRootAnchorId,
      entry.unmergedLintCode,
    ]) {
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0);
    }
    assert.equal(Array.isArray(entry.expectedAtlasPaths), true);
    assert.ok(entry.expectedAtlasPaths.length > 0);
    for (const path of entry.expectedAtlasPaths) {
      assert.equal(typeof path, "string");
      assert.match(path, /^\.atlas\//u);
    }
    if (entry.readinessArtifacts !== undefined) {
      assert.ok(entry.readinessArtifacts.headings.length > 0);
      for (const heading of entry.readinessArtifacts.headings) {
        assert.match(heading, /^##? /u);
      }
      assert.ok(entry.readinessArtifacts.governance.length > 0);
      assert.ok(Array.isArray(entry.readinessArtifacts.enrichedReport.capabilities));
      assert.ok(
        Array.isArray(entry.readinessArtifacts.enrichedReport.unresolvedDecisions),
      );
      assert.ok(entry.readinessArtifacts.enrichedMarkdown.length > 0);
      assert.ok(entry.readinessArtifacts.conflicts.length > 0);
      for (const probe of entry.readinessArtifacts.conflicts) {
        assert.ok(["lintStamp", "readinessReportMarkdown"].includes(probe.artifact));
        assert.ok(
          [
            "same-length",
            "short",
            "long",
            "directory",
            "symlink",
            "parent-symlink",
          ].includes(probe.kind),
        );
      }
    }
    if (entry.ingestPlan !== undefined) {
      assert.equal(Array.isArray(entry.ingestPlan), true);
      assert.ok(entry.ingestPlan.length > 0);
      for (const probe of entry.ingestPlan) {
        assert.match(probe.scopeFixture, /^scope-[a-z-]+\.json$/u);
        if (probe.expectation === "accept") {
          assert.equal(typeof probe.expectedAssignment, "object");
          assert.notEqual(probe.expectedAssignment, null);
          assert.equal(Array.isArray(probe.expectedAssignment), false);
        } else {
          assert.equal(probe.expectation, "reject");
          assert.ok(Number.isInteger(probe.expectedExit) && probe.expectedExit > 0);
          assert.match(probe.expectedCode, /^ATLAS_[A-Z_]+$/u);
        }
      }
    }
    if (entry.governance !== undefined) {
      assert.equal(typeof entry.governance.change.content, "string");
      assert.match(entry.governance.change.path, /^\.atlas\//u);
      assert.equal(Array.isArray(entry.governance.expectedCodes), true);
      assert.ok(entry.governance.expectedCodes.length > 0);
      for (const code of entry.governance.expectedCodes) {
        assert.match(code, /^ATLAS_[A-Z_]+$/u);
      }
    }
  }
  return corpus;
}
