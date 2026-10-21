import type { AtlasTextFile } from "../atlas/load_atlas_text.ts";
import type { Finding } from "../domain/finding.ts";

/**
 * The Atlas-owned Vale configuration every Atlas carries. Prose Lint is not
 * optional: an Atlas without this file fails Lint. Everything Vale reads -
 * this configuration and the styles it names - lives inside `.atlas/`.
 */
export const proseLintConfigPath = ".atlas/.vale.ini";

/** The Atlas-owned directory holding the Vale styles `.vale.ini` names. */
export const proseLintStylesDirectory = ".atlas/vale";

export interface ProseLintRequest {
  /** Every loaded Atlas file, so the linter reads the exact text Lint judged. */
  readonly files: readonly AtlasTextFile[];
  /** The Atlas page paths Vale lints, in code-point order. */
  readonly pagePaths: readonly string[];
}

export type ProseLintOutcome =
  | {
      readonly findings: readonly Finding[];
      readonly state: "completed";
    }
  | {
      /** Why prose Lint could not run, which leaves the whole Lint incomplete. */
      readonly reason: string;
      readonly state: "unavailable";
    };

/**
 * The seam through which Lint runs an Atlas's prose rules. Atlas SDK's own
 * implementation runs the bundled, version-pinned Vale binary; Lint itself only
 * decides what to ask and how the answer affects the Atlas's validity.
 */
export interface ProseLinter {
  lint(request: ProseLintRequest): ProseLintOutcome;
}
