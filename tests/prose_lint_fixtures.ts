import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CapturedAtlasFile } from "../src/atlas/load_atlas_text.ts";
import type { Finding } from "../src/domain/finding.ts";
import { atlasSdkProseStyleFiles } from "../src/lint/atlas_sdk_prose_style.ts";
import type {
  ProseLinter,
  ProseLintOutcome,
  ProseLintRequest,
} from "../src/lint/prose_lint.ts";

/** A prose linter whose Vale rules find nothing, for tests that are not about prose. */
export const passingProseLinter: ProseLinter = Object.freeze({
  lint: (): ProseLintOutcome =>
    Object.freeze({ findings: Object.freeze([]), state: "completed" as const }),
});

/** A prose linter that reports fixed Findings and records every request it saw. */
export function recordingProseLinter(
  outcome: ProseLintOutcome = Object.freeze({
    findings: Object.freeze([] as Finding[]),
    state: "completed" as const,
  }),
): ProseLinter & { readonly requests: ProseLintRequest[] } {
  const requests: ProseLintRequest[] = [];
  return {
    lint(request) {
      requests.push(request);
      return outcome;
    },
    requests,
  };
}

/** The Atlas SDK default prose style as captured Atlas files. */
export function proseStyleCapturedFiles(): readonly CapturedAtlasFile[] {
  const encoder = new TextEncoder();
  return atlasSdkProseStyleFiles.map((file) =>
    Object.freeze({ bytes: encoder.encode(file.content), path: file.path }),
  );
}

/**
 * Adds the default prose style to a captured fixture Atlas unless it already
 * carries a file at one of those paths, since every valid Atlas must carry it.
 */
export function withProseStyle(
  files: readonly CapturedAtlasFile[],
): readonly CapturedAtlasFile[] {
  const present = new Set(files.map((file) => file.path));
  return [
    ...files,
    ...proseStyleCapturedFiles().filter((file) => !present.has(file.path)),
  ];
}

/** Writes the default prose style beneath an Atlas Host Directory on disk. */
export function writeProseStyle(atlasHostDirectory: string): void {
  for (const file of atlasSdkProseStyleFiles) {
    const target = join(atlasHostDirectory, ...file.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
}
