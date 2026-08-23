import type { Finding, FindingLocation } from "../domain/finding.ts";
/**
 * Builds the deeply immutable, trusted Findings one Atlas SDK check reports, so
 * every trusted check shares one attribution and one immutability guarantee.
 */
export declare function sdkFindings(checkId: string): (code: string, message: string, path: string, location?: FindingLocation) => Finding;
