import assert from "node:assert/strict";

export interface GrowthSample {
  readonly large: () => void;
  readonly maxRatio?: number;
  readonly name: string;
  readonly small: () => void;
}

function measureMedian(run: () => void, repetitions: number): number {
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const started = process.cpuUsage();
    for (let repeat = 0; repeat < repetitions; repeat += 1) run();
    const elapsed = process.cpuUsage(started);
    samples.push((elapsed.user + elapsed.system) / 1000);
  }
  samples.sort((left, right) => left - right);
  return samples[2] as number;
}

export function assertGrowthRatio(sample: GrowthSample): void {
  sample.small();
  sample.large();

  let repetitions = 1;
  let smallCost = measureMedian(sample.small, repetitions);
  while (smallCost < 5 && repetitions < 16) {
    repetitions *= 2;
    smallCost = measureMedian(sample.small, repetitions);
  }

  const largeCost = measureMedian(sample.large, repetitions);
  const ratio = largeCost / Math.max(smallCost, Number.EPSILON);
  const maxRatio = sample.maxRatio ?? 2.5;
  assert.ok(
    ratio < maxRatio,
    `${sample.name} grew ${ratio.toFixed(2)} times at ${String(repetitions)} repetitions`,
  );
}
