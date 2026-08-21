import assert from "node:assert/strict";

export interface GrowthSample {
  readonly large: () => void;
  readonly maxRatio?: number;
  readonly name: string;
  readonly small: () => void;
}

export function assertWallClockUnder(
  name: string,
  maxMilliseconds: number,
  run: () => void,
): void {
  const started = performance.now();
  run();
  const elapsed = performance.now() - started;
  assert.ok(
    elapsed < maxMilliseconds,
    `${name} took ${elapsed.toFixed(3)}ms, above ${String(maxMilliseconds)}ms`,
  );
}

function measureCpuMilliseconds(run: () => void, repetitions: number): number {
  const started = process.cpuUsage();
  for (let repeat = 0; repeat < repetitions; repeat += 1) run();
  const elapsed = process.cpuUsage(started);
  return (elapsed.user + elapsed.system) / 1000;
}

function median(values: readonly number[]): number {
  return values.toSorted((left, right) => left - right)[
    Math.floor(values.length / 2)
  ] as number;
}

function measurePairedRatios(
  sample: GrowthSample,
  repetitions: number,
): readonly number[] {
  const ratios: number[] = [];
  for (let pair = 0; pair < 7; pair += 1) {
    if (pair % 2 === 0) {
      const small = measureCpuMilliseconds(sample.small, repetitions);
      const large = measureCpuMilliseconds(sample.large, repetitions);
      ratios.push(large / Math.max(small, Number.EPSILON));
    } else {
      const large = measureCpuMilliseconds(sample.large, repetitions);
      const small = measureCpuMilliseconds(sample.small, repetitions);
      ratios.push(large / Math.max(small, Number.EPSILON));
    }
  }
  return ratios;
}

function calibratedRepetitions(run: () => void): number {
  let repetitions = 2;
  for (;;) {
    const started = process.cpuUsage();
    for (let repeat = 0; repeat < repetitions; repeat += 1) run();
    const elapsed = process.cpuUsage(started);
    const milliseconds = (elapsed.user + elapsed.system) / 1000;
    if (milliseconds >= 15 || repetitions >= 64) return repetitions;
    repetitions *= 2;
  }
}

export function assertGrowthRatio(sample: GrowthSample): void {
  sample.small();
  sample.large();

  const repetitions = calibratedRepetitions(sample.small);
  const ratios = measurePairedRatios(sample, repetitions);
  const ratio = median(ratios);
  const maxRatio = sample.maxRatio ?? 2.5;
  assert.ok(
    ratio < maxRatio,
    `${sample.name} grew ${ratio.toFixed(2)} times at ${String(repetitions)} repetitions; ratios=${ratios.map((value) => value.toFixed(2)).join(",")}`,
  );
}
