import assert from "node:assert/strict";
import type { OperationResult } from "../src/operations/operation_result.ts";

export function parseMachineOperationResult(stdout: string): OperationResult {
  const result = JSON.parse(stdout) as OperationResult;
  assert.equal(result["operation-result-schema"], "1.0.0");
  assert.equal(result.handoff["operation-handoff-schema"], "1.0.0");
  assert.ok(["completed", "not-completed"].includes(result.completion));
  assert.ok(["success", "failed"].includes(result.disposition));
  assert.deepEqual(result.handoff.operation, result.operation);
  assert.equal(result.handoff.result.disposition, result.disposition);
  assert.ok(
    ["passed", "failed", "not-completed"].includes(
      result.handoff.validationState.state,
    ),
  );
  assert.equal(Array.isArray(result.handoff.validationState.findings), true);
  return result;
}
