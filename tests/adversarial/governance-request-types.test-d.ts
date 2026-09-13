import type { AtlasGovernanceRequest } from "../../src/index.ts";
import { runAtlasGovernanceWorkflow } from "../../src/index.ts";
import { governanceAttestationPayload } from "../../src/operations/governance_operation.ts";

type AtlasApprovalAttestation = NonNullable<AtlasGovernanceRequest["attestation"]>;
declare const attestation: AtlasApprovalAttestation;
declare const state: Parameters<typeof runAtlasGovernanceWorkflow>[0];
declare const runtime: Parameters<typeof runAtlasGovernanceWorkflow>[2];
const fields = {
  "governance-request-schema": "1.0.0" as const,
  subject: "principle" as const,
};

// @ts-expect-error Creating governance knowledge requires approval.
const create: AtlasGovernanceRequest = { ...fields, action: "create" };
// @ts-expect-error Amending governance knowledge requires approval.
const amend: AtlasGovernanceRequest = { ...fields, action: "amend" };
// @ts-expect-error Retiring governance knowledge requires approval.
const retire: AtlasGovernanceRequest = { ...fields, action: "retire" };
// @ts-expect-error Deleting governance knowledge requires approval.
const remove: AtlasGovernanceRequest = { ...fields, action: "delete" };
// @ts-expect-error Verification does not carry approval.
const approvedVerify: AtlasGovernanceRequest = {
  ...fields,
  action: "verify",
  attestation,
};
// @ts-expect-error An explicitly undefined attestation cannot approve a mutation.
const undefinedApproval: AtlasGovernanceRequest = {
  ...fields,
  action: "create",
  attestation: undefined,
};
void [create, amend, retire, remove, approvedVerify, undefinedApproval];

// @ts-expect-error The public workflow cannot accept an unapproved mutation either.
runAtlasGovernanceWorkflow(state, { ...fields, action: "create" }, runtime);

const verify: AtlasGovernanceRequest = { ...fields, action: "verify" };
runAtlasGovernanceWorkflow(state, verify, runtime);
const purge: AtlasGovernanceRequest = {
  ...fields,
  action: "retire",
  attestation,
  changelog: "The former workflow is obsolete.",
  changes: [{ path: ".atlas/principles/example.md", content: null }],
};
runAtlasGovernanceWorkflow(state, purge, runtime);
const invalidChange: NonNullable<AtlasGovernanceRequest["changes"]>[number] = {
  path: ".atlas/principles/example.md",
  // @ts-expect-error File changes require authored text or an explicit null removal.
  content: 42,
};
void invalidChange;
for (const action of ["create", "amend", "retire", "delete"] as const) {
  const approved: AtlasGovernanceRequest = { ...fields, action, attestation };
  const approval: AtlasApprovalAttestation = approved.attestation;
  void approval;
  runAtlasGovernanceWorkflow(state, approved, runtime);
  governanceAttestationPayload({ ...fields, action });
}

declare const request: AtlasGovernanceRequest;
if (request.action !== "verify") {
  const approval: AtlasApprovalAttestation = request.attestation;
  void approval;
}
