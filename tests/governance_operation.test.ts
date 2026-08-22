import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import type { Finding } from "../src/domain/finding.ts";
import {
  mergeGovernanceFindings,
  runAtlasGovernanceWorkflow,
  validateAtlasGovernanceChangeSet,
  type AtlasGovernanceChangeSet,
  type AtlasGovernanceEffectReceipt,
  type AtlasGovernanceRequest,
  type AtlasGovernanceRuntime,
  type AtlasGovernanceWorkflowState,
} from "../src/operations/governance_operation.ts";
import {
  notCompletedLintOperationResult,
  runLintOperation,
} from "../src/operations/lint_operation.ts";

const budgets = Object.freeze({ maxFileBytes: 4096, maxTotalBytes: 65536 });
const governanceCorpus = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "adversarial", "governance.json"), "utf8"),
) as {
  readonly cases: readonly {
    readonly expectedCode: string;
    readonly gate: "governance";
    readonly kind: "finding-merge" | "semantic";
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
  body: string,
): CapturedAtlasFile {
  return {
    bytes: new TextEncoder().encode(
      [
        "---",
        "sdk:",
        "  atlas-sdk-schema: 1.0.0",
        '  created-at: "2026-08-21T00:00:00Z"',
        "  created-by:",
        "    kind: human",
        "    name: Fixture Maintainer",
        `  id: ${id}`,
        "  local-atlas-schema: 1.0.0",
        "  tags: []",
        `  title: ${title}`,
        `  type: ${type}`,
        '  updated-at: "2026-08-21T00:00:00Z"',
        "  updated-by:",
        "    kind: human",
        "    name: Fixture Maintainer",
        "atlas: {}",
        "---",
        "",
        body,
      ].join("\n"),
    ),
    path,
  };
}

const root = page(".atlas/index.md", "anchor:root", "anchor", "Home", "# Home\n");
const changelog: CapturedAtlasFile = {
  bytes: new TextEncoder().encode("# Changelog\n\n## 2026-08-21\n\n- Base.\n"),
  path: ".atlas/CHANGELOG.md",
};

function state(
  receipts: readonly AtlasGovernanceEffectReceipt[] = Object.freeze([]),
): AtlasGovernanceWorkflowState {
  return Object.freeze({
    "operation-workflow-schema": "1.0.0" as const,
    baseSnapshotDigest: "base-digest",
    effectReceipts: receipts,
    operationId: "governance-op-80",
    proposalBranch: "atlas-governance-test",
    targetBranch: "main",
    targetHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
}

function principleContent(
  truths: string,
  amendments = "## Amendments\n\n### 1 - 2026-08-21\n\nAdded `truth:one` under Maintainer approval.\n",
): string {
  return new TextDecoder().decode(
    page(
      ".atlas/principles/determinism.md",
      "principle:determinism",
      "principle",
      "Determinism",
      `# Determinism\n\n## Active truths\n\n${truths}\n\n${amendments}`,
    ).bytes,
  );
}

function policyContent(
  body = [
    "# Publication",
    "",
    "## Scope",
    "",
    "Atlas maintenance and publication are governed by this Policy.",
    "",
    "## Evaluation",
    "",
    "Semantic evaluation with Challenge is required.",
    "",
    "## Consequence",
    "",
    "Violations block only the governed operation.",
    "",
  ].join("\n"),
): string {
  return new TextDecoder().decode(
    page(
      ".atlas/types/policy/publication.md",
      "policy:publication",
      "policy",
      "Publication",
      body,
    ).bytes,
  );
}

function semanticVerdict(
  policyId = "policy:publication",
  verdict: "pass" | "fail" = "pass",
): AtlasGovernanceRequest["semanticVerdicts"] {
  return [
    {
      challenge: {
        argument: "The cited Atlas locations support this result.",
        evidence: [".atlas/index.md#L1"],
        position: "agree",
      },
      evidence: [".atlas/index.md#L1"],
      policyId,
      verdict,
    },
  ];
}

function changeSet(
  workflowState = state(),
  changes: readonly { readonly content: string; readonly path: string }[] = [
    {
      content: [
        "# Changelog",
        "",
        "## 2026-08-21",
        "",
        "- governance-op-80: Created Determinism Principle.",
        "",
      ].join("\n"),
      path: ".atlas/CHANGELOG.md",
    },
    {
      content: principleContent(
        "- `truth:one` Findings cannot be downgraded by model output.\n",
      ),
      path: ".atlas/principles/determinism.md",
    },
  ],
): AtlasGovernanceChangeSet {
  return Object.freeze({
    baseSnapshotDigest: workflowState.baseSnapshotDigest,
    changes: Object.freeze(changes.map((change) => Object.freeze({ ...change }))),
    targetHead: workflowState.targetHead,
  });
}

type RequestOverrides = Partial<{
  readonly [Key in keyof AtlasGovernanceRequest]:
    AtlasGovernanceRequest[Key] | undefined;
}>;

function request(overrides: RequestOverrides = {}): AtlasGovernanceRequest {
  const base: AtlasGovernanceRequest = {
    "governance-request-schema": "1.0.0",
    action: "create",
    approvedAt: "2026-08-21T00:00:00Z",
    approvedBy: "Fixture Maintainer",
    changeSet: changeSet(),
    subject: "principle",
  };
  const merged: Record<string, unknown> = Object.fromEntries(
    Object.entries({ ...base, ...overrides }).filter(
      ([, value]) => value !== undefined,
    ),
  );
  return merged as unknown as AtlasGovernanceRequest;
}

function applyChanges(
  files: readonly CapturedAtlasFile[],
  changes: AtlasGovernanceChangeSet | undefined,
): readonly CapturedAtlasFile[] {
  const encoder = new TextEncoder();
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const change of changes?.changes ?? []) {
    byPath.set(change.path, {
      bytes: encoder.encode(change.content),
      path: change.path,
    });
  }
  return Object.freeze([...byPath.values()]);
}

function runtime(
  workflowState: AtlasGovernanceWorkflowState,
  maintenanceRequest: AtlasGovernanceRequest,
  options: {
    readonly baseFiles?: readonly CapturedAtlasFile[];
    readonly commit?: string;
    readonly currentBaseSnapshotDigest?: string;
    readonly currentTargetHead?: string;
    readonly failCreate?: true;
    readonly lintReceipt?: string;
    readonly lintUsesEmptyAtlas?: true;
    readonly workspaceExists?: boolean;
    readonly workspacePathValid?: boolean;
  } = {},
): AtlasGovernanceRuntime & {
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
  const commit = options.commit ?? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const baseFiles = options.baseFiles ?? [root, changelog];
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
      const lintFiles =
        options.lintUsesEmptyAtlas === true
          ? []
          : applyChanges(baseFiles, maintenanceRequest.changeSet);
      return {
        lint: runLintOperation(lintFiles, budgets),
        receipt: options.lintReceipt ?? commit,
      };
    },
    workspaceExists: () => options.workspaceExists ?? false,
    workspacePathValid: () => options.workspacePathValid ?? true,
    writeChangeSet: () => {
      written += 1;
      return { receipt: "written" };
    },
  };
}

test("Governance creates a Linted Principle proposal with stable truths and resumable receipts", () => {
  const workflowState = state();
  const maintenanceRequest = request({ changeSet: changeSet(workflowState) });
  const adapter = runtime(workflowState, maintenanceRequest);
  const persisted: AtlasGovernanceWorkflowState[] = [];
  const persistedAdapter = {
    ...runtime(workflowState, maintenanceRequest),
    persistState: (nextState: AtlasGovernanceWorkflowState) => {
      persisted.push(nextState);
    },
  };

  const result = runAtlasGovernanceWorkflow(workflowState, maintenanceRequest, adapter);
  const persistedResult = runAtlasGovernanceWorkflow(
    workflowState,
    maintenanceRequest,
    persistedAdapter,
  );

  assert.equal(result.completion, "completed");
  assert.equal(persistedResult.completion, "completed");
  assert.equal(persisted.length, 4);
  assert.equal(result.disposition, "success");
  assert.ok(result.payload.lint);
  assert.equal(result.payload.lint.payload.state, "completed");
  assert.equal(result.payload.lint.payload.lint.outcome, "valid");
  assert.equal("lintStamp" in result.payload, false);
  assert.deepEqual(
    result.payload.workflowState.effectReceipts.map((receipt) => receipt.effect),
    [
      "create-proposal-worktree",
      "write-change-set",
      "commit-proposal",
      "lint-proposal",
    ],
  );
  assert.equal(adapter.counts.created(), 1);
  assert.equal(adapter.counts.written(), 1);
  assert.equal(adapter.counts.linted(), 1);
});

test("Governance resumes content-addressed receipts without replaying proposal writes", () => {
  const workflowState = state();
  const maintenanceRequest = request({ changeSet: changeSet(workflowState) });
  const persisted: AtlasGovernanceWorkflowState[] = [];
  const first = runAtlasGovernanceWorkflow(workflowState, maintenanceRequest, {
    ...runtime(workflowState, maintenanceRequest),
    persistState: (nextState: AtlasGovernanceWorkflowState) => {
      persisted.push(nextState);
    },
  });
  assert.equal(first.completion, "completed");
  const resumedState = persisted.at(-1);
  assert.ok(resumedState);
  const adapter = runtime(resumedState, maintenanceRequest);

  const result = runAtlasGovernanceWorkflow(resumedState, maintenanceRequest, adapter);

  assert.equal(result.completion, "completed");
  assert.equal(adapter.counts.created(), 0);
  assert.equal(adapter.counts.written(), 0);
  assert.equal(adapter.counts.committed(), 0);
  assert.equal(adapter.counts.linted(), 1);
});

test("Governance rejects crafted resume receipts that are not bound to the change set", () => {
  const workflowState = state([
    { effect: "create-proposal-worktree", receipt: "created" },
    { effect: "write-change-set", receipt: "written" },
    {
      effect: "commit-proposal",
      receipt: "cccccccccccccccccccccccccccccccccccccccc",
    },
    {
      effect: "lint-proposal",
      receipt: "cccccccccccccccccccccccccccccccccccccccc",
    },
  ]);
  const maintenanceRequest = request({ changeSet: changeSet(workflowState) });
  const adapter = runtime(workflowState, maintenanceRequest, {
    commit: "cccccccccccccccccccccccccccccccccccccccc",
  });

  const result = runAtlasGovernanceWorkflow(workflowState, maintenanceRequest, adapter);

  assert.equal(result.completion, "not-completed");
  assert.equal(adapter.counts.created(), 0);
  assert.equal(adapter.counts.written(), 0);
  assert.equal(adapter.counts.committed(), 0);
  assert.equal(adapter.counts.linted(), 0);
  assert.ok(
    result.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_RESUME_CHANGE_SET_MISMATCH",
    ),
  );
});

test("Governance rejects resumed Lint evidence for a different commit", () => {
  const workflowState = state();
  const maintenanceRequest = request({ changeSet: changeSet(workflowState) });
  const persisted: AtlasGovernanceWorkflowState[] = [];
  const first = runAtlasGovernanceWorkflow(workflowState, maintenanceRequest, {
    ...runtime(workflowState, maintenanceRequest),
    persistState: (nextState: AtlasGovernanceWorkflowState) => {
      persisted.push(nextState);
    },
  });
  assert.equal(first.completion, "completed");
  const resumedState = persisted.at(-1);
  assert.ok(resumedState);
  const tamperedState: AtlasGovernanceWorkflowState = {
    ...resumedState,
    effectReceipts: resumedState.effectReceipts.map((receipt) =>
      receipt.effect === "lint-proposal"
        ? {
            ...receipt,
            lintEvidenceCommit: "dddddddddddddddddddddddddddddddddddddddd",
            receipt: "dddddddddddddddddddddddddddddddddddddddd",
          }
        : receipt,
    ),
  };
  const adapter = runtime(tamperedState, maintenanceRequest);

  const result = runAtlasGovernanceWorkflow(tamperedState, maintenanceRequest, adapter);

  assert.equal(result.completion, "not-completed");
  assert.equal(
    result.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_LINT_STAMP_STALE",
  );
  assert.equal(adapter.counts.linted(), 0);
});

test("Governance blocks stale bases, unsafe branches, workspace collisions, and runtime failures before unsafe writes", () => {
  for (const [name, workflowState, options, expected] of [
    [
      "unsafe",
      { ...state(), proposalBranch: "../outside" },
      {},
      "ATLAS_GOVERNANCE_WORKFLOW_STATE_INVALID",
    ],
    [
      "stale",
      state(),
      { currentTargetHead: "dddddddddddddddddddddddddddddddddddddddd" },
      "ATLAS_GOVERNANCE_BASE_SNAPSHOT_STALE",
    ],
    ["exists", state(), { workspaceExists: true }, "ATLAS_GOVERNANCE_WORKSPACE_EXISTS"],
    [
      "path",
      state(),
      { workspacePathValid: false },
      "ATLAS_GOVERNANCE_WORKSPACE_PATH_INVALID",
    ],
    ["runtime", state(), { failCreate: true }, "ATLAS_GOVERNANCE_RUNTIME_FAILED"],
  ] as const) {
    const maintenanceRequest = request({ changeSet: changeSet(workflowState) });
    const adapter = runtime(workflowState, maintenanceRequest, options);
    const result = runAtlasGovernanceWorkflow(
      workflowState,
      maintenanceRequest,
      adapter,
    );
    assert.equal(result.completion, "not-completed", name);
    assert.equal(result.handoff.validationState.findings[0]?.code, expected, name);
  }
});

test("Governance proves every deterministic input gate can fail with specific codes", () => {
  const workflowState = state();
  const invalid = changeSet(workflowState, [
    { content: "missing operation id", path: ".atlas/CHANGELOG.md" },
    {
      content: principleContent("").replace(
        "  id: principle:determinism",
        "  id: principle:empty",
      ),
      path: ".atlas/principles/empty.md",
    },
    {
      content: principleContent(
        "- `truth:dup` One.\n- `truth:dup` Two.\n",
        "No amendment heading.\n",
      ).replace("  id: principle:determinism", "  id: principle:duplicate"),
      path: ".atlas/principles/duplicate.md",
    },
    { content: "bad", path: "../escape.md" },
  ]);
  const codes = validateAtlasGovernanceChangeSet(
    workflowState,
    request({ changeSet: invalid }),
  ).map((entry) => entry.code);

  assert.deepEqual(codes, [
    "ATLAS_GOVERNANCE_CHANGE_SET_PATH_INVALID",
    "ATLAS_GOVERNANCE_CHANGELOG_OPERATION_ID_REQUIRED",
    "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_REQUIRED",
    "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_DUPLICATE",
    "ATLAS_GOVERNANCE_PRINCIPLE_AMENDMENT_REQUIRED",
  ]);

  assert.deepEqual(
    validateAtlasGovernanceChangeSet(
      workflowState,
      request({
        changeSet: {
          baseSnapshotDigest: "stale",
          changes: [
            {
              content: "---\nsdk:\n  id: principle:one\n---\n\nno changelog",
              path: ".atlas/principles/one.md",
            },
          ],
          targetHead: workflowState.targetHead,
        },
      }),
    ).map((entry) => entry.code),
    [
      "ATLAS_GOVERNANCE_CHANGE_SET_STALE",
      "ATLAS_GOVERNANCE_CHANGELOG_REQUIRED",
      "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_REQUIRED",
      "ATLAS_GOVERNANCE_PRINCIPLE_AMENDMENT_REQUIRED",
    ],
  );
  assert.deepEqual(
    validateAtlasGovernanceChangeSet(
      workflowState,
      request({
        action: "retire",
        changeSet: changeSet(workflowState, [
          {
            content: "# Changelog\n\n- governance-op-80: Retired.\n",
            path: ".atlas/CHANGELOG.md",
          },
          {
            content: principleContent("").replace(
              "  id: principle:determinism",
              "  id: principle:retired",
            ),
            path: ".atlas/principles/retired.md",
          },
        ]),
      }),
    ),
    [],
  );
  assert.deepEqual(
    validateAtlasGovernanceChangeSet(
      workflowState,
      request({
        changeSet: changeSet(workflowState),
        subject: "atlas-policy",
      }),
    ).map((entry) => entry.code),
    ["ATLAS_GOVERNANCE_POLICY_CHANGE_REQUIRED"],
  );
  assert.deepEqual(
    validateAtlasGovernanceChangeSet(
      workflowState,
      request({
        changeSet: changeSet(workflowState, [
          {
            content: "# Changelog\n\n- governance-op-80: Policy.\n",
            path: ".atlas/CHANGELOG.md",
          },
          {
            content: policyContent()
              .replace("  id: policy:publication", "  id: publication")
              .replace("  type: policy", "  type: concept"),
            path: ".atlas/types/policy/publication.md",
          },
        ]),
        subject: "atlas-policy",
      }),
    ).map((entry) => entry.code),
    [
      "ATLAS_GOVERNANCE_POLICY_IDENTITY_CHANGED",
      "ATLAS_GOVERNANCE_POLICY_ID_REQUIRED",
      "ATLAS_GOVERNANCE_POLICY_TYPE_REQUIRED",
    ],
  );

  for (const [name, maintenanceRequest, expected] of [
    [
      "approval",
      request({ approvedAt: undefined, approvedBy: undefined }),
      "ATLAS_GOVERNANCE_APPROVAL_REQUIRED",
    ],
    [
      "approval-missing-time",
      request({ approvedAt: undefined, approvedBy: "Fixture Maintainer" }),
      "ATLAS_GOVERNANCE_APPROVAL_REQUIRED",
    ],
    [
      "change-set",
      request({ changeSet: undefined }),
      "ATLAS_GOVERNANCE_CHANGE_SET_REQUIRED",
    ],
    ["delete", request({ action: "delete" }), "ATLAS_GOVERNANCE_DELETE_RETIRES_TRUTHS"],
    [
      "verify-read-only",
      request({ action: "verify" }),
      "ATLAS_GOVERNANCE_VERIFY_IS_READ_ONLY",
    ],
  ] as const) {
    const result = runAtlasGovernanceWorkflow(
      workflowState,
      maintenanceRequest,
      runtime(workflowState, maintenanceRequest),
    );
    assert.equal(result.completion, "not-completed", name);
    assert.equal(result.handoff.validationState.findings[0]?.code, expected, name);
  }
});

test("Governance rejects Principle and Atlas Policy correspondence violations", () => {
  const workflowState = state();
  const basePrinciple = page(
    ".atlas/principles/determinism.md",
    "principle:determinism",
    "principle",
    "Determinism",
    "# Determinism\n\n## Active truths\n\n- `truth:one` Original meaning.\n\n## Amendments\n\n### 1 - 2026-08-21\n\nAdded `truth:one`.\n",
  );
  const changedPrinciple = principleContent(
    "- `truth:new-meaning` Replacement meaning.\n",
  ).replace("  id: principle:determinism", "  id: principle:replacement");
  const principleRequest = request({
    action: "amend",
    changeSet: changeSet(workflowState, [
      {
        content: "# Changelog\n\n- governance-op-80: Amended Principle.\n",
        path: ".atlas/CHANGELOG.md",
      },
      { content: changedPrinciple, path: ".atlas/principles/determinism.md" },
    ]),
  });
  const principleResult = runAtlasGovernanceWorkflow(
    workflowState,
    principleRequest,
    runtime(workflowState, principleRequest, {
      baseFiles: [root, changelog, basePrinciple],
    }),
  );
  assert.equal(principleResult.completion, "not-completed");
  assert.ok(
    principleResult.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_PRINCIPLE_IDENTITY_CHANGED",
    ),
  );
  assert.ok(
    principleResult.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_SUCCESSOR_REQUIRED",
    ),
  );

  const validReplacement = principleContent(
    "- `truth:new-meaning` Replacement meaning.\n",
    [
      "## Amendments",
      "",
      "### 2 - 2026-08-21",
      "",
      "Invalidated `truth:one`; linked successor `truth:new-meaning` records the replacement.",
      "",
    ].join("\n"),
  );
  const validReplacementRequest = request({
    action: "amend",
    changeSet: changeSet(workflowState, [
      {
        content: "# Changelog\n\n- governance-op-80: Amended Principle.\n",
        path: ".atlas/CHANGELOG.md",
      },
      { content: validReplacement, path: ".atlas/principles/determinism.md" },
    ]),
  });
  const validReplacementResult = runAtlasGovernanceWorkflow(
    workflowState,
    validReplacementRequest,
    runtime(workflowState, validReplacementRequest, {
      baseFiles: [root, changelog, basePrinciple],
    }),
  );
  assert.equal(
    validReplacementResult.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_SUCCESSOR_REQUIRED",
    ),
    false,
  );

  const hollowPolicy = policyContent(
    "# Publication\n\n## Policy\n\nExplore is governed by this Policy.\n",
  );
  const hollowRequest = request({
    changeSet: changeSet(workflowState, [
      {
        content: "# Changelog\n\n- governance-op-80: Policy.\n",
        path: ".atlas/CHANGELOG.md",
      },
      { content: hollowPolicy, path: ".atlas/types/policy/publication.md" },
    ]),
    semanticVerdicts: semanticVerdict(),
    subject: "atlas-policy",
  });
  const hollowResult = runAtlasGovernanceWorkflow(
    workflowState,
    hollowRequest,
    runtime(workflowState, hollowRequest),
  );
  assert.equal(hollowResult.completion, "not-completed");
  for (const code of [
    "ATLAS_GOVERNANCE_POLICY_SCOPE_REQUIRED",
    "ATLAS_GOVERNANCE_POLICY_EVALUATION_REQUIRED",
    "ATLAS_GOVERNANCE_POLICY_CONSEQUENCE_REQUIRED",
    "ATLAS_GOVERNANCE_POLICY_EXPLORE_FORBIDDEN",
  ]) {
    assert.ok(
      hollowResult.handoff.validationState.findings.some(
        (entry) => entry.code === code,
      ),
      code,
    );
  }

  const driftRequest = request({
    changeSet: changeSet(workflowState, [
      {
        content: "# Changelog\n\n- governance-op-80: Policy.\n",
        path: ".atlas/CHANGELOG.md",
      },
      {
        content: policyContent().replace(
          "  id: policy:publication",
          "  id: policy:unrelated",
        ),
        path: ".atlas/types/policy/publication.md",
      },
    ]),
    semanticVerdicts: semanticVerdict("policy:unrelated"),
    subject: "atlas-policy",
  });
  const driftResult = runAtlasGovernanceWorkflow(
    workflowState,
    driftRequest,
    runtime(workflowState, driftRequest),
  );
  assert.equal(driftResult.completion, "not-completed");
  assert.ok(
    driftResult.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_POLICY_IDENTITY_CHANGED",
    ),
  );

  const existingPolicy = page(
    ".atlas/types/policy/publication.md",
    "policy:publication",
    "policy",
    "Publication",
    "# Publication\n\n## Scope\n\nAtlas maintenance.\n\n## Evaluation\n\nSemantic.\n\n## Consequence\n\nBlock operation.\n",
  );
  const existingDriftRequest = request({
    changeSet: changeSet(workflowState, [
      {
        content: "# Changelog\n\n- governance-op-80: Policy.\n",
        path: ".atlas/CHANGELOG.md",
      },
      {
        content: policyContent().replace(
          "  id: policy:publication",
          "  id: policy:renamed",
        ),
        path: ".atlas/types/policy/publication.md",
      },
    ]),
    semanticVerdicts: semanticVerdict(),
    subject: "atlas-policy",
  });
  const existingDriftResult = runAtlasGovernanceWorkflow(
    workflowState,
    existingDriftRequest,
    runtime(workflowState, existingDriftRequest, {
      baseFiles: [root, changelog, existingPolicy],
    }),
  );
  assert.equal(existingDriftResult.completion, "not-completed");
  assert.ok(
    existingDriftResult.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_POLICY_IDENTITY_CHANGED",
    ),
  );

  const malformedPathRequest = request({
    changeSet: changeSet(workflowState, [
      {
        content: "# Changelog\n\n- governance-op-80: Policy.\n",
        path: ".atlas/CHANGELOG.md",
      },
      {
        content:
          "# Missing frontmatter\n\n## Scope\n\nPublication.\n\n## Evaluation\n\nSemantic.\n\n## Consequence\n\nBlock operation.\n",
        path: ".atlas/types/policy/publication",
      },
    ]),
    semanticVerdicts: semanticVerdict(),
    subject: "atlas-policy",
  });
  const malformedPathResult = runAtlasGovernanceWorkflow(
    workflowState,
    malformedPathRequest,
    runtime(workflowState, malformedPathRequest),
  );
  assert.equal(malformedPathResult.completion, "not-completed");
  assert.ok(
    malformedPathResult.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_POLICY_ID_REQUIRED",
    ),
  );
});

test("Atlas Policy semantics require resolved evidence, Challenge, and Maintainer escalation on disagreement", () => {
  const workflowState = state();
  const policyChangeSet = changeSet(workflowState, [
    {
      content: "# Changelog\n\n- governance-op-80: Created Publication Policy.\n",
      path: ".atlas/CHANGELOG.md",
    },
    { content: policyContent(), path: ".atlas/types/policy/publication.md" },
  ]);
  for (const [name, semanticVerdicts, expected] of [
    ["missing", undefined, "ATLAS_GOVERNANCE_POLICY_DOCTRINE_UNSUPPORTED"],
    [
      "empty-evidence",
      [
        {
          challenge: {
            argument: "No contrary evidence.",
            evidence: [],
            position: "agree",
          },
          evidence: [],
          policyId: "policy:publication",
          verdict: "pass",
        },
      ],
      "ATLAS_GOVERNANCE_SEMANTIC_EVIDENCE_REQUIRED",
    ],
    [
      "unresolved",
      [
        {
          challenge: {
            argument: "No contrary evidence.",
            evidence: [".atlas/index.md#L1"],
            position: "agree",
          },
          evidence: [".atlas/missing.md"],
          policyId: "policy:publication",
          verdict: "pass",
        },
      ],
      "ATLAS_GOVERNANCE_SEMANTIC_EVIDENCE_UNRESOLVED",
    ],
    [
      "invalid-reference",
      [
        {
          challenge: {
            argument: "No contrary evidence.",
            evidence: [".atlas/index.md#L1"],
            position: "agree",
          },
          evidence: [".atlas/../index.md"],
          policyId: "policy:publication",
          verdict: "pass",
        },
      ],
      "ATLAS_GOVERNANCE_SEMANTIC_EVIDENCE_UNRESOLVED",
    ],
    [
      "blank-challenge",
      [
        {
          challenge: {
            argument: " ",
            evidence: [".atlas/index.md#L1"],
            position: "agree",
          },
          evidence: [".atlas/index.md#L1"],
          policyId: "policy:publication",
          verdict: "pass",
        },
      ],
      "ATLAS_GOVERNANCE_CHALLENGE_ARGUMENT_REQUIRED",
    ],
    [
      "unmatched-policy",
      semanticVerdict("policy:unrelated"),
      "ATLAS_GOVERNANCE_POLICY_VERDICT_MISSING",
    ],
    [
      "failing-verdict",
      semanticVerdict("policy:publication", "fail"),
      "ATLAS_GOVERNANCE_SEMANTIC_VERDICT_FAILED",
    ],
    [
      "disagree",
      [
        {
          challenge: {
            argument: "The cited text does not prove enforceability.",
            evidence: [".atlas/index.md#L1"],
            position: "disagree",
          },
          evidence: [".atlas/index.md#L1"],
          policyId: "policy:publication",
          verdict: "pass",
        },
      ],
      "ATLAS_GOVERNANCE_SEMANTIC_DISAGREEMENT",
    ],
  ] as const) {
    const maintenanceRequest = request({
      changeSet: policyChangeSet,
      semanticVerdicts,
      subject: "atlas-policy",
    });
    const result = runAtlasGovernanceWorkflow(
      workflowState,
      maintenanceRequest,
      runtime(workflowState, maintenanceRequest),
    );
    assert.equal(result.completion, "not-completed", name);
    assert.ok(
      result.handoff.validationState.findings.some((entry) => entry.code === expected),
      name,
    );
    if (name === "disagree") {
      assert.equal(result.handoff.unresolvedHumanDecisions.state, "pending");
    }
  }
});

test("Atlas Policy semantic agreement can produce a proposal while stale stamps and failed Lint block", () => {
  const workflowState = state();
  const policyChangeSet = changeSet(workflowState, [
    {
      content: "# Changelog\n\n- governance-op-80: Created Publication Policy.\n",
      path: ".atlas/CHANGELOG.md",
    },
    { content: policyContent(), path: ".atlas/types/policy/publication.md" },
  ]);
  const maintenanceRequest = request({
    changeSet: policyChangeSet,
    semanticVerdicts: semanticVerdict(),
    subject: "atlas-policy",
  });

  assert.equal(
    runAtlasGovernanceWorkflow(
      workflowState,
      maintenanceRequest,
      runtime(workflowState, maintenanceRequest),
    ).completion,
    "completed",
  );
  assert.equal(
    runAtlasGovernanceWorkflow(
      workflowState,
      maintenanceRequest,
      runtime(workflowState, maintenanceRequest, {
        lintReceipt: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      }),
    ).handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_LINT_STAMP_STALE",
  );
  assert.equal(
    runAtlasGovernanceWorkflow(
      workflowState,
      maintenanceRequest,
      runtime(workflowState, maintenanceRequest, { lintUsesEmptyAtlas: true }),
    ).handoff.result.summary,
    "Governance proposal did not pass trusted Lint.",
  );
});

test("Verification-only governance creates no proposal and can fail read-only", () => {
  const workflowState = state();
  const maintenanceRequest = request({
    action: "verify",
    approvedAt: undefined,
    approvedBy: undefined,
    changeSet: undefined,
  });
  const successAdapter = runtime(workflowState, maintenanceRequest);
  const success = runAtlasGovernanceWorkflow(
    workflowState,
    maintenanceRequest,
    successAdapter,
  );
  const readOnlyViolation = runAtlasGovernanceWorkflow(
    workflowState,
    request({ action: "verify", changeSet: changeSet(workflowState) }),
    runtime(
      workflowState,
      request({ action: "verify", changeSet: changeSet(workflowState) }),
    ),
  );
  const failed = runAtlasGovernanceWorkflow(
    workflowState,
    maintenanceRequest,
    runtime(workflowState, maintenanceRequest, {
      baseFiles: [],
      lintUsesEmptyAtlas: true,
    }),
  );
  const notCompletedLint = notCompletedLintOperationResult({
    baseSnapshotReason: "synthetic",
    code: "ATLAS_LINT_USAGE",
    homeAtlasReason: "synthetic",
    message: "synthetic not-completed lint",
    recommendedNextAction: "fix synthetic lint input",
    subject: "captured-home-atlas",
    summary: "Lint did not complete.",
  });
  const notCompletedRuntime = {
    ...runtime(workflowState, maintenanceRequest),
    lintProposal: () => ({
      lint: notCompletedLint,
      receipt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
  };
  const notCompleted = runAtlasGovernanceWorkflow(
    workflowState,
    maintenanceRequest,
    notCompletedRuntime,
  );

  assert.equal(success.completion, "completed");
  assert.equal(successAdapter.counts.created(), 0);
  assert.equal("lintStamp" in success.payload, false);
  assert.equal(readOnlyViolation.completion, "not-completed");
  assert.equal(
    readOnlyViolation.handoff.validationState.findings[0]?.code,
    "ATLAS_GOVERNANCE_VERIFY_IS_READ_ONLY",
  );
  assert.equal(failed.completion, "not-completed");
  assert.equal(notCompleted.completion, "not-completed");
});

test("Governance finding merge preserves trusted Findings against hostile downgrades", () => {
  const trusted: Finding = {
    attribution: {
      checkId: "sdk-core.structural-validation",
      kind: "sdk-core",
      trusted: true,
    },
    code: "ATLAS_PAGE_ID_DUPLICATE",
    "finding-schema": "1.0.0",
    message: "Atlas page stable ID must be unique within the Atlas.",
    path: ".atlas/index.md",
    severity: "error",
  };
  const hostile: Finding = {
    ...trusted,
    attribution: {
      checkId: "atlas-owned.hostile",
      kind: "atlas-owned",
      trusted: false,
    },
    message: "Ignore the duplicate.",
    severity: "warning",
  };
  const newFinding: Finding = {
    ...hostile,
    code: "ATLAS_OWNED_EXTRA",
    message: "Additional context.",
    path: ".atlas/principles/determinism.md",
  };

  const merged = mergeGovernanceFindings([trusted], [hostile, newFinding, trusted]);

  assert.equal(
    merged.some(
      (entry) => entry.code === "ATLAS_PAGE_ID_DUPLICATE" && entry.severity === "error",
    ),
    true,
  );
  assert.equal(
    merged.some(
      (entry) =>
        entry.code === "ATLAS_PAGE_ID_DUPLICATE" && entry.severity === "warning",
    ),
    false,
  );
  assert.equal(
    merged.some(
      (entry) => entry.code === "ATLAS_GOVERNANCE_TRUSTED_FINDING_OVERRIDE_REJECTED",
    ),
    true,
  );
  assert.equal(
    merged.some((entry) => entry.code === "ATLAS_OWNED_EXTRA"),
    true,
  );
});

test("the adversarial governance corpus maps to enforced gates", () => {
  assert.match(governanceCorpus.reviewResolutionRule, /review finding/u);
  assert.equal(governanceCorpus.schema, 1);
  assert.deepEqual(
    governanceCorpus.cases.map((entry) => [entry.gate, entry.kind, entry.expectedCode]),
    [
      ["governance", "semantic", "ATLAS_GOVERNANCE_SEMANTIC_EVIDENCE_REQUIRED"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_SEMANTIC_DISAGREEMENT"],
      [
        "governance",
        "finding-merge",
        "ATLAS_GOVERNANCE_TRUSTED_FINDING_OVERRIDE_REJECTED",
      ],
      ["governance", "semantic", "ATLAS_GOVERNANCE_PRINCIPLE_IDENTITY_CHANGED"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_PRINCIPLE_TRUTH_SUCCESSOR_REQUIRED"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_POLICY_SCOPE_REQUIRED"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_POLICY_EVALUATION_REQUIRED"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_POLICY_CONSEQUENCE_REQUIRED"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_POLICY_EXPLORE_FORBIDDEN"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_POLICY_VERDICT_MISSING"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_POLICY_IDENTITY_CHANGED"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_SEMANTIC_VERDICT_FAILED"],
      ["governance", "semantic", "ATLAS_GOVERNANCE_RESUME_CHANGE_SET_MISMATCH"],
    ],
  );
});
