import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidateDependentCheckpoints,
  type FoundingCheckpoint,
  type FoundingCheckpointId,
} from "../src/domain/founding_checkpoint.ts";

const checkpointDeps = (
  values: readonly FoundingCheckpointId[],
): readonly FoundingCheckpointId[] => Object.freeze([...values]);

const checkpoints: readonly FoundingCheckpoint[] = Object.freeze([
  Object.freeze({ dependsOn: checkpointDeps([]), id: "persona", status: "complete" }),
  Object.freeze({ dependsOn: checkpointDeps([]), id: "directive", status: "complete" }),
  Object.freeze({
    dependsOn: checkpointDeps([]),
    id: "governance",
    status: "complete",
  }),
  Object.freeze({ dependsOn: checkpointDeps([]), id: "ingest", status: "complete" }),
  Object.freeze({
    dependsOn: checkpointDeps(["governance", "ingest"]),
    id: "anchor",
    status: "complete",
  }),
  Object.freeze({
    dependsOn: checkpointDeps(["anchor"]),
    id: "site",
    status: "complete",
  }),
  Object.freeze({
    dependsOn: checkpointDeps(["directive"]),
    id: "host-integration",
    status: "complete",
  }),
]);

test("checkpoint invalidation follows actual dependency edges only", () => {
  const invalidated = invalidateDependentCheckpoints(checkpoints, "governance");
  const statusById = Object.fromEntries(
    invalidated.map((checkpoint) => [checkpoint.id, checkpoint.status]),
  );
  assert.equal(statusById["anchor"], "pending");
  assert.equal(statusById["site"], "pending");
  assert.equal(statusById["host-integration"], "complete");
  assert.equal(statusById["persona"], "complete");
  assert.equal(statusById["directive"], "complete");
});

test("checkpoint invalidation can carry dynamic persona dependencies", () => {
  const dynamic = checkpoints.map((checkpoint) =>
    checkpoint.id === "host-integration"
      ? Object.freeze({
          ...checkpoint,
          dependsOn: checkpointDeps(["directive", "persona"]),
        })
      : checkpoint,
  );
  const invalidated = invalidateDependentCheckpoints(dynamic, "persona");
  assert.equal(
    invalidated.find((checkpoint) => checkpoint.id === "host-integration")?.status,
    "pending",
  );
});

test("checkpoint invalidation handles duplicate downstream paths and no-op leaves", () => {
  const duplicatePaths: readonly FoundingCheckpoint[] = Object.freeze([
    ...checkpoints.filter((checkpoint) => checkpoint.id !== "site"),
    Object.freeze({
      dependsOn: checkpointDeps(["governance", "anchor"]),
      id: "site",
      status: "complete",
    }),
  ]);
  assert.equal(
    invalidateDependentCheckpoints(duplicatePaths, "governance").find(
      (checkpoint) => checkpoint.id === "site",
    )?.status,
    "pending",
  );
  assert.equal(
    invalidateDependentCheckpoints(checkpoints, "site").find(
      (checkpoint) => checkpoint.id === "site",
    )?.status,
    "complete",
  );
});
