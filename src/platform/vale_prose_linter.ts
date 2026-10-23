import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  proseLintConfigPath,
  type ProseLinter,
  type ProseLintOutcome,
  type ProseLintRequest,
} from "../lint/prose_lint.ts";
import { valeProseLintOutcome } from "../lint/vale_alerts.ts";
import { rethrowProcessLimit } from "../atlas/process_limit.ts";
import { extractValeBinary } from "./vale_archive.ts";
import {
  valePlatformRelease,
  valePlatformReleases,
  valeReleaseUrl,
  valeVersion,
  type ValePlatformRelease,
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

/** Fetches one URL's bytes, throwing when the download fails. */
export type ValeDownload = (url: string) => Uint8Array;

export type ValeBinaryResolution =
  | { readonly path: string; readonly state: "resolved" }
  | { readonly reason: string; readonly state: "unavailable" };

export interface ValeProseLinterOptions {
  readonly arch?: string;
  /** The machine-scoped directory holding the pinned Vale binary. */
  readonly cacheDirectory?: string;
  readonly download?: ValeDownload;
  readonly platform?: string;
  /** The release to install; defaults to the pinned release for this platform. */
  readonly release?: ValePlatformRelease;
  readonly run?: ValeRunner;
  readonly temporaryRoot?: () => string;
}

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

// Lint is synchronous, so the one network fetch runs in a short-lived Node
// process that writes the asset to a private file the caller then verifies.
const downloaderSource = `import { writeFileSync } from "fs";
const [url, out] = process.argv.slice(1);
const response = await fetch(url, { redirect: "follow" });
if (!response.ok) process.exit(3);
writeFileSync(out, new Uint8Array(await response.arrayBuffer()));
`;

/** Downloads one release asset, failing on any network or HTTP error. */
export const downloadValeAsset: ValeDownload = (url) => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-vale-download-"));
  try {
    const asset = join(directory, "asset");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", downloaderSource, url, asset],
      { stdio: "ignore", timeout: 300_000, windowsHide: true },
    );
    if (result.status !== 0) throw new Error(`Downloading ${url} failed.`);
    return new Uint8Array(readFileSync(asset));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

/**
 * The machine-scoped directory Atlas SDK keeps the pinned Vale binary in,
 * beside the other Atlas SDK tool runtimes.
 */
export function valeCacheDirectory(
  os: string,
  cpu: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    environment["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"),
    "atlas",
    "tool-runtimes",
    "vale",
    valeVersion,
    `${os}-${cpu}`,
  );
}

function supportedPlatforms(): string {
  return valePlatformReleases.map((entry) => `${entry.os}-${entry.cpu}`).join(", ");
}

type BinaryCheck = "missing" | "pinned" | "unrunnable" | "wrong-version";

function checkBinary(binary: string, run: ValeRunner): BinaryCheck {
  if (!existsSync(binary)) return "missing";
  const version = run(binary, ["--version"], dirname(binary));
  if (version.error !== undefined || version.status !== 0) return "unrunnable";
  return version.stdout.trim() === `vale version ${valeVersion}`
    ? "pinned"
    : "wrong-version";
}

function unavailable(reason: string): ValeBinaryResolution {
  return Object.freeze({ reason, state: "unavailable" as const });
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Nothing was staged where the directory itself could not be created.
  }
}

/**
 * Downloads, verifies, and atomically places the pinned binary. A concurrent
 * install writes its own temporary file, so a reader sees either no binary or a
 * complete one.
 */
function installBinary(
  release: ValePlatformRelease,
  binary: string,
  download: ValeDownload,
): string | undefined {
  const url = valeReleaseUrl(release);
  let asset: Uint8Array;
  try {
    asset = download(url);
  } catch (error: unknown) {
    rethrowProcessLimit(error);
    return `Vale ${valeVersion} could not be downloaded from ${url}; connect to the network and run Lint again.`;
  }
  let executable: Uint8Array;
  try {
    executable = extractValeBinary(release, asset);
  } catch (error: unknown) {
    rethrowProcessLimit(error);
    return `The downloaded Vale ${valeVersion} release failed verification: ${(error as Error).message}`;
  }
  const staged = `${binary}.${randomUUID()}.partial`;
  try {
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(staged, executable, { mode: 0o755 });
    renameSync(staged, binary);
  } catch (error: unknown) {
    rethrowProcessLimit(error);
    removeQuietly(staged);
    return `Vale ${valeVersion} could not be installed in ${dirname(binary)}.`;
  }
  return undefined;
}

/**
 * Finds the pinned Vale binary in the machine cache, downloading and verifying
 * the official release on first use. A failed download, a digest mismatch, or
 * a binary reporting another version leaves prose Lint unable to run rather
 * than silently skipped.
 */
export function resolveValeBinary(
  options: ValeProseLinterOptions = Object.freeze({}),
): ValeBinaryResolution {
  const os = options.platform ?? process.platform;
  const cpu = options.arch ?? process.arch;
  const release = options.release ?? valePlatformRelease(os, cpu);
  if (release === undefined) {
    return unavailable(
      `Atlas SDK runs Vale ${valeVersion} on ${supportedPlatforms()}; ${os}-${cpu} is not supported.`,
    );
  }
  const run = options.run ?? runVale;
  const download = options.download ?? downloadValeAsset;
  const binary = join(
    options.cacheDirectory ?? valeCacheDirectory(os, cpu),
    release.binary,
  );
  if (checkBinary(binary, run) === "pinned") {
    return Object.freeze({ path: binary, state: "resolved" as const });
  }
  const failure = installBinary(release, binary, download);
  if (failure !== undefined) return unavailable(failure);
  const installed = checkBinary(binary, run);
  if (installed === "pinned") {
    return Object.freeze({ path: binary, state: "resolved" as const });
  }
  return unavailable(
    installed === "wrong-version"
      ? `The installed Vale binary is not Vale ${valeVersion}.`
      : `The installed Vale ${valeVersion} binary could not run.`,
  );
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
        reason: "The pinned Vale binary could not run.",
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
