import { compareCodePoints } from "../atlas/compare_code_points.ts";
import { sha256Hex } from "../atlas/sha256.ts";
import { dateTimeMilliseconds } from "../domain/atlas_page.ts";
import type { ReadonlyJsonValue } from "../domain/atlas_page.ts";
import type { Finding } from "../domain/finding.ts";

// Shared deterministic support every proposal operation reuses, so one fix to a
// digest, a branch rule, or a receipt walk lands in Ingest, governance, and
// Atlas Initialization at once instead of drifting between hand-copied clones.

/**
 * One Git branch name a proposal may create. The set is intentionally narrow:
 * only unreserved path characters, no leading dash the shell would read as
 * an option, and no segment Git resolves specially.
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
 * field's boundary: a path does not impersonate the separator between two
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
 * byte or newline does not smuggle a second field boundary past the digest. */
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

/**
 * A detached record of Maintainer approval, authored apart from the agent-drafted
 * proposal content it authorizes. Its payloadDigest binds it to the exact
 * canonical payload and operation a Maintainer approved: any later mutation of
 * that payload, or reuse of the same attestation for a different operation,
 * fails to reproduce this digest and is refused rather than silently accepted.
 * The nonce keeps two attestations over identical content distinguishable, and
 * an optional expiresAt bounds how long the attestation authorizes anything.
 *
 * payloadDigest is an unkeyed SHA-256 digest, not a signature: it detects
 * mutation, replay across operations, and expiry, but it does not by itself
 * prove which human produced approver — a party with no credential at all can
 * still compute a matching digest for content it invents. See
 * https://github.com/jdylanmc/atlas/issues/230 for keying this with a real
 * authentication primitive.
 */
export interface AtlasApprovalAttestation {
  readonly "approval-attestation-schema": "1.0.0";
  readonly approvedAt: string;
  readonly approver: string;
  readonly expiresAt?: string;
  readonly nonce: string;
  readonly operation: string;
  readonly payloadDigest: string;
}

/**
 * Parses one caller-authored Approval Attestation record. Ingest and
 * Governance each bound authored string length differently (Ingest has no
 * per-field byte budget today; Governance bounds every string to its shared
 * `maxStringBytes`), so the one string field validator each seam already uses
 * for its other fields is injected here rather than duplicated as a second
 * near-identical parser per seam.
 */
export function parseApprovalAttestationRecord(
  record: Readonly<Record<string, unknown>>,
  path: string,
  asFieldString: (value: unknown, path: string) => string,
): AtlasApprovalAttestation {
  if (
    asFieldString(
      record["approval-attestation-schema"],
      `${path}.approval-attestation-schema`,
    ) !== "1.0.0"
  ) {
    throw new Error(`${path}.approval-attestation-schema must be "1.0.0"`);
  }
  const attestation: {
    "approval-attestation-schema": "1.0.0";
    approvedAt: string;
    approver: string;
    expiresAt?: string;
    nonce: string;
    operation: string;
    payloadDigest: string;
  } = {
    "approval-attestation-schema": "1.0.0",
    approvedAt: asFieldString(record["approvedAt"], `${path}.approvedAt`),
    approver: asFieldString(record["approver"], `${path}.approver`),
    nonce: asFieldString(record["nonce"], `${path}.nonce`),
    operation: asFieldString(record["operation"], `${path}.operation`),
    payloadDigest: asFieldString(record["payloadDigest"], `${path}.payloadDigest`),
  };
  if (record["expiresAt"] !== undefined) {
    attestation.expiresAt = asFieldString(record["expiresAt"], `${path}.expiresAt`);
  }
  return Object.freeze(attestation);
}

/**
 * Canonical JSON for an arbitrary payload: object keys are sorted by code
 * point before serialization, so two payloads that differ only in authored key
 * order still digest identically, while a payload that differs in any value
 * digests differently. JSON's own escaping already frames every string, so
 * unlike a delimiter-joined encoding, a crafted field value does not forge a
 * sibling field's boundary.
 */
export function canonicalJson(value: ReadonlyJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry: ReadonlyJsonValue) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, ReadonlyJsonValue>>;
  const keys = Object.keys(record).toSorted(compareCodePoints);
  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key] as ReadonlyJsonValue)}`,
    )
    .join(",")}}`;
}

/**
 * The digest an Approval Attestation binds to: the exact operation string, the
 * attestation's own nonce, and the canonical payload it authorizes, each framed
 * by its own length so no field can reproduce another field's boundary (the
 * same framing `changeSetDigest` uses).
 */
export function attestationPayloadDigest(
  operation: string,
  nonce: string,
  payload: ReadonlyJsonValue,
): string {
  const parts: string[] = [];
  const frame = (field: string): void => {
    parts.push(String(field.length), "\0", field, "\0");
  };
  frame(operation);
  frame(nonce);
  frame(canonicalJson(payload));
  return sha256Hex(parts.join(""));
}

export type ApprovalAttestationVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "missing"
        | "approver-required"
        | "nonce-required"
        | "time-invalid"
        | "operation-mismatch"
        | "payload-mismatch"
        | "expired";
    };

/**
 * Verifies a detached Approval Attestation against the operation and payload it
 * is presented alongside. `now`, when supplied, is the only wall-clock-derived
 * value this deterministic core reads, and only to compare two already-
 * authored timestamps; this function does not call a clock itself. A platform
 * adapter reads the real clock and passes its reading in, the same pattern
 * `atlas_cache.ts` uses for freshness so this function stays a pure comparison.
 */
export function verifyApprovalAttestation(
  attestation: AtlasApprovalAttestation | undefined,
  operation: string,
  payload: ReadonlyJsonValue,
  now?: string,
): ApprovalAttestationVerdict {
  // Every field is re-checked by type here, not merely read, because this
  // shared core is reached both from seams that already parsed `attestation`
  // through a defensive record parser and from callers that only cast an
  // `unknown` value to this shape without runtime validation. `raw` is typed
  // `unknown` so this defensive check itself, rather than an unchecked cast
  // elsewhere, carries no assumption that the runtime value matches the
  // static type; `verified` is trusted only once every field is confirmed.
  const raw: unknown = attestation;
  if (
    raw === undefined ||
    raw === null ||
    typeof raw !== "object" ||
    typeof (raw as Readonly<Record<string, unknown>>)["approver"] !== "string" ||
    typeof (raw as Readonly<Record<string, unknown>>)["nonce"] !== "string" ||
    typeof (raw as Readonly<Record<string, unknown>>)["approvedAt"] !== "string" ||
    typeof (raw as Readonly<Record<string, unknown>>)["operation"] !== "string" ||
    typeof (raw as Readonly<Record<string, unknown>>)["payloadDigest"] !== "string"
  ) {
    return { ok: false, reason: "missing" };
  }
  const verified = raw as AtlasApprovalAttestation;
  if (verified.approver.trim() === "") {
    return { ok: false, reason: "approver-required" };
  }
  if (verified.nonce.trim() === "") {
    return { ok: false, reason: "nonce-required" };
  }
  if (dateTimeMilliseconds(verified.approvedAt) === undefined) {
    return { ok: false, reason: "time-invalid" };
  }
  if (verified.operation !== operation) {
    return { ok: false, reason: "operation-mismatch" };
  }
  const expected = attestationPayloadDigest(operation, verified.nonce, payload);
  if (verified.payloadDigest !== expected) {
    return { ok: false, reason: "payload-mismatch" };
  }
  if (verified.expiresAt !== undefined && now !== undefined) {
    const expiry = dateTimeMilliseconds(verified.expiresAt);
    const reference = dateTimeMilliseconds(now);
    if (expiry !== undefined && reference !== undefined && reference > expiry) {
      return { ok: false, reason: "expired" };
    }
  }
  return { ok: true };
}
