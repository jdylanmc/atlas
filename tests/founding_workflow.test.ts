import assert from "node:assert/strict";
import test from "node:test";

import {
  atlasInitializationFiles,
  foundingCapabilityStatus,
  initialAtlasInitializationWorkflowState,
  runComposedAtlasInitializationWorkflow,
  validateNoChangePathCollisions,
  type AtlasFoundingRequest,
  type AtlasInitializationChangeSet,
  type AtlasInitializationEffectReceipt,
  type AtlasInitializationWorkflowState,
} from "../src/operations/initialize_operation.ts";
import { prepareGovernanceFragment } from "../src/operations/governance_operation.ts";
import { createVirtualAtlasView } from "../src/operations/virtual_atlas_view.ts";
import { runLintOperation } from "../src/operations/lint_operation.ts";
import {
  invalidateDependentCheckpoints,
  type FoundingCheckpoint,
} from "../src/domain/founding_checkpoint.ts";

function state(
  receipts: readonly AtlasInitializationEffectReceipt[] = Object.freeze([]),
  foundingCheckpoints?: readonly FoundingCheckpoint[],
): AtlasInitializationWorkflowState {
  return Object.freeze({
    ...initialAtlasInitializationWorkflowState({
      baseSnapshotDigest: "base-digest",
      proposalBranch: "atlas-founding-test",
      targetBranch: "main",
      targetHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    ...(foundingCheckpoints === undefined ? {} : { foundingCheckpoints }),
    effectReceipts: receipts,
  });
}

function captured(
  changeSet: AtlasInitializationChangeSet,
): readonly { readonly bytes: Uint8Array; readonly path: string }[] {
  const encoder = new TextEncoder();
  return Object.freeze(
    changeSet.changes.map((change) =>
      Object.freeze({ bytes: encoder.encode(change.content), path: change.path }),
    ),
  );
}

test("composed founding workflow succeeds while leaving the legacy minimal path intact", () => {
  const initial = state();
  let created = 0;
  let written = 0;
  let committed = 0;
  let linted = 0;
  let writtenChangeSet: AtlasInitializationChangeSet | undefined;

  const result = runComposedAtlasInitializationWorkflow(
    initial,
    {
      persona: {
        activationConfirmedAt: "2026-08-24T12:01:00Z",
        activationConfirmedBy: "Reviewer",
        approvedAt: "2026-08-24T12:00:00Z",
        approvedBy: "Reviewer",
        proposed: {
          name: "Meridian",
          personaId: "meridian",
          voice: "Calm and direct.",
        },
      },
      directiveSpecialization: {
        additionalConstraints: ["Never publish without human review."],
        additionalHandoffs: [
          "Escalate unresolved publication choices to a Maintainer.",
        ],
        role: "atlas-guide",
      },
      governance: [
        {
          "governance-request-schema": "1.0.0",
          action: "create",
          approvedAt: "2026-08-24T12:00:00Z",
          approvedBy: "Reviewer",
          changes: [
            {
              content: [
                "---",
                "sdk:",
                "  atlas-sdk-schema: 1.0.0",
                '  created-at: "2026-01-01T00:00:00Z"',
                "  created-by:",
                "    kind: agent",
                "    name: Atlas SDK",
                "  id: principle:determinism",
                "  local-atlas-schema: 1.0.0",
                "  tags: []",
                "  title: Determinism",
                "  type: principle",
                '  updated-at: "2026-01-01T00:00:00Z"',
                "  updated-by:",
                "    kind: agent",
                "    name: Atlas SDK",
                "atlas: {}",
                "---",
                "",
                "# Determinism",
                "",
                "## Active truths",
                "",
                "- `truth:no-model` Atlas SDK never invokes a model.",
                "",
                "## Amendments",
                "",
                "### 1 - 2026-08-24",
                "",
                "Added `truth:no-model`.",
                "",
              ].join("\n"),
              path: ".atlas/principles/determinism.md",
            },
          ],
          changelog: "Create founding Principle.",
          subject: "principle",
        },
      ],
      hostIntegration: { skills: ["atlas-entry"] },
      ingest: {
        "ingest-request-schema": "1.0.0",
        candidateGraph: {
          "candidate-graph-schema": "1.0.0",
          concepts: [
            {
              citations: [
                {
                  sourceClaim: "Atlas SDK is a deterministic library.",
                  sourceId: "source:readme",
                },
              ],
              claim: "Atlas SDK is a deterministic library.",
              id: "concept:determinism",
              locator: "docs/readme.md",
              title: "Determinism",
            },
          ],
          disputes: [],
          edges: [
            {
              citations: [
                {
                  sourceClaim: "Atlas SDK is a deterministic library.",
                  sourceId: "source:readme",
                },
              ],
              context: "The Home Atlas begins at the determinism Concept.",
              from: "anchor:root",
              id: "edge:root-covers-determinism",
              semantics: ["covers"],
              title: "Root Covers Determinism",
              to: "concept:determinism",
            },
          ],
          sources: [
            {
              authority: "official",
              content: "Atlas SDK is a deterministic library.",
              id: "source:readme",
              locator: "docs/readme.md",
              refreshWindowDays: 30,
              revisionTime: "2026-08-24T12:00:00Z",
              title: "Readme",
            },
          ],
        },
        scope: {
          "ingest-scope-schema": "1.0.0",
          approvedAt: "2026-08-24T12:00:00Z",
          approvedBy: "Reviewer",
          asOf: "2026-08-24T12:00:00Z",
          authority: "official",
          entryPoint: "docs",
          excludedPaths: ["docs/private"],
          freshnessWindowDays: 30,
          includedPaths: ["docs"],
          maxDepth: 4,
          sourceId: "source:readme",
        },
      },
      anchors: [
        {
          anchorId: "anchor:founding",
          approvedAt: "2026-08-24T12:00:00Z",
          approvedBy: "Reviewer",
          citedSources: [".atlas/sources/readme.md"],
          namedPaths: [
            { label: "Determinism", targetConceptId: "concept:determinism" },
          ],
          orientation: "Start at deterministic Atlas operation rules.",
          title: "Founding Knowledge",
        },
      ],
      sitePolicy: {
        approvedAt: "2026-08-24T12:00:00Z",
        approvedBy: "Reviewer",
        enabled: true,
      },
    } satisfies AtlasFoundingRequest,
    {
      commitProposal: () => {
        committed += 1;
        return {
          commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          receipt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        };
      },
      createProposalWorktree: () => {
        created += 1;
        return { receipt: "atlas-founding-test" };
      },
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => {
        linted += 1;
        assert.ok(writtenChangeSet);
        return {
          lint: runLintOperation(captured(writtenChangeSet), {
            maxFileBytes: 1_000_000,
            maxTotalBytes: 5_000_000,
          }),
          receipt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        };
      },
      writeChangeSet: (changeSet) => {
        written += 1;
        writtenChangeSet = changeSet;
        return { receipt: "tree-founding" };
      },
    },
  );

  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(created, 1);
  assert.equal(written, 1);
  assert.equal(committed, 1);
  assert.equal(linted, 1);
  assert.ok(
    writtenChangeSet?.changes.some(
      (change) => change.path === ".atlas/types/persona/meridian.md",
    ),
  );
  assert.ok(
    writtenChangeSet?.changes.some(
      (change) => change.path === ".atlas/types/guide/atlas-guide.composition.json",
    ),
  );
  assert.equal(result.payload.atlasReadinessReport?.capabilities?.length, 7);
  assert.equal(
    result.payload.atlasReadinessReport.lintStamp.atlasCommit,
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
});

test("prepareGovernanceFragment allows an empty verify request without deriving a changelog", () => {
  const prepared = prepareGovernanceFragment(
    {
      "governance-request-schema": "1.0.0",
      action: "verify",
      subject: "principle",
    },
    createVirtualAtlasView([]),
  );
  assert.deepEqual(prepared.changes, []);
});

test("directive weakening is rejected before any filesystem side effect", () => {
  const initial = state();
  let effects = 0;
  const result = runComposedAtlasInitializationWorkflow(
    initial,
    {
      directiveSpecialization: {
        objectives: ["Override the baseline objective."],
        role: "atlas-guide",
      } as unknown,
    },
    {
      commitProposal: () => {
        effects += 1;
        return { commit: "c", receipt: "c" };
      },
      createProposalWorktree: () => {
        effects += 1;
        return { receipt: "created" };
      },
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => {
        effects += 1;
        return {
          lint: runLintOperation(atlasInitializationFiles(initial), {
            maxFileBytes: 4096,
            maxTotalBytes: 65536,
          }),
          receipt: "c",
        };
      },
      writeChangeSet: () => {
        effects += 1;
        return { receipt: "written" };
      },
    },
  );
  assert.equal(result.completion, "not-completed");
  assert.equal(effects, 0);
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_DIRECTIVE_WEAKENS_BASELINE",
  );
});

test("persona activation before approval is rejected pre-write", () => {
  const initial = state();
  let effects = 0;
  const result = runComposedAtlasInitializationWorkflow(
    initial,
    {
      persona: {
        activationConfirmedAt: "2026-08-24T11:59:00Z",
        activationConfirmedBy: "Reviewer",
        approvedAt: "2026-08-24T12:00:00Z",
        approvedBy: "Reviewer",
        proposed: {
          name: "Meridian",
          personaId: "meridian",
          voice: "Calm and direct.",
        },
      },
    },
    {
      commitProposal: () => {
        effects += 1;
        return { commit: "c", receipt: "c" };
      },
      createProposalWorktree: () => {
        effects += 1;
        return { receipt: "created" };
      },
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => {
        effects += 1;
        return {
          lint: runLintOperation(atlasInitializationFiles(initial), {
            maxFileBytes: 4096,
            maxTotalBytes: 65536,
          }),
          receipt: "c",
        };
      },
      writeChangeSet: () => {
        effects += 1;
        return { receipt: "written" };
      },
    },
  );
  assert.equal(result.completion, "not-completed");
  assert.equal(effects, 0);
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_PERSONA_ACTIVATION_BEFORE_APPROVAL",
  );

  const missingApproval = runComposedAtlasInitializationWorkflow(
    initial,
    {
      persona: {
        proposed: {
          name: "Meridian",
          personaId: "meridian",
          voice: "Calm and direct.",
        },
      },
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(missingApproval.completion, "not-completed");
  assert.equal(
    missingApproval.handoff.validationState.findings[0]?.code,
    "ATLAS_PERSONA_APPROVAL_REQUIRED",
  );
});

test("governance invalidation affects only true downstream dependents", () => {
  assert.equal(
    validateNoChangePathCollisions([
      { content: "a", path: ".atlas/types/guide/x.json" },
      { content: "b", path: ".atlas/types/guide/X.json" },
    ])[0]?.code,
    "ATLAS_FOUNDING_CHANGE_PATH_COLLISION",
  );

  const staleState = state(
    Object.freeze([
      Object.freeze({ effect: "write-change-set", receipt: "written" }),
      Object.freeze({ effect: "commit-proposal", receipt: "commit" }),
      Object.freeze({ effect: "lint-proposal", receipt: "lint" }),
    ]),
    Object.freeze([
      Object.freeze({
        dependsOn: [] as const,
        evidenceDigest: "1",
        id: "governance",
        inputDigest: "old",
        status: "complete",
      }),
      Object.freeze({
        dependsOn: ["governance", "ingest"] as const,
        evidenceDigest: "1",
        id: "anchor",
        inputDigest: "1",
        status: "complete",
      }),
      Object.freeze({
        dependsOn: ["anchor"] as const,
        evidenceDigest: "1",
        id: "site",
        inputDigest: "1",
        status: "complete",
      }),
    ]),
  );
  const cleared = runComposedAtlasInitializationWorkflow(
    staleState,
    {
      governance: [
        {
          "governance-request-schema": "1.0.0",
          action: "create",
          approvedAt: "2026-08-24T12:00:00Z",
          approvedBy: "Reviewer",
          changes: [
            {
              content:
                '---\nsdk:\n  atlas-sdk-schema: 1.0.0\n  created-at: "2026-01-01T00:00:00Z"\n  created-by:\n    kind: agent\n    name: Atlas SDK\n  id: principle:determinism\n  local-atlas-schema: 1.0.0\n  tags: []\n  title: Determinism\n  type: principle\n  updated-at: "2026-01-01T00:00:00Z"\n  updated-by:\n    kind: agent\n    name: Atlas SDK\natlas: {}\n---\n\n# Determinism\n\n## Active truths\n\n- `truth:no-model` Atlas SDK never invokes a model.\n\n## Amendments\n\n### 1 - 2026-08-24\n\nAdded `truth:no-model`.\n',
              path: ".atlas/principles/determinism.md",
            },
          ],
          changelog: "Create founding Principle.",
          subject: "principle",
        },
      ],
      anchors: [
        {
          anchorId: "anchor:bad",
          approvedAt: "",
          approvedBy: "",
          citedSources: [".atlas/sources/missing.md"],
          namedPaths: [{ label: "Missing", targetConceptId: "concept:missing" }],
          orientation: "Broken references.",
          title: "Broken Anchor",
        },
      ],
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => staleState.targetHead,
      currentBaseSnapshotDigest: () => staleState.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(staleState), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.deepEqual(cleared.payload.workflowState.effectReceipts, []);
  assert.equal(
    cleared.payload.workflowState.foundingCheckpoints?.find(
      (checkpoint) => checkpoint.id === "anchor",
    )?.status,
    "pending",
  );

  const badAnchor = runComposedAtlasInitializationWorkflow(
    state(),
    {
      anchors: [
        {
          anchorId: "",
          approvedAt: "",
          approvedBy: "",
          citedSources: [".atlas/sources/missing.md"],
          namedPaths: [{ label: "Missing", targetConceptId: "concept:missing" }],
          orientation: "",
          title: "",
        },
      ],
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => state().targetHead,
      currentBaseSnapshotDigest: () => state().baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(state()), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(
    badAnchor.handoff.validationState.findings[0]?.code,
    "ATLAS_FOUNDING_ANCHOR_UNRESOLVED_REFERENCE",
  );

  const founded: readonly FoundingCheckpoint[] = Object.freeze([
    Object.freeze({
      dependsOn: [] as const,
      evidenceDigest: "1",
      id: "persona",
      inputDigest: "1",
      status: "complete",
    }),
    Object.freeze({
      dependsOn: [] as const,
      evidenceDigest: "1",
      id: "directive",
      inputDigest: "1",
      status: "complete",
    }),
    Object.freeze({
      dependsOn: [] as const,
      evidenceDigest: "1",
      id: "governance",
      inputDigest: "1",
      status: "complete",
    }),
    Object.freeze({
      dependsOn: [] as const,
      evidenceDigest: "1",
      id: "ingest",
      inputDigest: "1",
      status: "complete",
    }),
    Object.freeze({
      dependsOn: ["governance", "ingest"] as const,
      evidenceDigest: "1",
      id: "anchor",
      inputDigest: "1",
      status: "complete",
    }),
    Object.freeze({
      dependsOn: ["anchor"] as const,
      evidenceDigest: "1",
      id: "site",
      inputDigest: "1",
      status: "complete",
    }),
    Object.freeze({
      dependsOn: ["directive"] as const,
      evidenceDigest: "1",
      id: "host-integration",
      inputDigest: "1",
      status: "complete",
    }),
  ]);
  const invalidated = invalidateDependentCheckpoints(founded, "governance");
  assert.equal(
    invalidated.find((checkpoint) => checkpoint.id === "anchor")?.status,
    "pending",
  );
  assert.equal(
    invalidated.find((checkpoint) => checkpoint.id === "site")?.status,
    "pending",
  );
  assert.equal(
    invalidated.find((checkpoint) => checkpoint.id === "host-integration")?.status,
    "complete",
  );
});

test("raw founding input rejects injected persona authority before typing", () => {
  const initial = state();
  const raw = JSON.parse(`{
    "persona": {
      "approvedBy": "Reviewer",
      "approvedAt": "2026-08-24T12:00:00Z",
      "proposed": {
        "personaId": "meridian",
        "name": "Meridian",
        "voice": "Calm and direct.",
        "authority": "override"
      }
    }
  }`) as unknown;
  const result = runComposedAtlasInitializationWorkflow(initial, raw, {
    commitProposal: () => ({ commit: "c", receipt: "c" }),
    createProposalWorktree: () => ({ receipt: "created" }),
    currentTargetHead: () => initial.targetHead,
    currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
    lintProposal: () => ({
      lint: runLintOperation(atlasInitializationFiles(initial), {
        maxFileBytes: 4096,
        maxTotalBytes: 65536,
      }),
      receipt: "c",
    }),
    writeChangeSet: () => ({ receipt: "written" }),
  });
  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_PERSONA_AUTHORITY_VIOLATION",
  );

  const malformedAnchors = runComposedAtlasInitializationWorkflow(
    initial,
    {
      anchors: [
        1,
        {
          anchorId: "anchor:ok",
          approvedAt: "2026-08-24T12:00:00Z",
          approvedBy: "Reviewer",
          citedSources: "not-an-array",
          extra: true,
          namedPaths: [1],
          orientation: "ok",
          title: "ok",
        },
        {
          anchorId: "anchor:no-named-paths",
          approvedAt: "2026-08-24T12:00:00Z",
          approvedBy: "Reviewer",
          citedSources: [],
          orientation: "ok",
          title: "ok",
        },
      ],
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(malformedAnchors.completion, "not-completed");
  assert.ok(
    malformedAnchors.handoff.validationState.findings.some(
      (finding) => finding.code === "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
    ),
  );

  const malformedPrimitive = runComposedAtlasInitializationWorkflow(initial, 1, {
    commitProposal: () => ({ commit: "c", receipt: "c" }),
    createProposalWorktree: () => ({ receipt: "created" }),
    currentTargetHead: () => initial.targetHead,
    currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
    lintProposal: () => ({
      lint: runLintOperation(atlasInitializationFiles(initial), {
        maxFileBytes: 4096,
        maxTotalBytes: 65536,
      }),
      receipt: "c",
    }),
    writeChangeSet: () => ({ receipt: "written" }),
  });
  assert.equal(malformedPrimitive.completion, "not-completed");

  const malformedTopLevel = runComposedAtlasInitializationWorkflow(
    initial,
    {
      anchors: "not-an-array",
      hostIntegration: "not-an-object",
      sitePolicy: "not-an-object",
      unknownKey: true,
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(malformedTopLevel.completion, "not-completed");
  assert.ok(
    malformedTopLevel.handoff.validationState.findings.some(
      (finding) => finding.code === "ATLAS_FOUNDING_REQUEST_FOREIGN_KEY",
    ),
  );

  const malformedSkills = runComposedAtlasInitializationWorkflow(
    initial,
    {
      hostIntegration: { skills: "not-an-array" },
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(malformedSkills.completion, "completed");
});

test("composed initialization covers declined capabilities and runtime failure handoff", () => {
  const initial = state();
  assert.equal(foundingCapabilityStatus(false, undefined), "declined");
  assert.equal(
    foundingCapabilityStatus(true, {
      dependsOn: [] as const,
      id: "persona",
      status: "pending",
    }),
    "blocked",
  );
  assert.equal(
    foundingCapabilityStatus(true, {
      dependsOn: [] as const,
      id: "persona",
      status: "skipped",
    }),
    "degraded",
  );

  const declined = runComposedAtlasInitializationWorkflow(
    initial,
    {},
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(declined.completion, "completed");
  assert.deepEqual(
    declined.payload.atlasReadinessReport?.capabilities?.map((entry) => entry.status),
    [
      "declined",
      "declined",
      "declined",
      "declined",
      "declined",
      "declined",
      "declined",
    ],
  );

  const runtimeFailure = runComposedAtlasInitializationWorkflow(
    initial,
    {
      hostIntegration: { skills: ["atlas-entry"] },
      directiveSpecialization: {
        objectives: ["Override the baseline objective."],
        role: "atlas-guide",
      } as unknown,
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(runtimeFailure.completion, "not-completed");
  assert.ok(
    runtimeFailure.handoff.validationState.findings.some(
      (finding) => finding.code === "ATLAS_DIRECTIVE_WEAKENS_BASELINE",
    ),
  );
  const siteDisabled = runComposedAtlasInitializationWorkflow(
    initial,
    {
      sitePolicy: { enabled: false },
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(siteDisabled.completion, "completed");

  const directiveOnly = runComposedAtlasInitializationWorkflow(
    initial,
    {
      hostIntegration: { skills: ["atlas-entry"] },
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(directiveOnly.completion, "completed");
  assert.match(
    directiveOnly.payload.atlasReadinessReport?.guide ?? "",
    /Directive composition without a Persona/u,
  );

  const siteApprovalMissing = runComposedAtlasInitializationWorkflow(
    initial,
    {
      sitePolicy: {
        approvedBy: "Reviewer",
        enabled: true,
      },
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(siteApprovalMissing.completion, "not-completed");

  const siteApproverMissing = runComposedAtlasInitializationWorkflow(
    initial,
    {
      sitePolicy: {
        approvedAt: "2026-08-24T12:00:00Z",
        enabled: true,
      },
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => initial.targetHead,
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(siteApproverMissing.completion, "not-completed");

  const staleUnderlying = runComposedAtlasInitializationWorkflow(
    initial,
    {
      hostIntegration: { skills: ["atlas-entry"] },
    },
    {
      commitProposal: () => ({ commit: "c", receipt: "c" }),
      createProposalWorktree: () => ({ receipt: "created" }),
      currentTargetHead: () => "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      currentBaseSnapshotDigest: () => initial.baseSnapshotDigest,
      lintProposal: () => ({
        lint: runLintOperation(atlasInitializationFiles(initial), {
          maxFileBytes: 4096,
          maxTotalBytes: 65536,
        }),
        receipt: "c",
      }),
      writeChangeSet: () => ({ receipt: "written" }),
    },
  );
  assert.equal(staleUnderlying.completion, "not-completed");
  assert.equal(
    staleUnderlying.handoff.validationState.findings[0]?.code,
    "ATLAS_INITIALIZATION_BASE_SNAPSHOT_STALE",
  );
});
