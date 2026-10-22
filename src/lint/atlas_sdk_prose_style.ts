import { proseLintConfigPath, proseLintStylesDirectory } from "./prose_lint.ts";

/** One file of the Atlas SDK default prose style, as written into `.atlas/`. */
export interface AtlasSdkProseStyleFile {
  readonly content: string;
  readonly path: string;
}

/** The maximum prose words one Atlas page may carry under the default style. */
export const atlasSdkPageWordLimit = 1000;

const valeConfig = `# Vale prose Lint for this Atlas. Atlas SDK runs its pinned Vale with this
# file on every Lint; an error-level alert fails Lint. This Atlas owns this
# configuration and may change, disable, or extend any rule.
StylesPath = vale/styles
MinAlertLevel = suggestion

[*.md]
BasedOnStyles = AtlasSDK
`;

const pageLengthRule = `# Counts prose words only: headings, code, table cells, and frontmatter are
# excluded by Vale's summary scope.
extends: occurrence
message: "Page prose runs to %d words. Split it into an overview page and child pages."
description: Long pages are hard to read and route; split one topic per page.
level: error
scope: summary
max: ${String(atlasSdkPageWordLimit)}
token: "[\\\\p{L}\\\\p{N}]+(?:['\u2019-][\\\\p{L}\\\\p{N}]+)*"
`;

/**
 * The Atlas SDK default prose style. Initialize copies it into every new Atlas,
 * after which the Atlas owns it and may change, disable, or extend its rules.
 */
export const atlasSdkProseStyleFiles: readonly AtlasSdkProseStyleFile[] = Object.freeze(
  [
    Object.freeze({ content: valeConfig, path: proseLintConfigPath }),
    Object.freeze({
      content: pageLengthRule,
      path: `${proseLintStylesDirectory}/styles/AtlasSDK/PageLength.yml`,
    }),
  ],
);
