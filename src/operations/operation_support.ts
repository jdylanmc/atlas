import { compareCodePoints } from "../atlas/compare_code_points.ts";
import { sha256Hex } from "../atlas/sha256.ts";
import type { Finding } from "../domain/finding.ts";

// Shared deterministic support every proposal operation reuses, so one fix to a
// digest, a branch rule, or a receipt walk lands in Ingest, governance, and
// Atlas Initialization at once instead of drifting between hand-copied clones.

/**
 * One Git branch name a proposal may create. The set is intentionally narrow:
 * only unreserved path characters, never a leading dash the shell would read as
 * an option, and never a segment Git resolves specially.
 */
export function isSafeGitBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/u.test(name) &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.includes("..") &&
    !name.split("/").some((segment) => segment === "" || segment === ".")
  );
}

/**
 * The content digest that identifies one immutable revision. SHA-256, matching
 * every other digest Atlas SDK writes, so a revision identity is cryptographic
 * rather than a short non-cryptographic hash a collision could forge.
 */
export function revisionDigest(content: string): string {
  return sha256Hex(content);
}

export interface DigestChange {
  readonly content: string;
  readonly path: string;
}

export interface DigestChangeSet {
  readonly baseSnapshotDigest: string;
  readonly changes: readonly DigestChange[];
  readonly targetHead: string;
}

/**
 * The replay-protection digest of one Atlas Change Set. Each field is framed by
 * its own length before its text, so no field value can reproduce another
 * field's boundary: a path can never impersonate the separator between two
 * changes, which a delimiter-joined encoding allowed. Change content is hashed
 * to a fixed-width digest before framing, and changes are ordered by path, so
 * the digest is a deterministic function of the set rather than its arrangement.
 */
export function changeSetDigest(changeSet: DigestChangeSet): string {
  const parts: string[] = [];
  const frame = (field: string): void => {
    parts.push(String(field.length), "\0", field, "\0");
  };
  frame(changeSet.baseSnapshotDigest);
  frame(changeSet.targetHead);
  const ordered = [...changeSet.changes].toSorted((left, right) =>
    compareCodePoints(left.path, right.path),
  );
  frame(String(ordered.length));
  for (const change of ordered) {
    frame(change.path);
    frame(sha256Hex(change.content));
  }
  return sha256Hex(parts.join(""));
}

/** A repository-relative change path may carry no control character, so a null
 * byte or newline can never smuggle a second field boundary past the digest. */
export function hasControlCharacter(value: string): boolean {
  return /\p{Cc}/u.test(value);
}

interface EffectReceiptLike {
  readonly effect: string;
}

interface WorkflowStateLike {
  readonly effectReceipts: readonly EffectReceiptLike[];
}

export function receiptFor<State extends WorkflowStateLike>(
  state: State,
  effect: State["effectReceipts"][number]["effect"],
): State["effectReceipts"][number] | undefined {
  return state.effectReceipts.find((receipt) => receipt.effect === effect);
}

export function addReceipt<State extends WorkflowStateLike>(
  state: State,
  receipt: State["effectReceipts"][number],
): State {
  return Object.freeze({
    ...state,
    effectReceipts: Object.freeze([...state.effectReceipts, receipt]),
  });
}

/** A proposal may proceed to mutation only when no Finding denies it: an error
 * blocks, and an inconclusive verdict pauses for a human decision. */
export function canContinue(findings: readonly Finding[]): boolean {
  return findings.every(
    (entry) => entry.severity !== "error" && entry.severity !== "inconclusive",
  );
}
