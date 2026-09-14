import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AtlasReadinessReport } from "../src/operations/initialize_operation.ts";
import type { InitializationArtifactConflict } from "./initialization_artifact_probes.ts";
import type { GovernanceRetirementProbe } from "./governance_retirement_probe.ts";
import type { AtlasIngestSourceProbeRequest } from "../src/operations/ingest_operation.ts";

interface InstalledConsumerCase {
  readonly name: string;
  readonly gate: "installed-consumer";
  readonly expectation: "accept";
  readonly query: string;
  readonly expectedRootAnchorId: string;
  readonly expectedAtlasPaths: readonly string[];
  readonly unmergedLintCode: string;
  readonly trackingProbe?: {
    readonly request: AtlasIngestSourceProbeRequest;
    readonly expectedPaths: readonly string[];
    readonly expectedTrackedId: string;
    readonly rejections: readonly {
      readonly name: string;
      readonly overrides: Readonly<Record<string, unknown>>;
      readonly expectedExit: number;
      readonly expectedCodes: readonly string[];
    }[];
  };
  readonly providerInvocation?: {
    readonly expectedProviderCalls: number;
    readonly expectedResultId: string;
    readonly rejectedObjectId: string;
  };
  readonly connectedExplore?: {
    readonly query: string;
    readonly expectedConceptId: string;
    readonly expectedSourceId: string;
    readonly expectedSourceText: string;
    readonly expectedTrackedSlug: string;
    readonly cleanupFailureCode?: string;
  };
  readonly cacheFailure?: {
    readonly mode:
      | "missing-atlas"
      | "uncapturable-update"
      | "interrupted-first-contact"
      | "unrecorded-publication"
      | "invalid-lock-on-update"
      | "first-metadata-cleanup"
      | "first-metadata-cleanup-discarded"
      | "lock-persistence";
    readonly expectedCode: string;
  };
  readonly citationCorrespondence?: {
    readonly claim: string;
    readonly context: string;
    readonly expectedClaimFragments: readonly string[];
    readonly expectedContextFragments: readonly string[];
    readonly expectedTamperCode: string;
    readonly quotations: readonly string[];
    readonly sourceContent: string;
  };
  readonly retirement?: GovernanceRetirementProbe;
  readonly repeatedEmptyEdges?: {
    readonly alternatingPairs: number;
    readonly maxRawBytes: number;
    readonly maxHeapMiB: number;
    readonly expectedFields: readonly string[];
  };
  readonly inputContracts?: readonly {
    readonly name:
      "ingest-scope" | "ingest-request" | "ingest-source-probe" | "governance-request";
    readonly arguments: readonly string[];
    readonly input: unknown;
    readonly expectedPaths: readonly string[];
    readonly expectedCodes: readonly string[];
    readonly expectedRequired: readonly string[];
  }[];
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
  readonly governanceTreeReceipt?: boolean;
  readonly isolatedPackPreservesProducerOutput?: boolean;
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
    if (entry.isolatedPackPreservesProducerOutput !== undefined) {
      assert.equal(entry.isolatedPackPreservesProducerOutput, true);
    }
    for (const path of entry.expectedAtlasPaths) {
      assert.equal(typeof path, "string");
      assert.match(path, /^\.atlas\//u);
    }
    if (entry.trackingProbe !== undefined) {
      const probe = entry.trackingProbe;
      for (const value of Object.values(probe.request)) {
        assert.ok(typeof value === "string");
        assert.ok(value.trim().length > 0);
      }
      assert.equal(probe.expectedPaths.length, 2);
      assert.match(probe.expectedTrackedId, /^tracked-atlas:/u);
      for (const path of probe.expectedPaths) assert.match(path, /^\.atlas\/.*\.md$/u);
      assert.ok(probe.rejections.length > 0);
      for (const rejection of probe.rejections) {
        assert.equal(typeof rejection.name, "string");
        assert.ok(
          Number.isInteger(rejection.expectedExit) && rejection.expectedExit > 0,
        );
        assert.equal(typeof rejection.overrides, "object");
        assert.notEqual(rejection.overrides, null);
        assert.ok(rejection.expectedCodes.length > 0);
        for (const code of rejection.expectedCodes)
          assert.match(code, /^ATLAS_[A-Z_]+$/u);
      }
    }
    if (entry.providerInvocation !== undefined) {
      assert.equal(
        Number.isSafeInteger(entry.providerInvocation.expectedProviderCalls),
        true,
      );
      assert.ok(entry.providerInvocation.expectedProviderCalls > 0);
      assert.match(entry.providerInvocation.expectedResultId, /^[a-z-]+:/u);
      assert.match(entry.providerInvocation.rejectedObjectId, /^[a-z-]+:/u);
    }
    if (entry.connectedExplore !== undefined) {
      for (const value of Object.values(entry.connectedExplore)) {
        assert.equal(typeof value, "string");
        assert.ok(value.length > 0);
      }
      if (entry.connectedExplore.cleanupFailureCode !== undefined) {
        assert.match(entry.connectedExplore.cleanupFailureCode, /^ATLAS_[A-Z_]+$/u);
      }
    }
    if (entry.cacheFailure !== undefined) {
      assert.ok(
        [
          "missing-atlas",
          "uncapturable-update",
          "interrupted-first-contact",
          "unrecorded-publication",
          "invalid-lock-on-update",
          "first-metadata-cleanup",
          "first-metadata-cleanup-discarded",
          "lock-persistence",
        ].includes(entry.cacheFailure.mode),
      );
      assert.match(entry.cacheFailure.expectedCode, /^ATLAS_[A-Z_]+$/u);
    }
    if (entry.citationCorrespondence !== undefined) {
      for (const value of [
        entry.citationCorrespondence.claim,
        entry.citationCorrespondence.context,
        entry.citationCorrespondence.expectedTamperCode,
        entry.citationCorrespondence.sourceContent,
      ]) {
        assert.equal(typeof value, "string");
        assert.ok(value.length > 0);
      }
      assert.match(entry.citationCorrespondence.expectedTamperCode, /^ATLAS_[A-Z_]+$/u);
      assert.equal(entry.citationCorrespondence.quotations.length, 2);
      for (const quotation of entry.citationCorrespondence.quotations) {
        assert.equal(typeof quotation, "string");
        assert.ok(quotation.length > 0);
      }
      for (const fragments of [
        entry.citationCorrespondence.expectedClaimFragments,
        entry.citationCorrespondence.expectedContextFragments,
      ]) {
        assert.ok(fragments.length > 0);
        for (const fragment of fragments) {
          assert.equal(typeof fragment, "string");
          assert.ok(fragment.length > 0);
        }
      }
    }
    if (entry.retirement !== undefined) {
      assert.ok(["retire", "delete"].includes(entry.retirement.action));
      assert.ok(["principle", "atlas-policy"].includes(entry.retirement.subject));
      assert.match(entry.retirement.fixture, /^retirement-[a-z-]+\.md$/u);
      assert.match(entry.retirement.path, /^\.atlas\//u);
      assert.ok(entry.retirement.reason.length > 0);
      assert.ok(entry.retirement.expectedApprover.length > 0);
      assert.match(entry.retirement.expectedApprovalDate, /^\d{4}-\d{2}-\d{2}$/u);
      if (entry.retirement.dependency !== undefined) {
        assert.ok(
          entry.retirement.dependency.kind === undefined ||
            ["edge", "metadata", "prose"].includes(entry.retirement.dependency.kind),
        );
        if (entry.retirement.dependency.survivingPrinciple !== undefined)
          assert.equal(
            typeof entry.retirement.dependency.survivingPrinciple,
            "boolean",
          );
        assert.ok(entry.retirement.dependency.governor.length > 0);
        assert.ok(entry.retirement.dependency.documentId.length > 0);
        assert.match(entry.retirement.dependency.expectedCode, /^ATLAS_[A-Z_]+$/u);
        assert.ok(entry.retirement.dependency.expectedFindings.length > 0);
        for (const finding of entry.retirement.dependency.expectedFindings) {
          assert.match(finding.path, /^\.atlas\//u);
          assert.ok(Number.isInteger(finding.count) && finding.count > 0);
        }
      }
      if (entry.retirement.semanticVerdicts !== undefined) {
        assert.ok(Array.isArray(entry.retirement.semanticVerdicts));
        assert.ok(entry.retirement.semanticVerdicts.length > 0);
      }
      if (entry.retirement.wrongPolicyVerdict !== undefined) {
        assert.equal(entry.retirement.subject, "atlas-policy");
        assert.ok(entry.retirement.wrongPolicyVerdict.length > 0);
        assert.ok(entry.retirement.semanticVerdicts !== undefined);
      }
      if (entry.retirement.opaqueExamples !== undefined) {
        assert.ok(entry.retirement.opaqueExamples.governor.length > 0);
        assert.ok(entry.retirement.opaqueExamples.documentId.length > 0);
      }
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
    if (entry.governanceTreeReceipt !== undefined) {
      assert.equal(entry.governanceTreeReceipt, true);
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
        if (entry.inputContracts !== undefined) {
          assert.ok(entry.inputContracts.length > 0);
          for (const probe of entry.inputContracts) {
            assert.ok(
              [
                "ingest-scope",
                "ingest-request",
                "ingest-source-probe",
                "governance-request",
              ].includes(probe.name),
            );
            assert.ok(Object.hasOwn(probe, "input"));
            for (const values of [
              probe.arguments,
              probe.expectedPaths,
              probe.expectedCodes,
              probe.expectedRequired,
            ]) {
              assert.ok(Array.isArray(values) && values.length > 0);
              for (const value of values) assert.equal(typeof value, "string");
            }
            if (entry.repeatedEmptyEdges !== undefined) {
              assert.equal(entry.repeatedEmptyEdges.alternatingPairs, 40_000);
              assert.equal(entry.repeatedEmptyEdges.maxRawBytes, 1_048_576);
              assert.equal(entry.repeatedEmptyEdges.maxHeapMiB, 256);
              assert.ok(entry.repeatedEmptyEdges.expectedFields.length > 0);
              for (const field of entry.repeatedEmptyEdges.expectedFields)
                assert.equal(typeof field, "string");
            }
          }
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
