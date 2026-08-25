import { compareCodePoints, sha256Hex } from "./domain_support.ts";

export type FoundingCheckpointId =
  | "persona"
  | "directive"
  | "governance"
  | "ingest"
  | "anchor"
  | "site"
  | "host-integration";

export interface FoundingCheckpoint {
  readonly dependsOn: readonly FoundingCheckpointId[];
  readonly evidenceDigest?: string;
  readonly id: FoundingCheckpointId;
  readonly inputDigest?: string;
  readonly status: "complete" | "pending" | "skipped";
}

export const foundingCapabilityIds = Object.freeze([
  "persona",
  "directive",
  "governance",
  "ingest",
  "anchor",
  "site",
  "host-integration",
] as const) satisfies readonly FoundingCheckpointId[];

export const foundingCheckpointDependencies = Object.freeze({
  anchor: Object.freeze<readonly FoundingCheckpointId[]>(["governance", "ingest"]),
  directive: Object.freeze<readonly FoundingCheckpointId[]>([]),
  governance: Object.freeze<readonly FoundingCheckpointId[]>([]),
  "host-integration": Object.freeze<readonly FoundingCheckpointId[]>(["directive"]),
  ingest: Object.freeze<readonly FoundingCheckpointId[]>([]),
  persona: Object.freeze<readonly FoundingCheckpointId[]>([]),
  site: Object.freeze<readonly FoundingCheckpointId[]>(["anchor"]),
}) satisfies Readonly<Record<FoundingCheckpointId, readonly FoundingCheckpointId[]>>;

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

export function checkpointInputDigest(input: unknown): string {
  return sha256Hex(JSON.stringify(canonicalJson(input)));
}

export function invalidateDependentCheckpoints(
  checkpoints: readonly FoundingCheckpoint[],
  changedId: FoundingCheckpointId,
): readonly FoundingCheckpoint[] {
  const reverse = new Map<FoundingCheckpointId, FoundingCheckpointId[]>();
  for (const checkpoint of checkpoints) {
    for (const dependency of checkpoint.dependsOn) {
      const dependents = reverse.get(dependency) ?? [];
      dependents.push(checkpoint.id);
      reverse.set(dependency, dependents);
    }
  }
  const pending = new Set<FoundingCheckpointId>();
  const queue: FoundingCheckpointId[] = [...(reverse.get(changedId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift() as FoundingCheckpointId;
    if (pending.has(current)) continue;
    pending.add(current);
    queue.push(...(reverse.get(current) ?? []));
  }
  return Object.freeze(
    checkpoints.map((checkpoint) =>
      pending.has(checkpoint.id)
        ? Object.freeze({
            dependsOn: checkpoint.dependsOn,
            id: checkpoint.id,
            status: "pending" as const,
          })
        : checkpoint,
    ),
  );
}
