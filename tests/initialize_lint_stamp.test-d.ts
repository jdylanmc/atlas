import type {
  LintStamp,
  SuccessfulProposalLint,
} from "../src/operations/initialize_operation.ts";
import type { CompletedLintOperationPayload } from "../src/operations/lint_operation.ts";

const validLint = Object.freeze({
  findings: Object.freeze([]),
  opaque: Object.freeze([]),
  outcome: "valid" as const,
  pages: Object.freeze([]),
});

// @ts-expect-error missing the non-exported completed-Lint payload brand.
const forgedCompletedPayload: CompletedLintOperationPayload = {
  lint: validLint,
  state: "completed",
};

// @ts-expect-error missing the non-exported Lint Stamp brand.
const forgedLintStamp: LintStamp = {
  "lint-stamp-schema": "1.0.0",
  atlasCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  evidenceRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

// @ts-expect-error missing the non-exported successful-proposal-Lint brand.
const forgedSuccessfulProposalLint: SuccessfulProposalLint = {
  atlasCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  evidenceRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  lint: null as unknown as SuccessfulProposalLint["lint"],
};

void forgedCompletedPayload;
void forgedLintStamp;
void forgedSuccessfulProposalLint;
