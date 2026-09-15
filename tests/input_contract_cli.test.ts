import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import type { TSchema } from "@sinclair/typebox";
import type { InputContractResult } from "../src/interfaces/input_contract_command.ts";
import { parseGovernRequest } from "../src/interfaces/governance_command.ts";
import {
  parseIngestRequest,
  parseIngestScope,
  parseIngestSourceProbe,
} from "../src/interfaces/ingest_command.ts";
import { readInstalledConsumerCorpus } from "./installed_consumer_corpus.ts";

const Ajv2020 = Ajv2020Module.default;
const command = resolve(import.meta.dirname, "../scripts/atlas.ts");

interface ContractPayload {
  readonly state: "completed";
  readonly contract: {
    readonly name: string;
    readonly schema: TSchema;
    readonly maxFileBytes: number;
    readonly guidance: readonly string[];
    readonly principleExample?: {
      readonly path: string;
      readonly content: string;
      readonly notice: string;
      readonly replacementAmendment: string;
    };
  };
}

function describe(name: string): ContractPayload["contract"] {
  const child = spawnSync(
    process.execPath,
    [command, "input-contract", "--machine", name],
    {
      encoding: "utf8",
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
  const result = JSON.parse(child.stdout) as InputContractResult;
  assert.equal(result["operation-result-schema"], "1.0.0");
  assert.equal(result.operation.kind, "input-contract");
  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.payload.state, "completed");
  assert.equal(result.handoff["operation-handoff-schema"], "1.0.0");
  assert.deepEqual(result.handoff.operation, result.operation);
  assert.equal(result.handoff.baseSnapshot.state, "not-applicable");
  assert.equal(result.handoff.homeAtlas.state, "not-applicable");
  assert.equal(result.handoff.proposedChanges.state, "not-applicable");
  assert.equal(result.handoff.reviewLink.state, "not-applicable");
  return result.payload.contract;
}

function schemaValidator() {
  return new Ajv2020({ strict: true }).addKeyword({
    keyword: "x-maxUtf8Bytes",
    schemaType: "number",
    validate: (limit: number, value: unknown) =>
      typeof value !== "string" || Buffer.byteLength(value, "utf8") <= limit,
  });
}

test("CLI describes the complete Ingest Scope JSON shape without selecting an Atlas", () => {
  const contract = describe("ingest-scope");
  assert.equal(contract.name, "ingest-scope");
  assert.equal(contract.maxFileBytes, 1_048_576);
  assert.equal(contract.schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(contract.schema["required"], [
    "ingest-scope-schema",
    "asOf",
    "attestation",
    "authority",
    "entryPoint",
    "excludedPaths",
    "freshnessWindowDays",
    "includedPaths",
    "maxDepth",
    "sourceId",
  ]);
  const validator = new Ajv2020({ strict: true });
  assert.equal(validator.validateSchema(contract.schema), true);
  assert.equal(validator.compile(contract.schema)({}), false);
});

test("CLI describes the tracking-probe input without implying authenticated approval", () => {
  const contract = describe("ingest-source-probe");
  assert.equal(contract.name, "ingest-source-probe");
  assert.equal(contract.maxFileBytes, 1_048_576);
  assert.deepEqual(contract.schema["required"], [
    "approvedAt",
    "approvedBy",
    "asOf",
    "atlasPath",
    "branch",
    "fromAnchorId",
    "repositoryLocator",
    "title",
  ]);
  const validate = schemaValidator().compile(contract.schema);
  const input: unknown = JSON.parse(
    readFileSync(
      new URL("./fixtures/ingest/source-probe-valid.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(validate(input), true);
  assert.equal(parseIngestSourceProbe(input).ok, true);
  assert.equal(validate({}), false);
  assert.match(contract.guidance.join("\n"), /caller assertions/u);
  assert.match(contract.guidance.join("\n"), /not fetch/u);
});

test("Governance schema describes conditional approval and UTF-8 budgets", () => {
  const contract = describe("governance-request");
  const validator = schemaValidator();
  const validate = validator.compile(contract.schema);
  const verification = {
    "governance-request-schema": "1.0.0",
    action: "verify",
    subject: "principle",
  };
  assert.equal(validate(verification), true);
  assert.equal(validate({ ...verification, action: "create" }), false);
  assert.equal(validate({ ...verification, attestation: {} }), false);
  assert.equal(validate({ ...verification, changelog: "é".repeat(4096) }), true);
  assert.equal(validate({ ...verification, changelog: "é".repeat(4097) }), false);
  for (const lineBreak of ["\n", "\r", "\v", "\f", "\u0085", "\u2028", "\u2029"]) {
    const input = { ...verification, changelog: `prose${lineBreak}` };
    assert.equal(validate(input), false);
    assert.equal(parseGovernRequest(input).ok, false);
  }
  const scope = JSON.parse(
    readFileSync(
      new URL("./fixtures/ingest/scope-approved.json", import.meta.url),
      "utf8",
    ),
  ) as {
    readonly attestation: unknown;
  };
  for (const action of ["create", "amend", "retire", "delete"]) {
    const missing = { ...verification, action };
    assert.equal(validate(missing), false);
    assert.equal(parseGovernRequest(missing).ok, false);
    const present = { ...missing, attestation: scope.attestation };
    assert.equal(validate(present), true);
    assert.equal(parseGovernRequest(present).ok, true);
    for (const content of [null, ""]) {
      const input = {
        ...present,
        changes: [{ path: ".atlas/principles/example.md", content }],
      };
      assert.equal(validate(input), true);
      const parsed = parseGovernRequest(input);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.value.changes?.[0]?.content, content);
    }
    for (const content of [false, 0, {}, []]) {
      const input = {
        ...present,
        changes: [{ path: ".atlas/principles/example.md", content }],
      };
      assert.equal(validate(input), false);
      assert.equal(parseGovernRequest(input).ok, false);
    }
  }
});

test("Emitted schemas and decoding agree on installed adversarial inputs and valid shapes", () => {
  const parsers = {
    "ingest-scope": parseIngestScope,
    "ingest-request": parseIngestRequest,
    "ingest-source-probe": parseIngestSourceProbe,
    "governance-request": parseGovernRequest,
  };
  const schemas = {
    "ingest-scope": schemaValidator().compile(describe("ingest-scope").schema),
    "ingest-request": schemaValidator().compile(describe("ingest-request").schema),
    "ingest-source-probe": schemaValidator().compile(
      describe("ingest-source-probe").schema,
    ),
    "governance-request": schemaValidator().compile(
      describe("governance-request").schema,
    ),
  };
  for (const entry of readInstalledConsumerCorpus().cases) {
    for (const probe of entry.inputContracts ?? []) {
      assert.equal(schemas[probe.name](probe.input), false);
      const parsed = parsers[probe.name](probe.input);
      assert.equal(parsed.ok, false);
      const messages = parsed.result.handoff.validationState.findings
        .filter(({ code }) => code.endsWith("_INPUT_INVALID"))
        .flatMap(({ message }) => message.split("\n"));
      assert.equal(messages.length, probe.expectedPaths.length);
      for (const path of probe.expectedPaths) {
        assert.ok(
          messages.some((message) => message.startsWith(`${path} `)),
          path,
        );
      }
    }
  }
  const scope = JSON.parse(
    readFileSync(
      new URL("./fixtures/ingest/scope-approved.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const request: unknown = JSON.parse(
    readFileSync(
      new URL("./fixtures/ingest/request-valid.json", import.meta.url),
      "utf8",
    ),
  );
  for (const input of [
    scope,
    { ...scope, maxDepth: -0.5, freshnessWindowDays: 1.25, extra: { ignored: true } },
  ]) {
    assert.equal(schemas["ingest-scope"](input), true);
    assert.equal(parseIngestScope(input).ok, true);
  }
  for (const number of [Infinity, -Infinity, NaN]) {
    const input = { ...scope, maxDepth: number };
    assert.equal(schemas["ingest-scope"](input), false);
    assert.equal(parseIngestScope(input).ok, false);
  }
  assert.equal(schemas["ingest-request"](request), true);
  assert.equal(parseIngestRequest(request).ok, true);
});

test("CLI input refusals point directly to retrievable contracts", () => {
  for (const [arguments_, name] of [
    [["ingest", "plan", "--machine"], "ingest-scope"],
    [["ingest", "reconcile", "--machine"], "ingest-request"],
    [["govern", "--machine"], "governance-request"],
  ] as const) {
    const child = spawnSync(process.execPath, [command, ...arguments_], {
      encoding: "utf8",
    });
    assert.equal(child.status, 64);
    const result = JSON.parse(child.stdout) as InputContractResult;
    assert.ok(
      result.handoff.recommendedNextAction.includes(
        `atlas input-contract --machine ${name}`,
      ),
    );
    assert.equal(describe(name).name, name);
  }
});

test("CLI Governance guidance explains path identity and an actual Principle Amendment format", () => {
  const contract = describe("governance-request");
  const example = contract.principleExample;
  assert.ok(example);
  assert.equal(example.path, ".atlas/principles/quality.md");
  assert.match(example.content, /id: principle:quality/u);
  assert.match(example.content, /^## Active truths\n\n- `quality-v1` /mu);
  assert.match(example.content, /^## Amendments\n\n### 1 - 2026-08-22/mu);
  assert.match(example.content, /Maintainer:.*Example Maintainer/u);
  assert.match(example.content, /Rationale:/u);
  assert.match(example.content, /Change reference:/u);
  assert.match(example.notice, /not approval/u);
  assert.match(example.replacementAmendment, /Invalidated `quality-v1`/u);
  assert.match(example.replacementAmendment, /`quality-v2`.*successor/u);
  assert.match(contract.guidance.join("\n"), /existing.*identity/iu);
});
