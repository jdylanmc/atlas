import assert from "node:assert/strict";
import test from "node:test";
import { assertGrowthRatio, assertWallClockUnder } from "./growth.ts";

let sink = 0;

function busy(iterations: number): void {
  for (let index = 0; index < iterations; index += 1) {
    sink = (sink + index) | 0;
  }
}

test("growth helper rejects superlinear work", () => {
  assert.throws(
    () =>
      assertGrowthRatio({
        large: () => busy(3_400_000),
        name: "synthetic superlinear workload",
        small: () => busy(1_200_000),
      }),
    /synthetic superlinear workload grew/u,
  );
});

test("wall-clock helper rejects fixed constant delay", () => {
  assert.throws(
    () =>
      assertWallClockUnder("synthetic fixed delay", 1, () => {
        const until = performance.now() + 20;
        while (performance.now() < until) busy(1000);
      }),
    /synthetic fixed delay took/u,
  );
});

test("growth helper accepts linear work", () => {
  assertGrowthRatio({
    large: () => busy(1_000_000),
    name: "synthetic linear workload",
    small: () => busy(500_000),
  });
});

test("synthetic work is observable", () => {
  assert.equal(typeof sink, "number");
});
