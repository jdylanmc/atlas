import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  proseLintConfigPath,
  type ProseLinter,
  type ProseLintOutcome,
  type ProseLintRequest,
} from "../lint/prose_lint.ts";
import { valeProseLintOutcome } from "../lint/vale_alerts.ts";
import { rethrowProcessLimit } from "../atlas/process_limit.ts";
import {
  valePlatformRelease,
  valePlatformReleases,
  valeVersion,
} from "./vale_release.ts";

export interface ValeRunResult {
  readonly error?: Error;
  readonly status: number | null;
  readonly stdout: string;
}

export type ValeRunner = (
  binary: string,
  args: readonly string[],
  cwd: string,
) => ValeRunResult;

export type ValeBinaryResolution =
  | { readonly path: string; readonly state: "resolved" }
  | { readonly reason: string; readonly state: "unavailable" };

export interface ValeProseLinterOptions {
  readonly arch?: string;
  readonly platform?: string;
  /** Resolves a module specifier to a file path, as `require.resolve` does. */
  readonly resolveModule?: (specifier: string) => string;
  readonly run?: ValeRunner;
  readonly temporaryRoot?: () => string;
}

const requireFromHere = createRequire(import.meta.url);

// Vale reads its configuration location and styles from environment variables
// and a global configuration file. None of them may change an Atlas's verdict,
// so Vale runs with an empty environment (Windows keeps only SystemRoot, which
// its process loader needs) and with the global configuration disabled.
export function valeEnvironment(
  platform: string = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const systemRoot = environment["SystemRoot"];
  return platform === "win32" && systemRoot !== undefined
    ? { SystemRoot: systemRoot }
    : {};
}

const runVale: ValeRunner = (binary, args, cwd) => {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: "utf8",
    env: valeEnvironment(),
    maxBuffer: Number.POSITIVE_INFINITY,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return result.error === undefined
    ? { status: result.status, stdout: result.stdout }
    : { error: result.error, status: result.status, stdout: result.stdout };
};

function supportedPlatforms(): string {
  return valePlatformReleases.map((entry) => `${entry.os}-${entry.cpu}`).join(", ");
}

/**
 * Finds the bundled Vale binary for this platform and proves it is the pinned
 * release. The binary arrives through an exact-version optional dependency, so
 * a missing package, a missing binary, or a binary reporting another version
 * all leave prose Lint unable to run rather than silently skipped.
 */
export function resolveValeBinary(
  options: ValeProseLinterOptions = Object.freeze({}),
): ValeBinaryResolution {
  const os = options.platform ?? process.platform;
  const cpu = options.arch ?? process.arch;
  const release = valePlatformRelease(os, cpu);
  if (release === undefined) {
    return Object.freeze({
      reason: `Atlas SDK bundles Vale ${valeVersion} for ${supportedPlatforms()}; ${os}-${cpu} is not supported.`,
      state: "unavailable" as const,
    });
  }
  const resolveModule =
    options.resolveModule ??
    ((specifier: string) => requireFromHere.resolve(specifier));
  let manifest: string;
  try {
    manifest = resolveModule(`${release.packageName}/package.json`);
  } catch {
    return Object.freeze({
      reason: `The bundled Vale package ${release.packageName}@${valeVersion} is not installed.`,
      state: "unavailable" as const,
    });
  }
  const binary = join(dirname(manifest), "bin", release.binary);
  const run = options.run ?? runVale;
  const version = run(binary, ["--version"], dirname(manifest));
  if (version.error !== undefined || version.status !== 0) {
    return Object.freeze({
      reason: `The bundled Vale binary in ${release.packageName} could not run.`,
      state: "unavailable" as const,
    });
  }
  if (version.stdout.trim() !== `vale version ${valeVersion}`) {
    return Object.freeze({
      reason: `The bundled Vale binary in ${release.packageName} is not Vale ${valeVersion}.`,
      state: "unavailable" as const,
    });
  }
  return Object.freeze({ path: binary, state: "resolved" as const });
}

function materialize(root: string, request: ProseLintRequest): void {
  for (const file of request.files) {
    const target = join(root, ...file.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
}

function lintInWorkspace(
  root: string,
  binary: string,
  request: ProseLintRequest,
  run: ValeRunner,
): ProseLintOutcome {
  try {
    materialize(root, request);
    const result = run(
      binary,
      [
        "--no-global",
        `--config=${proseLintConfigPath}`,
        "--output=JSON",
        ...request.pagePaths,
      ],
      root,
    );
    if (result.error !== undefined) {
      return Object.freeze({
        reason: "The bundled Vale binary could not run.",
        state: "unavailable" as const,
      });
    }
    return valeProseLintOutcome(result, request, root);
  } catch (error: unknown) {
    rethrowProcessLimit(error);
    return Object.freeze({
      reason: "The Atlas could not be prepared for Vale.",
      state: "unavailable" as const,
    });
  }
}

/**
 * The Vale-backed prose linter every Atlas SDK Lint uses. Vale lints a private
 * copy of exactly the text Lint loaded, so the verdict follows the captured
 * Atlas - including its own `.atlas/.vale.ini` and `.atlas/vale/` styles -
 * rather than whatever happens to be on disk while Vale runs.
 */
export function createValeProseLinter(
  options: ValeProseLinterOptions = Object.freeze({}),
): ProseLinter {
  let resolution: ValeBinaryResolution | undefined;
  const run = options.run ?? runVale;
  const temporaryRoot =
    options.temporaryRoot ?? (() => mkdtempSync(join(tmpdir(), "atlas-vale-")));
  return Object.freeze({
    lint(request: ProseLintRequest): ProseLintOutcome {
      resolution ??= resolveValeBinary(options);
      if (resolution.state === "unavailable") {
        return Object.freeze({
          reason: resolution.reason,
          state: "unavailable" as const,
        });
      }
      if (request.pagePaths.length === 0) {
        return Object.freeze({
          findings: Object.freeze([]),
          state: "completed" as const,
        });
      }
      let root: string;
      try {
        root = temporaryRoot();
      } catch (error: unknown) {
        rethrowProcessLimit(error);
        return Object.freeze({
          reason: "A private workspace for Vale could not be created.",
          state: "unavailable" as const,
        });
      }
      let outcome: ProseLintOutcome;
      try {
        outcome = lintInWorkspace(root, resolution.path, request, run);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
      return outcome;
    },
  });
}
