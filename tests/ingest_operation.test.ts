import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import type { Finding } from "../src/domain/finding.ts";
import {
  atlasIngestChangeSetDigest,
  isSafeGitBranchName,
  reconcileCandidateGraph,
  runAtlasIngestWorkflow,
  sourceRevisionDigest,
  validateAtlasIngestChangeSet,
  validateCandidateGraph,
  validateCitationCorrespondence,
  type AtlasIngestCandidateConcept,
  type AtlasIngestCandidateEdge,
  type AtlasIngestCandidateGraph,
  type AtlasIngestCandidateSource,
  type AtlasIngestChangeSet,
  type AtlasIngestEffectReceipt,
  type AtlasIngestRequest,
  type AtlasIngestRuntime,
  type AtlasIngestScope,
  type AtlasIngestWorkflowState,
} from "../src/operations/ingest_operation.ts";
import { runLintOperation } from "../src/operations/lint_operation.ts";

const budgets = Object.freeze({ maxFileBytes: 8192, maxTotalBytes: 262_144 });
const encoder = new TextEncoder();

const ingestCorpus = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "adversarial", "ingest.json"), "utf8"),
) as {
  readonly cases: readonly {
    readonly expectedCode: string;
    readonly gate: "ingest";
    readonly kind: string;
    readonly name: string;
  }[];
  readonly reviewResolutionRule: string;
  readonly schema: 1;
};

function page(
  path: string,
  id: string,
  type: string,
  title: string,
  atlasBlock: string,
  body: string,
): CapturedAtlasFile {
  return {
    bytes: encoder.encode(
      [
        "---",
        "sdk:",
        "  atlas-sdk-schema: 1.0.0",
        '  created-at: "2026-08-17T00:00:00Z"',
        "  created-by:",
        "    kind: human",
        "    name: Fixture Author",
        `  id: ${id}`,
        "  local-atlas-schema: 1.0.0",
        "  tags: []",
        `  title: ${title}`,
        `  type: ${type}`,
        '  updated-at: "2026-08-17T00:00:00Z"',
        "  updated-by:",
        "    kind: human",
        "    name: Fixture Author",
        atlasBlock,
        "---",
        "",
        body,
      ].join("\n"),
    ),
    path,
  };
}

const rootAnchor = page(
  ".atlas/index.md",
  "anchor:root",
  "anchor",
  "Home",
  "atlas: {}",
  "# Home\n",
);
const changelog: CapturedAtlasFile = {
  bytes: encoder.encode("# Changelog\n\n## 2026-08-17\n\n- Base.\n"),
  path: ".atlas/CHANGELOG.md",
};
const existingSource = page(
  ".atlas/sources/handbook.md",
  "source:handbook",
  "source",
  "Handbook",
  "atlas:\n  authority: official",
  "# Handbook\n\nThe Handbook explains reconciliation is deterministic.\n",
);
const determinismPrinciple = page(
  ".atlas/principles/determinism.md",
  "principle:determinism",
  "principle",
  "Determinism",
  "atlas: {}",
  "# Determinism\n\n## Active truths\n\n- `truth:no-model` Atlas SDK never invokes a model.\n\n## Amendments\n\n### 1 - 2026-08-17\n\nAdded `truth:no-model`.\n",
);

const publicationPolicy = page(
  ".atlas/types/policy/publication.md",
  "policy:publication",
  "policy",
  "Publication Policy",
  "atlas:\n  scope: publication\n  evaluation: deterministic\n  consequence: block-operation",
  "# Publication Policy\n\nGoverns publication.\n",
);

const baseFilesDefault = Object.freeze([rootAnchor, changelog]);

function scope(overrides: Partial<AtlasIngestScope> = {}): AtlasIngestScope {
  return Object.freeze({
    "ingest-scope-schema": "1.0.0",
    approvedAt: "2026-08-22T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    asOf: "2026-08-22T00:00:00Z",
    authority: "official",
    entryPoint: "docs",
    excludedPaths: Object.freeze(["docs/private"]),
    freshnessWindowDays: 30,
    includedPaths: Object.freeze(["docs"]),
    maxDepth: 4,
    sourceId: "source:readme",
    ...overrides,
  });
}

const sourceContent =
  "Atlas SDK is a deterministic library. The Lint gate runs with no network access.";

function source(
  overrides: Partial<AtlasIngestCandidateSource> = {},
): AtlasIngestCandidateSource {
  return Object.freeze({
    authority: "official",
    content: sourceContent,
    id: "source:readme",
    locator: "docs/readme.md",
    refreshWindowDays: 30,
    revisionTime: "2026-08-20T00:00:00Z",
    title: "Readme",
    ...overrides,
  });
}

function concept(
  overrides: Partial<AtlasIngestCandidateConcept> = {},
): AtlasIngestCandidateConcept {
  return Object.freeze({
    citations: Object.freeze([
      {
        sourceClaim: "Atlas SDK is a deterministic library.",
        sourceId: "source:readme",
      },
    ]),
    claim: "Atlas SDK is a deterministic library.",
    id: "concept:determinism",
    locator: "docs/readme.md",
    title: "Determinism",
    ...overrides,
  });
}

function edge(
  overrides: Partial<AtlasIngestCandidateEdge> = {},
): AtlasIngestCandidateEdge {
  return Object.freeze({
    citations: Object.freeze([
      {
        sourceClaim: "The Lint gate runs with no network access.",
        sourceId: "source:readme",
      },
    ]),
    context: "Entering the Home Atlas leads to the determinism Concept.",
    from: "anchor:root",
    id: "edge:root-covers-determinism",
    semantics: Object.freeze(["covers"]),
    title: "Root Covers Determinism",
    to: "concept:determinism",
    ...overrides,
  });
}

function graph(
  overrides: Partial<AtlasIngestCandidateGraph> = {},
): AtlasIngestCandidateGraph {
  return Object.freeze({
    "candidate-graph-schema": "1.0.0",
    concepts: Object.freeze([concept()]),
    disputes: Object.freeze([]),
    edges: Object.freeze([edge()]),
    sources: Object.freeze([source()]),
    ...overrides,
  });
}

function request(overrides: Partial<AtlasIngestRequest> = {}): AtlasIngestRequest {
  return Object.freeze({
    "ingest-request-schema": "1.0.0",
    candidateGraph: graph(),
    scope: scope(),
    ...overrides,
  });
}

function state(
  receipts: readonly AtlasIngestEffectReceipt[] = Object.freeze([]),
): AtlasIngestWorkflowState {
  return Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    baseSnapshotDigest: "base-digest",
    effectReceipts: receipts,
    operationId: "ingest-op-81",
    proposalBranch: "feat/issue-81-ingest",
    targetBranch: "main",
    targetHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
}

function applyChanges(
  files: readonly CapturedAtlasFile[],
  changeSet: AtlasIngestChangeSet | undefined,
): readonly CapturedAtlasFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const change of changeSet?.changes ?? []) {
    byPath.set(change.path, {
      bytes: encoder.encode(change.content),
      path: change.path,
    });
  }
  return Object.freeze([...byPath.values()]);
}

interface RuntimeOptions {
  readonly baseFiles?: readonly CapturedAtlasFile[];
  readonly commit?: string;
  readonly currentBaseSnapshotDigest?: string;
  readonly currentTargetHead?: string;
  readonly failCreate?: true;
  readonly lintReceipt?: string;
  readonly lintUsesEmptyAtlas?: true;
  readonly workspaceExists?: boolean;
  readonly workspacePathValid?: boolean;
}

function runtime(
  workflowState: AtlasIngestWorkflowState,
  ingestRequest: AtlasIngestRequest,
  options: RuntimeOptions = {},
): AtlasIngestRuntime & {
  readonly counts: {
    readonly committed: () => number;
    readonly created: () => number;
    readonly linted: () => number;
    readonly written: () => number;
  };
} {
  let created = 0;
  let written = 0;
  let committed = 0;
  let linted = 0;
  let captured: AtlasIngestChangeSet | undefined;
  const commit = options.commit ?? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const baseFiles = options.baseFiles ?? baseFilesDefault;
  return {
    commitProposal: () => {
      committed += 1;
      return { commit, receipt: commit };
    },
    counts: {
      committed: () => committed,
      created: () => created,
      linted: () => linted,
      written: () => written,
    },
    createProposalWorktree: () => {
      created += 1;
      if (options.failCreate === true) throw new Error("create failed");
      return { receipt: "created" };
    },
    currentBaseSnapshotDigest: () =>
      options.currentBaseSnapshotDigest ?? workflowState.baseSnapshotDigest,
    currentTargetHead: () => options.currentTargetHead ?? workflowState.targetHead,
    existingAtlasFiles: () => baseFiles,
    lintProposal: () => {
      linted += 1;
      const changeSet =
        captured ?? reconcileCandidateGraph(workflowState, ingestRequest);
      const lintFiles =
        options.lintUsesEmptyAtlas === true ? [] : applyChanges(baseFiles, changeSet);
      return {
        lint: runLintOperation(lintFiles, budgets),
        receipt: options.lintReceipt ?? commit,
      };
    },
    workspaceExists: () => options.workspaceExists ?? false,
    workspacePathValid: () => options.workspacePathValid ?? true,
    writeChangeSet: (changeSet: AtlasIngestChangeSet) => {
      written += 1;
      captured = changeSet;
      return { receipt: "written" };
    },
  };
}

function codes(findings: readonly Finding[]): readonly string[] {
  return findings.map((entry) => entry.code);
}

test("Ingest produces one Linted proposal with cited Source and derived knowledge", () => {
  const workflowState = state();
  const ingestRequest = request();
  const adapter = runtime(workflowState, ingestRequest);
  const result = runAtlasIngestWorkflow(workflowState, ingestRequest, adapter);

  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.operation.kind, "ingest");
  assert.equal(result.operation.subject, "repository-source");
  const changeSet = result.payload.changeSet;
  assert.ok(changeSet);
  const paths = changeSet.changes.map((change) => change.path);
  assert.deepEqual(paths, [
    ".atlas/CHANGELOG.md",
    ".atlas/concepts/determinism.md",
    ".atlas/edges/root-covers-determinism.md",
    ".atlas/sources/readme.md",
  ]);
  const sourcePage = changeSet.changes.find(
    (change) => change.path === ".atlas/sources/readme.md",
  );
  assert.ok(sourcePage);
  assert.match(sourcePage.content, /authority: official/u);
  assert.match(
    sourcePage.content,
    new RegExp(`revision: ${sourceRevisionDigest(sourceContent)}`, "u"),
  );
  assert.match(sourcePage.content, /revision-time: "2026-08-20T00:00:00Z"/u);
  assert.equal(result.handoff.validationState.state, "passed");
  assert.equal(result.handoff.unresolvedHumanDecisions.state, "none");
  assert.equal(result.handoff.degradationState.state, "not-degraded");
  assert.equal(adapter.counts.created(), 1);
  assert.equal(adapter.counts.written(), 1);
  assert.equal(adapter.counts.committed(), 1);
  assert.equal(adapter.counts.linted(), 1);
});

test("reconciliation is deterministic: the same validated graph reconciles to the same bytes", () => {
  const workflowState = state();
  const ingestRequest = request();
  assert.deepEqual(
    reconcileCandidateGraph(workflowState, ingestRequest),
    reconcileCandidateGraph(workflowState, ingestRequest),
  );
});

test("A citation whose quote is absent from the cited Source revision is rejected", () => {
  const withEdgeToSelf = graph({
    concepts: Object.freeze([
      concept({
        citations: Object.freeze([
          { sourceClaim: "This sentence never appears.", sourceId: "source:readme" },
        ]),
      }),
    ]),
  });
  const findings = validateCandidateGraph(
    request({ candidateGraph: withEdgeToSelf }),
    baseFilesDefault,
  );
  assert.ok(codes(findings).includes("ATLAS_INGEST_CITATION_UNSUPPORTED"));
});

test("A citation to a supported claim in an existing Home Atlas Source is accepted", () => {
  const conceptCitingExisting = concept({
    citations: Object.freeze([
      {
        sourceClaim: "The Handbook explains reconciliation is deterministic.",
        sourceId: "source:handbook",
      },
    ]),
  });
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({ concepts: Object.freeze([conceptCitingExisting]) }),
    }),
    [rootAnchor, changelog, existingSource],
  );
  assert.deepEqual(
    codes(findings).filter((code) => code.startsWith("ATLAS_INGEST_CITATION")),
    [],
  );
});

test("A citation to a Source absent from graph and Home Atlas is rejected", () => {
  const conceptCitingGhost = concept({
    citations: Object.freeze([
      { sourceClaim: "Anything at all.", sourceId: "source:ghost" },
    ]),
  });
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({ concepts: Object.freeze([conceptCitingGhost]) }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(findings).includes("ATLAS_INGEST_CITATION_SOURCE_MISSING"));
});

test("Empty citation quote is unsupported even when the Source resolves", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({
            citations: Object.freeze([
              { sourceClaim: "  ", sourceId: "source:readme" },
            ]),
          }),
        ]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(findings).includes("ATLAS_INGEST_CITATION_UNSUPPORTED"));
});

test("A Concept with no Edge is unreachable and rejected", () => {
  const findings = validateCandidateGraph(
    request({ candidateGraph: graph({ edges: Object.freeze([]) }) }),
    baseFilesDefault,
  );
  assert.ok(codes(findings).includes("ATLAS_INGEST_CONCEPT_UNREACHABLE"));
});

test("A Concept with no claim and no citation is rejected on both counts", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({ citations: Object.freeze([]), claim: "   " }),
        ]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(findings).includes("ATLAS_INGEST_CONCEPT_CLAIM_REQUIRED"));
  assert.ok(codes(findings).includes("ATLAS_INGEST_CONCEPT_UNCITED"));
});

test("Non-canonical page identities are rejected for Source, Concept, and Edge", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([concept({ id: "concept:Not Valid" })]),
        edges: Object.freeze([edge({ id: "not-an-edge" })]),
        sources: Object.freeze([source({ id: "readme" })]),
      }),
    }),
    baseFilesDefault,
  );
  const reported = codes(findings);
  assert.ok(reported.includes("ATLAS_INGEST_SOURCE_ID_INVALID"));
  assert.ok(reported.includes("ATLAS_INGEST_CONCEPT_ID_INVALID"));
  assert.ok(reported.includes("ATLAS_INGEST_EDGE_ID_INVALID"));
});

test("Duplicate identities within one Candidate Graph are rejected", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([concept(), concept()]),
        edges: Object.freeze([edge(), edge()]),
        sources: Object.freeze([source(), source()]),
      }),
    }),
    baseFilesDefault,
  );
  const reported = codes(findings);
  assert.ok(reported.includes("ATLAS_INGEST_SOURCE_ID_DUPLICATE"));
  assert.ok(reported.includes("ATLAS_INGEST_CONCEPT_ID_DUPLICATE"));
  assert.ok(reported.includes("ATLAS_INGEST_EDGE_ID_DUPLICATE"));
  assert.ok(reported.includes("ATLAS_INGEST_EDGE_PAIR_DUPLICATE"));
});

test("Source content and revision-time defects are rejected", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        sources: Object.freeze([
          source({ content: "   ", revisionTime: "not-a-date" }),
        ]),
      }),
    }),
    baseFilesDefault,
  );
  const reported = codes(findings);
  assert.ok(reported.includes("ATLAS_INGEST_SOURCE_CONTENT_REQUIRED"));
  assert.ok(reported.includes("ATLAS_INGEST_SOURCE_REVISION_TIME_INVALID"));
});

test("An empty Candidate Graph records no Source and is rejected", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([]),
        edges: Object.freeze([]),
        sources: Object.freeze([]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(findings).includes("ATLAS_INGEST_SOURCE_REQUIRED"));
});

test("Invalid Ingest Scope timestamps are rejected before emission", () => {
  const badApproval = validateCandidateGraph(
    request({ scope: scope({ approvedAt: "not-a-date" }) }),
    baseFilesDefault,
  );
  assert.ok(codes(badApproval).includes("ATLAS_INGEST_APPROVAL_REQUIRED"));

  const badAsOf = validateCandidateGraph(
    request({ scope: scope({ asOf: "not-a-date" }) }),
    baseFilesDefault,
  );
  assert.ok(codes(badAsOf).includes("ATLAS_INGEST_SCOPE_AS_OF_INVALID"));
});

test("An unrecognized Source Authority class in the Ingest Scope is rejected", () => {
  const findings = validateCandidateGraph(
    request({ scope: scope({ authority: "rumor" as AtlasIngestScope["authority"] }) }),
    baseFilesDefault,
  );
  assert.ok(codes(findings).includes("ATLAS_INGEST_SCOPE_AUTHORITY_INVALID"));
});

test("Edge endpoint, self-loop, semantics, and Source-connection rules are enforced", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        edges: Object.freeze([
          edge({
            from: "anchor:root",
            id: "edge:root-covers-determinism",
            semantics: Object.freeze([]),
            to: "concept:determinism",
          }),
          edge({
            citations: [
              {
                sourceClaim: "The Lint gate runs with no network access.",
                sourceId: "source:readme",
              },
            ],
            from: "concept:missing",
            id: "edge:dangling",
            to: "source:readme",
          }),
          edge({
            from: "concept:determinism",
            id: "edge:loop",
            to: "concept:determinism",
          }),
        ]),
      }),
    }),
    baseFilesDefault,
  );
  const reported = codes(findings);
  assert.ok(reported.includes("ATLAS_INGEST_EDGE_SEMANTICS_REQUIRED"));
  assert.ok(reported.includes("ATLAS_INGEST_EDGE_ENDPOINT_MISSING"));
  assert.ok(reported.includes("ATLAS_INGEST_EDGE_CONNECTS_SOURCE"));
  assert.ok(reported.includes("ATLAS_INGEST_EDGE_SELF_LOOP"));
});

test("A crawled candidate beyond the approved Ingest Scope pauses for approval", () => {
  const workflowState = state();
  const ingestRequest = request({
    candidateGraph: graph({
      concepts: Object.freeze([concept({ locator: "docs/private/secret.md" })]),
    }),
  });
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest),
  );
  assert.equal(result.completion, "not-completed");
  assert.ok(
    codes(result.handoff.validationState.findings).includes(
      "ATLAS_INGEST_SCOPE_EXPANSION_PENDING",
    ),
  );
  assert.equal(result.handoff.unresolvedHumanDecisions.state, "pending");
});

test("Scope excluded regions, depth, and non-inclusion each fall outside scope", () => {
  const excluded = validateCandidateGraph(
    request({
      candidateGraph: graph({
        sources: Object.freeze([source({ locator: "docs/private/secret.md" })]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(excluded).includes("ATLAS_INGEST_SCOPE_EXPANSION_PENDING"));

  const tooDeep = validateCandidateGraph(
    request({
      candidateGraph: graph({
        sources: Object.freeze([source({ locator: "docs/a/b/c/d/deep.md" })]),
      }),
      scope: scope({ maxDepth: 2 }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(tooDeep).includes("ATLAS_INGEST_SCOPE_EXPANSION_PENDING"));

  const notIncluded = validateCandidateGraph(
    request({
      candidateGraph: graph({
        sources: Object.freeze([source({ locator: "elsewhere/readme.md" })]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(notIncluded).includes("ATLAS_INGEST_SCOPE_EXPANSION_PENDING"));
});

test("A malformed locator is rejected rather than paused", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([concept({ locator: "../escape.md" })]),
        sources: Object.freeze([source({ locator: "/abs.md" })]),
      }),
    }),
    baseFilesDefault,
  );
  assert.equal(
    codes(findings).filter((code) => code === "ATLAS_INGEST_LOCATOR_INVALID").length,
    2,
  );
});

test("An accepted Contradiction of an active Principle truth is admitted and marked", () => {
  const contradicting = concept({
    contradiction: {
      acceptedBy: "Fixture Maintainer",
      principleTruthId: "truth:no-model",
    },
  });
  const workflowState = state();
  const ingestRequest = request({
    candidateGraph: graph({ concepts: Object.freeze([contradicting]) }),
  });
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest, {
      baseFiles: [rootAnchor, changelog, determinismPrinciple],
    }),
  );
  assert.equal(result.completion, "completed");
  const conceptPage = result.payload.changeSet?.changes.find(
    (change) => change.path === ".atlas/concepts/determinism.md",
  );
  assert.ok(conceptPage);
  assert.match(conceptPage.content, /contradicts: truth:no-model/u);
  assert.match(conceptPage.content, /accepted Contradiction of truth:no-model/u);
});

test("A Contradiction blocks until accepted and must name a real Principle truth", () => {
  const unaccepted = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({ contradiction: { principleTruthId: "truth:no-model" } }),
        ]),
      }),
    }),
    [rootAnchor, changelog, determinismPrinciple],
  );
  assert.ok(codes(unaccepted).includes("ATLAS_INGEST_CONTRADICTION_UNACCEPTED"));

  const unresolved = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({
            contradiction: { acceptedBy: "M", principleTruthId: "truth:ghost" },
          }),
        ]),
      }),
    }),
    [rootAnchor, changelog, determinismPrinciple],
  );
  assert.ok(codes(unresolved).includes("ATLAS_INGEST_CONTRADICTION_UNRESOLVED"));
});

test("A Contradiction may name an Atlas Policy, but not both governors or none", () => {
  const acceptedPolicy = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({
            contradiction: { acceptedBy: "M", atlasPolicyId: "policy:publication" },
          }),
        ]),
      }),
    }),
    [rootAnchor, changelog, publicationPolicy],
  );
  assert.deepEqual(acceptedPolicy, []);

  const unacceptedPolicy = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({ contradiction: { atlasPolicyId: "policy:publication" } }),
        ]),
      }),
    }),
    [rootAnchor, changelog, publicationPolicy],
  );
  assert.ok(codes(unacceptedPolicy).includes("ATLAS_INGEST_CONTRADICTION_UNACCEPTED"));

  const missingPolicy = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({
            contradiction: { acceptedBy: "M", atlasPolicyId: "policy:ghost" },
          }),
        ]),
      }),
    }),
    [rootAnchor, changelog, publicationPolicy],
  );
  assert.ok(codes(missingPolicy).includes("ATLAS_INGEST_CONTRADICTION_UNRESOLVED"));

  const bothGovernors = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({
            contradiction: {
              acceptedBy: "M",
              atlasPolicyId: "policy:publication",
              principleTruthId: "truth:no-model",
            },
          }),
        ]),
      }),
    }),
    [rootAnchor, changelog, determinismPrinciple, publicationPolicy],
  );
  assert.ok(codes(bothGovernors).includes("ATLAS_INGEST_CONTRADICTION_UNRESOLVED"));

  const noGovernor = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([concept({ contradiction: { acceptedBy: "M" } })]),
      }),
    }),
    [rootAnchor, changelog],
  );
  assert.ok(codes(noGovernor).includes("ATLAS_INGEST_CONTRADICTION_UNRESOLVED"));
});

test("A page whose frontmatter cannot be safely emitted fails as a typed value", () => {
  const workflowState = state();
  const ingestRequest = request({
    candidateGraph: graph({
      concepts: Object.freeze([concept({ title: "" })]),
    }),
  });
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest),
  );
  assert.equal(result.completion, "not-completed");
  assert.ok(
    codes(result.handoff.validationState.findings).includes(
      "ATLAS_INGEST_PAGE_EMISSION_INVALID",
    ),
  );
});

test("Reconciliation records a Source Refresh when the Source already exists", () => {
  const existing = [
    rootAnchor,
    changelog,
    page(
      ".atlas/sources/readme.md",
      "source:readme",
      "source",
      "Readme",
      "atlas:\n  authority: official",
      "# Readme\n",
    ),
  ];
  const changeSet = reconcileCandidateGraph(state(), request(), existing);
  const entry = changeSet.changes.find(
    (change) => change.path === ".atlas/CHANGELOG.md",
  );
  assert.ok(entry);
  assert.match(entry.content, /Refreshed source:readme/u);
});

test("A locator carrying a control character is not a canonical path", () => {
  const findings = validateCandidateGraph(
    request({
      candidateGraph: graph({
        sources: Object.freeze([source({ locator: "docs/read\nme.md" })]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(findings).includes("ATLAS_INGEST_LOCATOR_INVALID"));
});

test("A Source Refresh reusing the scope's Source id is not a collision", () => {
  const existing = [
    rootAnchor,
    changelog,
    page(
      ".atlas/sources/readme.md",
      "source:readme",
      "source",
      "Readme",
      "atlas:\n  authority: official",
      "# Readme\n",
    ),
  ];
  const findings = validateCandidateGraph(request(), existing);
  assert.equal(codes(findings).includes("ATLAS_INGEST_ID_COLLISION"), false);
});

test("An accepted Atlas Policy Contradiction is emitted onto the Concept page", () => {
  const changeSet = reconcileCandidateGraph(
    state(),
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({
            contradiction: { acceptedBy: "M", atlasPolicyId: "policy:publication" },
          }),
        ]),
      }),
    }),
  );
  const conceptChange = changeSet.changes.find(
    (change) => change.path === ".atlas/concepts/determinism.md",
  );
  assert.ok(conceptChange);
  assert.match(conceptChange.content, /contradicts: policy:publication/u);
  assert.match(conceptChange.content, /accepted Contradiction of policy:publication/u);
});

test("Citation correspondence skips bad ids and missing pages and reads a bare body", () => {
  const stale = { baseSnapshotDigest: "b", changes: [], targetHead: "t" } as const;
  const badId = validateCitationCorrespondence(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([concept({ id: "badid" })]),
        edges: Object.freeze([]),
      }),
    }),
    stale,
  );
  assert.deepEqual(badId, []);

  const missingPage = validateCitationCorrespondence(request(), stale);
  assert.deepEqual(missingPage, []);

  const bareBody = validateCitationCorrespondence(request(), {
    baseSnapshotDigest: "b",
    changes: [
      {
        content: "no frontmatter, only [[.atlas/sources/readme]] mentioned in prose",
        path: ".atlas/concepts/determinism.md",
      },
    ],
    targetHead: "t",
  });
  assert.ok(codes(bareBody).includes("ATLAS_INGEST_CITATION_CORRESPONDENCE"));
});

test("Disputes settle by Source Authority and by Source Revision Time, else escalate", () => {
  const twoConcepts = (
    leftSource: AtlasIngestCandidateSource,
    rightSource: AtlasIngestCandidateSource,
  ): AtlasIngestCandidateGraph =>
    graph({
      concepts: Object.freeze([
        concept({
          citations: Object.freeze([
            { sourceClaim: leftSource.content, sourceId: leftSource.id },
          ]),
          id: "concept:left",
          title: "Left",
        }),
        concept({
          citations: Object.freeze([
            { sourceClaim: rightSource.content, sourceId: rightSource.id },
          ]),
          id: "concept:right",
          title: "Right",
        }),
      ]),
      disputes: Object.freeze([
        { leftConceptId: "concept:left", rightConceptId: "concept:right" },
      ]),
      edges: Object.freeze([
        edge({ from: "anchor:root", id: "edge:a", to: "concept:left" }),
        edge({ from: "anchor:root", id: "edge:b", to: "concept:right" }),
      ]),
      sources: Object.freeze([leftSource, rightSource]),
    });

  const differentAuthority = twoConcepts(
    source({ authority: "official", content: "Official claim.", id: "source:left" }),
    source({ authority: "community", content: "Community claim.", id: "source:right" }),
  );
  assert.deepEqual(
    codes(
      validateCandidateGraph(
        request({ candidateGraph: differentAuthority }),
        baseFilesDefault,
      ),
    ).filter((code) => code.startsWith("ATLAS_INGEST_DISPUTE")),
    [],
  );

  const comparableTime = twoConcepts(
    source({
      authority: "official",
      content: "Older claim.",
      id: "source:left",
      revisionTime: "2026-08-01T00:00:00Z",
    }),
    source({
      authority: "official",
      content: "Newer claim.",
      id: "source:right",
      revisionTime: "2026-08-10T00:00:00Z",
    }),
  );
  assert.deepEqual(
    codes(
      validateCandidateGraph(
        request({ candidateGraph: comparableTime }),
        baseFilesDefault,
      ),
    ).filter((code) => code.startsWith("ATLAS_INGEST_DISPUTE")),
    [],
  );

  const tie = twoConcepts(
    source({
      authority: "official",
      content: "Left claim.",
      id: "source:left",
      revisionTime: "2026-08-05T00:00:00Z",
    }),
    source({
      authority: "official",
      content: "Right claim.",
      id: "source:right",
      revisionTime: "2026-08-05T00:00:00Z",
    }),
  );
  assert.ok(
    codes(
      validateCandidateGraph(request({ candidateGraph: tie }), baseFilesDefault),
    ).includes("ATLAS_INGEST_DISPUTE_UNRESOLVED"),
  );
});

test("A Dispute naming an absent Concept or an unresolvable Source is rejected", () => {
  const missingConcept = validateCandidateGraph(
    request({
      candidateGraph: graph({
        disputes: Object.freeze([
          { leftConceptId: "concept:determinism", rightConceptId: "concept:ghost" },
        ]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(missingConcept).includes("ATLAS_INGEST_DISPUTE_CONCEPT_MISSING"));

  const noSource = validateCandidateGraph(
    request({
      candidateGraph: graph({
        concepts: Object.freeze([
          concept({ citations: Object.freeze([]), id: "concept:left", title: "Left" }),
          concept({ id: "concept:right", title: "Right" }),
        ]),
        disputes: Object.freeze([
          { leftConceptId: "concept:left", rightConceptId: "concept:right" },
        ]),
        edges: Object.freeze([
          edge({ from: "anchor:root", id: "edge:a", to: "concept:left" }),
          edge({ from: "anchor:root", id: "edge:b", to: "concept:right" }),
        ]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(noSource).includes("ATLAS_INGEST_DISPUTE_CONCEPT_MISSING"));
});

test("Stale Knowledge surfaces as a non-blocking warning that completes the proposal", () => {
  const workflowState = state();
  const ingestRequest = request({
    candidateGraph: graph({
      sources: Object.freeze([source({ refreshWindowDays: 1 })]),
    }),
  });
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest),
  );
  assert.equal(result.completion, "completed");
  assert.ok(
    codes(result.handoff.validationState.findings).includes(
      "ATLAS_INGEST_SOURCE_STALE",
    ),
  );
  assert.equal(result.handoff.degradationState.state, "degraded");
  assert.equal(result.handoff.unresolvedHumanDecisions.state, "none");
});

test("Stale detection fails closed when timestamps are not comparable", () => {
  const badAsOf = validateCandidateGraph(
    request({ scope: scope({ asOf: "not-a-date" }) }),
    baseFilesDefault,
  );
  assert.ok(codes(badAsOf).includes("ATLAS_INGEST_SCOPE_AS_OF_INVALID"));

  const badRevision = validateCandidateGraph(
    request({
      candidateGraph: graph({
        sources: Object.freeze([source({ revisionTime: "not-a-date" })]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(badRevision).includes("ATLAS_INGEST_SOURCE_REVISION_TIME_INVALID"));

  const badRevisionAndId = validateCandidateGraph(
    request({
      candidateGraph: graph({
        sources: Object.freeze([
          source({ id: "source:Not Valid", revisionTime: "not-a-date" }),
        ]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(
    badRevisionAndId.some(
      (finding) =>
        finding.code === "ATLAS_INGEST_SOURCE_REVISION_TIME_INVALID" &&
        finding.path === ".atlas/sources/unknown.md",
    ),
  );
});

test("An equal-authority Dispute escalates through the workflow as a pending human decision", () => {
  const twoConcepts = graph({
    concepts: Object.freeze([
      concept({
        citations: Object.freeze([
          { sourceClaim: "Left claim.", sourceId: "source:left" },
        ]),
        id: "concept:left",
        title: "Left",
      }),
      concept({
        citations: Object.freeze([
          { sourceClaim: "Right claim.", sourceId: "source:right" },
        ]),
        id: "concept:right",
        title: "Right",
      }),
    ]),
    disputes: Object.freeze([
      { leftConceptId: "concept:left", rightConceptId: "concept:right" },
    ]),
    edges: Object.freeze([
      edge({ from: "anchor:root", id: "edge:a", to: "concept:left" }),
      edge({ from: "anchor:root", id: "edge:b", to: "concept:right" }),
    ]),
    sources: Object.freeze([
      source({
        content: "Left claim.",
        id: "source:left",
        revisionTime: "2026-08-05T00:00:00Z",
      }),
      source({
        content: "Right claim.",
        id: "source:right",
        revisionTime: "2026-08-05T00:00:00Z",
      }),
    ]),
  });
  const workflowState = state();
  const ingestRequest = request({ candidateGraph: twoConcepts });
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest),
  );
  assert.equal(result.completion, "not-completed");
  const decisions = result.handoff.unresolvedHumanDecisions;
  if (decisions.state !== "pending") {
    throw new Error("expected a pending human decision");
  }
  assert.ok(decisions.decisions.some((decision) => decision.includes("adjudicate")));
  assert.match(result.handoff.recommendedNextAction, /unresolved human decisions/u);
});

test("Change set validation enforces base freshness, canonical paths, and Changelog", () => {
  const workflowState = state();
  assert.deepEqual(
    codes(
      validateAtlasIngestChangeSet(workflowState, {
        baseSnapshotDigest: "stale",
        changes: Object.freeze([
          {
            content: "# Changelog\n\n- ingest-op-81: x\n",
            path: ".atlas/CHANGELOG.md",
          },
        ]),
        targetHead: "wrong",
      }),
    ),
    ["ATLAS_INGEST_CHANGE_SET_STALE"],
  );

  assert.ok(
    codes(
      validateAtlasIngestChangeSet(workflowState, {
        baseSnapshotDigest: workflowState.baseSnapshotDigest,
        changes: Object.freeze([
          { content: "x", path: "../escape.md" },
          {
            content: "# Changelog\n\n- ingest-op-81: x\n",
            path: ".atlas/CHANGELOG.md",
          },
        ]),
        targetHead: workflowState.targetHead,
      }),
    ).includes("ATLAS_INGEST_CHANGE_SET_PATH_INVALID"),
  );

  assert.ok(
    codes(
      validateAtlasIngestChangeSet(workflowState, {
        baseSnapshotDigest: workflowState.baseSnapshotDigest,
        changes: Object.freeze([{ content: "x", path: ".atlas/sources/x.md" }]),
        targetHead: workflowState.targetHead,
      }),
    ).includes("ATLAS_INGEST_CHANGELOG_REQUIRED"),
  );

  assert.ok(
    codes(
      validateAtlasIngestChangeSet(workflowState, {
        baseSnapshotDigest: workflowState.baseSnapshotDigest,
        changes: Object.freeze([
          { content: "# Changelog\n\n- other: x\n", path: ".atlas/CHANGELOG.md" },
        ]),
        targetHead: workflowState.targetHead,
      }),
    ).includes("ATLAS_INGEST_CHANGELOG_OPERATION_ID_REQUIRED"),
  );
});

test("Ingest refuses unsafe branches and stale base snapshots before mutating", () => {
  const unsafe = state();
  const unsafeRequest = request();
  const unsafeResult = runAtlasIngestWorkflow(
    Object.freeze({ ...unsafe, proposalBranch: "-bad" }),
    unsafeRequest,
    runtime(unsafe, unsafeRequest),
  );
  assert.ok(
    codes(unsafeResult.handoff.validationState.findings).includes(
      "ATLAS_INGEST_WORKFLOW_STATE_INVALID",
    ),
  );

  const workflowState = state();
  const staleResult = runAtlasIngestWorkflow(
    workflowState,
    unsafeRequest,
    runtime(workflowState, unsafeRequest, { currentTargetHead: "moved" }),
  );
  assert.ok(
    codes(staleResult.handoff.validationState.findings).includes(
      "ATLAS_INGEST_BASE_SNAPSHOT_STALE",
    ),
  );
});

test("Ingest refuses existing workspaces and escaping workspace paths", () => {
  const workflowState = state();
  const ingestRequest = request();
  const exists = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest, { workspaceExists: true }),
  );
  assert.ok(
    codes(exists.handoff.validationState.findings).includes(
      "ATLAS_INGEST_WORKSPACE_EXISTS",
    ),
  );

  const escapes = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest, { workspacePathValid: false }),
  );
  assert.ok(
    codes(escapes.handoff.validationState.findings).includes(
      "ATLAS_INGEST_WORKSPACE_PATH_INVALID",
    ),
  );
});

test("Ingest resumes content-addressed receipts without replaying writes", () => {
  const workflowState = state();
  const ingestRequest = request();
  const changeSet = reconcileCandidateGraph(workflowState, ingestRequest);
  const commit = "cccccccccccccccccccccccccccccccccccccccc";
  const digestReceipts = state([
    { effect: "create-proposal-worktree", receipt: "created" },
    {
      changeSetDigest: digestOf(changeSet),
      effect: "write-change-set",
      receipt: "written",
      writtenTree: "written",
    },
    {
      changeSetDigest: digestOf(changeSet),
      commit,
      effect: "commit-proposal",
      receipt: commit,
    },
  ]);
  const adapter = runtime(digestReceipts, ingestRequest, {
    commit,
    lintReceipt: commit,
  });
  const result = runAtlasIngestWorkflow(digestReceipts, ingestRequest, adapter);
  assert.equal(result.completion, "completed");
  assert.equal(adapter.counts.created(), 0);
  assert.equal(adapter.counts.written(), 0);
  assert.equal(adapter.counts.committed(), 0);
});

test("Ingest rejects crafted resume receipts not bound to the change set content", () => {
  const workflowState = state([
    { effect: "create-proposal-worktree", receipt: "created" },
    {
      changeSetDigest: "forged",
      effect: "write-change-set",
      receipt: "written",
      writtenTree: "written",
    },
  ]);
  const ingestRequest = request();
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest),
  );
  assert.ok(
    codes(result.handoff.validationState.findings).includes(
      "ATLAS_INGEST_RESUME_CHANGE_SET_MISMATCH",
    ),
  );
});

test("Ingest rejects resumed commit and lint receipts that drift from the change set", () => {
  const workflowState = state();
  const changeSet = reconcileCandidateGraph(workflowState, request());
  const commitDrift = state([
    { effect: "create-proposal-worktree", receipt: "created" },
    {
      changeSetDigest: digestOf(changeSet),
      effect: "write-change-set",
      receipt: "written",
      writtenTree: "written",
    },
    {
      changeSetDigest: digestOf(changeSet),
      commit: "zzzz",
      effect: "commit-proposal",
      receipt: "different",
    },
  ]);
  assert.ok(
    codes(
      runAtlasIngestWorkflow(commitDrift, request(), runtime(commitDrift, request()))
        .handoff.validationState.findings,
    ).includes("ATLAS_INGEST_RESUME_CHANGE_SET_MISMATCH"),
  );

  const lintDrift = state([
    { effect: "create-proposal-worktree", receipt: "created" },
    {
      changeSetDigest: digestOf(changeSet),
      effect: "write-change-set",
      receipt: "written",
      writtenTree: "written",
    },
    {
      changeSetDigest: digestOf(changeSet),
      commit: "dddddddddddddddddddddddddddddddddddddddd",
      effect: "commit-proposal",
      receipt: "dddddddddddddddddddddddddddddddddddddddd",
    },
    {
      changeSetDigest: digestOf(changeSet),
      commit: "dddddddddddddddddddddddddddddddddddddddd",
      effect: "lint-proposal",
      lintEvidenceCommit: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      receipt: "different",
    },
  ]);
  const reported = codes(
    runAtlasIngestWorkflow(lintDrift, request(), runtime(lintDrift, request())).handoff
      .validationState.findings,
  );
  assert.ok(reported.includes("ATLAS_INGEST_RESUME_CHANGE_SET_MISMATCH"));
  assert.ok(reported.includes("ATLAS_INGEST_LINT_STAMP_STALE"));
});

test("Ingest blocks when the proposal fails full Lint", () => {
  const workflowState = state();
  const ingestRequest = request();
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest, { lintUsesEmptyAtlas: true }),
  );
  assert.equal(result.completion, "not-completed");
  assert.equal(result.disposition, "failed");
});

test("Ingest refuses a Lint stamp for a commit different from the Lint evidence", () => {
  const workflowState = state();
  const ingestRequest = request();
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest, {
      lintReceipt: "ffffffffffffffffffffffffffffffffffffffff",
    }),
  );
  assert.ok(
    codes(result.handoff.validationState.findings).includes(
      "ATLAS_INGEST_LINT_STAMP_STALE",
    ),
  );
});

test("Ingest converts a runtime failure into a typed not-completed result", () => {
  const workflowState = state();
  const ingestRequest = request();
  const result = runAtlasIngestWorkflow(
    workflowState,
    ingestRequest,
    runtime(workflowState, ingestRequest, { failCreate: true }),
  );
  assert.ok(
    codes(result.handoff.validationState.findings).includes(
      "ATLAS_INGEST_RUNTIME_FAILED",
    ),
  );
});

test("Additional scope, stale, resume, and persistence branches are exercised", () => {
  const emptyLocator = validateCandidateGraph(
    request({
      candidateGraph: graph({ concepts: Object.freeze([concept({ locator: "" })]) }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(emptyLocator).includes("ATLAS_INGEST_LOCATOR_INVALID"));

  const longPrefixScope = validateCandidateGraph(
    request({
      scope: scope({ entryPoint: "docs/very/deep", includedPaths: ["docs"] }),
    }),
    baseFilesDefault,
  );
  assert.deepEqual(
    codes(longPrefixScope).filter(
      (code) => code === "ATLAS_INGEST_SCOPE_EXPANSION_PENDING",
    ),
    [],
  );

  const staleUnknownId = validateCandidateGraph(
    request({
      candidateGraph: graph({
        sources: Object.freeze([
          source({
            id: "readme",
            refreshWindowDays: 1,
            revisionTime: "2020-01-01T00:00:00Z",
          }),
        ]),
      }),
    }),
    baseFilesDefault,
  );
  assert.ok(codes(staleUnknownId).includes("ATLAS_INGEST_SOURCE_ID_INVALID"));
  assert.ok(
    staleUnknownId.some(
      (entry) =>
        entry.code === "ATLAS_INGEST_SOURCE_STALE" &&
        entry.path === ".atlas/sources/unknown.md",
    ),
  );

  const workflowState = state();
  const ingestRequest = request();
  const changeSet = reconcileCandidateGraph(workflowState, ingestRequest);
  const untypedReceipts = state([
    { effect: "create-proposal-worktree", receipt: "created" },
    {
      changeSetDigest: digestOf(changeSet),
      effect: "write-change-set",
      receipt: "written",
      writtenTree: "written",
    },
    { changeSetDigest: digestOf(changeSet), effect: "commit-proposal", receipt: "c1" },
    { changeSetDigest: digestOf(changeSet), effect: "lint-proposal", receipt: "l1" },
  ]);
  const untypedResult = runAtlasIngestWorkflow(
    untypedReceipts,
    ingestRequest,
    runtime(untypedReceipts, ingestRequest),
  );
  const untypedCodes = codes(untypedResult.handoff.validationState.findings);
  assert.ok(untypedCodes.includes("ATLAS_INGEST_RESUME_CHANGE_SET_MISMATCH"));
  assert.ok(untypedCodes.includes("ATLAS_INGEST_LINT_STAMP_STALE"));

  const persisted: AtlasIngestWorkflowState[] = [];
  const persistedResult = runAtlasIngestWorkflow(workflowState, ingestRequest, {
    ...runtime(workflowState, ingestRequest),
    persistState: (nextState) => {
      persisted.push(nextState);
    },
  });
  assert.equal(persistedResult.completion, "completed");
  assert.equal(persisted.length, 4);
});

test("isSafeGitBranchName and sourceRevisionDigest behave as documented", () => {
  assert.equal(isSafeGitBranchName("feat/issue-81-ingest"), true);
  assert.equal(isSafeGitBranchName("bad//name"), false);
  assert.equal(isSafeGitBranchName("trailing/"), false);
  assert.equal(isSafeGitBranchName("dot/./segment"), false);
  assert.equal(isSafeGitBranchName("..sneaky"), false);
  assert.notEqual(sourceRevisionDigest("a"), sourceRevisionDigest("b"));
  assert.equal(sourceRevisionDigest("a"), sourceRevisionDigest("a"));
});

test("the adversarial ingest corpus maps to enforced gates", () => {
  assert.match(ingestCorpus.reviewResolutionRule, /review finding/u);
  assert.equal(ingestCorpus.schema, 1);
  assert.ok(ingestCorpus.cases.length > 0);
  const seen = new Set(ingestCorpus.cases.map((entry) => entry.name));
  assert.equal(seen.size, ingestCorpus.cases.length);
});

function digestOf(changeSet: AtlasIngestChangeSet): string {
  return atlasIngestChangeSetDigest(changeSet);
}
