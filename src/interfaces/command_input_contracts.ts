import type {
  AtlasIngestCandidateCitation,
  AtlasIngestCandidateConcept,
  AtlasIngestCandidateContradiction,
  AtlasIngestCandidateEdge,
  AtlasIngestCandidateGraph,
  AtlasIngestCandidateSource,
  AtlasIngestDispute,
  AtlasIngestRequest,
  AtlasIngestScope,
  SourceAuthority,
} from "../operations/ingest_operation.ts";
import type { AtlasApprovalAttestation } from "../operations/operation_support.ts";
import type {
  AtlasGovernanceChange,
  AtlasGovernanceRequest,
  AtlasGovernanceSemanticVerdict,
  AtlasGovernanceSubject,
} from "../operations/governance_operation.ts";
import {
  arrayInput,
  enumInput,
  literalInput,
  nullableInput,
  numberInput,
  objectInput,
  optionalInput,
  textInput,
} from "./input_contract.ts";

export const ingestCommandInputBudgets = Object.freeze({
  maxFileBytes: 1024 * 1024,
  // Bounds distinct Source locators before independent Git capture.
  maxSources: 32,
});

// Every axis a caller controls is bounded. The axis the 32-change cap controls
// is the authored governance change: the platform adapter spends two Git
// subprocesses (one `git hash-object -w`, one `git update-index`) per change,
// ~38ms per change measured on the development host. Atlas SDK derives one
// additional change — the stamped Atlas Changelog entry — so a worst-case
// proposal writes 33 changes. That derived entry is bounded too: its authored
// input is the `changelog` prose, a single line capped at maxChangelogBytes. A
// full
// worst-case proposal at this cap — 32 authored changes totaling ~790 KiB plus
// the derived Changelog, driven end to end through the command (base-snapshot
// capture, the Git subprocesses, one commit, and one whole-Atlas Lint) —
// measured ~3.3-4.0s of wall time across repeated runs; a real Principle or
// Atlas Policy proposal touches a handful of pages plus the drafted prose. Byte,
// element, and string caps below keep validation and the JSON read linear, and
// the accepted request shape is non-recursive, so nesting depth is fixed by the
// parser rather than by caller input. One caveat the caller must size for: the
// machine Operation Result echoes the derived Atlas Change Set, so worst-case
// stdout (~1.6 MiB measured) exceeds the 1 MiB input budget; a consumer reading
// the result must allow a read buffer larger than the input.
export const governCommandInputBudgets = Object.freeze({
  maxChangeContentBytes: 256 * 1024,
  maxChangelogBytes: 8192,
  maxChanges: 32,
  maxEvidencePerList: 64,
  maxFileBytes: 1024 * 1024,
  maxPathBytes: 1024,
  maxSemanticVerdicts: 32,
  maxStringBytes: 8192,
});

const sourceAuthorities = {
  community: true,
  "first-party": true,
  official: true,
  opinion: true,
} as const satisfies Record<SourceAuthority, true>;

function approvalAttestationInput(maxBytes?: number) {
  const options = maxBytes === undefined ? {} : { maxBytes };
  return objectInput<AtlasApprovalAttestation>({
    "approval-attestation-schema": literalInput("1.0.0", options),
    approvedAt: textInput(options),
    approver: textInput(options),
    expiresAt: optionalInput(textInput(options)),
    nonce: textInput(options),
    operation: textInput(options),
    payloadDigest: textInput(options),
  });
}

export const ingestScopeInput = objectInput<AtlasIngestScope>({
  "ingest-scope-schema": literalInput("1.0.0"),
  asOf: textInput(),
  attestation: approvalAttestationInput(),
  authority: enumInput(sourceAuthorities, "must name a recognized Source Authority"),
  entryPoint: textInput(),
  excludedPaths: arrayInput(textInput()),
  freshnessWindowDays: numberInput(),
  includedPaths: arrayInput(textInput()),
  maxDepth: numberInput(),
  sourceId: textInput(),
});

const citationInput = objectInput<AtlasIngestCandidateCitation>({
  sourceClaim: textInput(),
  sourceId: textInput(),
});

const contradictionInput = objectInput<AtlasIngestCandidateContradiction>({
  acceptedBy: optionalInput(textInput()),
  atlasPolicyId: optionalInput(textInput()),
  principleTruthId: optionalInput(textInput()),
});

const conceptInput = objectInput<AtlasIngestCandidateConcept>({
  citations: arrayInput(citationInput),
  claim: textInput(),
  contradiction: optionalInput(contradictionInput),
  id: textInput(),
  locator: textInput(),
  title: textInput(),
});

const edgeInput = objectInput<AtlasIngestCandidateEdge>({
  citations: arrayInput(citationInput),
  context: textInput(),
  from: textInput(),
  id: textInput(),
  semantics: arrayInput(textInput()),
  title: textInput(),
  to: textInput(),
});

const sourceInput = objectInput<AtlasIngestCandidateSource>({
  authority: enumInput(sourceAuthorities, "must name a recognized Source Authority"),
  content: textInput(),
  id: textInput(),
  locator: textInput(),
  refreshWindowDays: numberInput(),
  revisionTime: textInput(),
  title: textInput(),
});

const disputeInput = objectInput<AtlasIngestDispute>({
  leftConceptId: textInput(),
  rightConceptId: textInput(),
});

const graphInput = objectInput<AtlasIngestCandidateGraph>({
  "candidate-graph-schema": literalInput("1.0.0"),
  concepts: arrayInput(conceptInput),
  disputes: arrayInput(disputeInput),
  edges: arrayInput(edgeInput),
  sources: arrayInput(sourceInput, {
    maxItems: ingestCommandInputBudgets.maxSources,
    name: "Source",
  }),
});

export const ingestRequestInput = objectInput<AtlasIngestRequest>({
  "ingest-request-schema": literalInput("1.0.0"),
  candidateGraph: graphInput,
  scope: ingestScopeInput,
});

const governanceActions = {
  amend: true,
  create: true,
  delete: true,
  retire: true,
  verify: true,
} as const satisfies Record<AtlasGovernanceRequest["action"], true>;

const governanceSubjects = {
  "atlas-policy": true,
  principle: true,
} as const satisfies Record<AtlasGovernanceSubject, true>;

const governText = { maxBytes: governCommandInputBudgets.maxStringBytes };
const governEvidence = arrayInput(textInput(governText), {
  maxItems: governCommandInputBudgets.maxEvidencePerList,
  name: "element",
});
const governChange = objectInput<AtlasGovernanceChange>({
  content: nullableInput(
    textInput({ maxBytes: governCommandInputBudgets.maxChangeContentBytes }),
  ),
  path: textInput({ maxBytes: governCommandInputBudgets.maxPathBytes }),
});
const governVerdict = objectInput<AtlasGovernanceSemanticVerdict>({
  challenge: objectInput<AtlasGovernanceSemanticVerdict["challenge"]>({
    argument: textInput(governText),
    evidence: governEvidence,
    position: enumInput(
      { agree: true, disagree: true },
      'must be "agree" or "disagree"',
      governText,
    ),
  }),
  evidence: governEvidence,
  policyId: textInput(governText),
  verdict: enumInput(
    { pass: true, fail: true },
    'must be "pass" or "fail"',
    governText,
  ),
});

export const governanceInput = objectInput<AtlasGovernanceRequest>(
  {
    "governance-request-schema": literalInput("1.0.0", governText),
    action: enumInput(governanceActions, "must name a governance action", governText),
    subject: enumInput(
      governanceSubjects,
      "must name a governance subject",
      governText,
    ),
    attestation: optionalInput(
      approvalAttestationInput(governCommandInputBudgets.maxStringBytes),
    ),
    changelog: optionalInput(
      textInput({
        maxBytes: governCommandInputBudgets.maxChangelogBytes,
        singleLine: true,
      }),
    ),
    changes: optionalInput(
      arrayInput(governChange, {
        maxItems: governCommandInputBudgets.maxChanges,
        name: "change",
      }),
    ),
    semanticVerdicts: optionalInput(
      arrayInput(governVerdict, {
        maxItems: governCommandInputBudgets.maxSemanticVerdicts,
        name: "verdict",
      }),
    ),
  },
  [
    {
      property: "action",
      values: ["verify"],
      field: "attestation",
      presence: "forbidden",
      message: "Verification-only requests must not carry an attestation",
    },
    {
      property: "action",
      values: Object.keys(governanceActions).filter((action) => action !== "verify"),
      field: "attestation",
      presence: "required",
      message: "is required",
    },
  ],
);
