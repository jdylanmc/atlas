import type { TSchema } from "@sinclair/typebox";
import type { Finding } from "../domain/finding.ts";
import {
  operationHandoffSchemaVersion,
  operationResultSchemaVersion,
  type OperationHandoff,
  type OperationResult,
} from "../operations/operation_result.ts";
import {
  governanceInput,
  governCommandInputBudgets,
  ingestCommandInputBudgets,
  ingestRequestInput,
  ingestScopeInput,
} from "./command_input_contracts.ts";
import {
  governanceInputGuidance,
  governancePrincipleExample,
} from "./governance_input_reference.ts";

const definitions = Object.freeze({
  "ingest-scope": {
    input: ingestScopeInput,
    maxFileBytes: ingestCommandInputBudgets.maxFileBytes,
  },
  "ingest-request": {
    input: ingestRequestInput,
    maxFileBytes: ingestCommandInputBudgets.maxFileBytes,
  },
  "governance-request": {
    input: governanceInput,
    maxFileBytes: governCommandInputBudgets.maxFileBytes,
  },
});

type InputContractName = keyof typeof definitions;

export const inputContractCommandUsage = `usage: atlas input-contract --machine <${Object.keys(definitions).join("|")}>`;

export function serializeCallerInputResult(
  result: OperationResult & {
    readonly operation: { readonly kind: "ingest" | "governance" };
  },
): string {
  if (result.disposition === "success") return `${JSON.stringify(result)}\n`;
  const names: readonly InputContractName[] =
    result.operation.kind === "ingest"
      ? ["ingest-scope", "ingest-request"]
      : ["governance-request"];
  const commands = names
    .map((name) => `atlas input-contract --machine ${name}`)
    .join("; ");
  return `${JSON.stringify({
    ...result,
    handoff: {
      ...result.handoff,
      recommendedNextAction: `${result.handoff.recommendedNextAction}\nInput contracts: ${commands}`,
    },
  })}\n`;
}

interface InputContract {
  readonly name: InputContractName;
  readonly schema: TSchema;
  readonly maxFileBytes: number;
  readonly guidance: readonly string[];
  readonly principleExample?: typeof governancePrincipleExample;
}

interface InputContractOperation {
  readonly kind: "input-contract";
  readonly subject: "caller-authored-json";
}

export type InputContractResult = OperationResult<
  InputContractOperation,
  OperationHandoff<InputContractOperation>,
  | { readonly state: "completed"; readonly contract: InputContract }
  | { readonly state: "not-completed" }
>;

function isContractName(name: string | undefined): name is InputContractName {
  return name !== undefined && Object.hasOwn(definitions, name);
}

function describeInputContract(name: InputContractName): InputContract {
  const definition = definitions[name];
  return Object.freeze({
    name,
    schema: Object.freeze({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://atlas.dev/schema/cli/${name}/1.0.0.json`,
      ...definition.input.schema,
    }),
    maxFileBytes: definition.maxFileBytes,
    ...(name === "governance-request"
      ? { principleExample: governancePrincipleExample }
      : {}),
    guidance: Object.freeze([
      "This schema describes JSON shape, not human authorization or successful execution. Ingest and Governance still validate approval, timestamps, correspondence, Atlas policy, and resulting knowledge.",
      "x-maxUtf8Bytes bounds the UTF-8 encoded bytes of a string, not its character count. The CLI enforces this annotation; generic JSON Schema validators must register it to enforce byte budgets.",
      "Unknown object fields are ignored. All detectable shape violations are reported together; malformed or oversized containers report their container violation without inspecting children. Independent sibling fields are still checked. A forbidden field reports its prohibition, not errors within its unused contents.",
      "Identical array-field violations are compacted without omission: items[0..3,7].field means indices 0, 1, 2, 3, and 7, never 4 through 6. Nested ranges apply only to the same child index set at every listed parent. Each affected index is retained; no error-count quota is imposed.",
      "When shorter, an index set uses an exact hexadecimal byte mask: items[mask@8:55].field selects indices 8, 10, 12, and 14. The offset after @ is byte-aligned; read each pair of hex digits as one byte, least-significant bit first. Set bit k in byte j selects offset + 8*j + k. Zero bits never select an index. This representation also preserves arbitrary gaps and nested child sets.",
      ...(name === "governance-request"
        ? governanceInputGuidance
        : [
            "attestation is a detached Approval Attestation, not approvedBy/approvedAt fields at the Scope root. Approval is bound to the exact Scope; copying or inventing an attestation is not human approval.",
            "asOf, approvedAt, optional expiresAt, and Source revisionTime are timestamp strings checked by the operation. Number fields describe finite numbers at this decoding boundary; they are not silently narrowed to integers.",
            "Planning hands a Crawl Assignment to the caller; it does not crawl. Reconciliation accepts a Candidate Graph whose Source identity, captured content, citations, locators, authority, and freshness must correspond to the approved Scope and actual Source evidence.",
          ]),
    ]),
  });
}

export function runInputContractCommand(
  arguments_: readonly string[],
): InputContractResult {
  const name = arguments_[1] === "--machine" ? arguments_[2] : arguments_[1];
  const known = isContractName(name);
  const contract =
    known && arguments_.length === 3 && arguments_.includes("--machine")
      ? describeInputContract(name)
      : undefined;
  const completed = contract !== undefined;
  const findings: readonly Finding[] = Object.freeze(
    completed
      ? []
      : [
          Object.freeze({
            attribution: Object.freeze({
              checkId: "sdk-core.input-contract",
              kind: "sdk-core" as const,
              trusted: true as const,
            }),
            code: "ATLAS_INPUT_CONTRACT_USAGE",
            "finding-schema": "1.0.0" as const,
            message: inputContractCommandUsage,
            path: "input-contract",
            severity: "error" as const,
          }),
        ],
  );
  const operation = Object.freeze({
    kind: "input-contract" as const,
    subject: "caller-authored-json" as const,
  });
  const noAtlasEffect = Object.freeze({
    state: "not-applicable" as const,
    reason:
      "Input contract discovery does not read or mutate an Atlas or create a proposal.",
  });
  const summary = completed
    ? "Returned CLI input documentation. No Ingest or Governance operation was executed."
    : "Input contract discovery requires one known contract name and --machine.";
  const disposition = completed ? "success" : "failed";
  return Object.freeze({
    "operation-result-schema": operationResultSchemaVersion,
    completion: completed ? "completed" : "not-completed",
    disposition,
    operation,
    handoff: Object.freeze({
      "operation-handoff-schema": operationHandoffSchemaVersion,
      baseSnapshot: noAtlasEffect,
      homeAtlas: noAtlasEffect,
      proposedChanges: noAtlasEffect,
      reviewLink: noAtlasEffect,
      operation,
      result: Object.freeze({ disposition, summary }),
      recommendedNextAction: completed
        ? "Use the schema and guidance to author input; obtain any required human approval separately."
        : inputContractCommandUsage,
      degradationState: Object.freeze({ state: "not-degraded", reason: summary }),
      unresolvedHumanDecisions: Object.freeze({
        state: "none",
        summary: "Reading input documentation requires no human decision.",
      }),
      validationState: Object.freeze({
        state: completed ? "passed" : "not-completed",
        findings,
      }),
    }),
    payload:
      contract === undefined
        ? Object.freeze({ state: "not-completed" })
        : Object.freeze({ state: "completed", contract }),
  });
}
