import type { Finding } from "../domain/finding.ts";
/**
 * One Git branch name a proposal may create. The set is intentionally narrow:
 * only unreserved path characters, never a leading dash the shell would read as
 * an option, and never a segment Git resolves specially.
 */
export declare function isSafeGitBranchName(name: string): boolean;
/**
 * The content digest that identifies one immutable revision. SHA-256, matching
 * every other digest Atlas SDK writes, so a revision identity is cryptographic
 * rather than a short non-cryptographic hash a collision could forge.
 */
export declare function revisionDigest(content: string): string;
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
export declare function changeSetDigest(changeSet: DigestChangeSet): string;
/** A repository-relative change path may carry no control character, so a null
 * byte or newline can never smuggle a second field boundary past the digest. */
export declare function hasControlCharacter(value: string): boolean;
interface EffectReceiptLike {
    readonly effect: string;
}
interface WorkflowStateLike {
    readonly effectReceipts: readonly EffectReceiptLike[];
}
export declare function receiptFor<State extends WorkflowStateLike>(state: State, effect: State["effectReceipts"][number]["effect"]): State["effectReceipts"][number] | undefined;
export declare function addReceipt<State extends WorkflowStateLike>(state: State, receipt: State["effectReceipts"][number]): State;
/** A proposal may proceed to mutation only when no Finding denies it: an error
 * blocks, and an inconclusive verdict pauses for a human decision. */
export declare function canContinue(findings: readonly Finding[]): boolean;
export {};
