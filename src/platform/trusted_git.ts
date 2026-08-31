import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const trustedGitExecutables = Object.freeze({
  darwin: Object.freeze(["/usr/bin/git"]),
  linux: Object.freeze([
    "/usr/bin/git",
    "/bin/git",
    "/usr/local/bin/git",
    "/run/current-system/sw/bin/git",
  ]),
  // Prefer Git for Windows default install locations without consulting PATH.
  win32: Object.freeze([
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files\\Git\\bin\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
  ]),
} as const);
const trustedGitConfig = Object.freeze({
  "core.attributesFile": "/dev/null",
  "core.fsmonitor": "false",
  "core.hooksPath": "/dev/null",
} as const);
const defaultTrustedGitMaxBuffer = 16 * 1024 * 1024;
const trustedGitResolutionFailurePrefix = "Could not resolve a trusted Git executable:";

export interface ResolveTrustedGitExecutableOptions {
  readonly existsCandidate?: (path: string) => boolean;
  readonly isExecutableRegularFile?: (path: string) => boolean;
  readonly platform?: NodeJS.Platform;
}

export interface RunTrustedGitCommandOptions {
  readonly args: readonly string[];
  readonly directory: string;
  readonly input?: string;
  readonly maxBuffer?: number;
  readonly platform?: NodeJS.Platform;
  readonly repository?: string;
  readonly resolveExecutable?: () => TrustedGitExecutableResolution;
  readonly spawn?: typeof spawnSync;
}

export type TrustedGitExecutableResolution =
  | {
      readonly path: string;
      readonly state: "resolved";
    }
  | {
      readonly reason: string;
      readonly state: "unresolved";
    };

export type TrustedGitResult =
  | {
      readonly reason: string;
      readonly state: "failed";
    }
  | {
      readonly stdout: string;
      readonly state: "succeeded";
    };

export type TrustedGitBytesResult =
  | { readonly reason: string; readonly state: "failed" }
  | {
      readonly stdout: Uint8Array;
      readonly state: "succeeded";
    };

let resolvedTrustedGitExecutable: string | undefined;

function trustedGitCandidates(
  platform: NodeJS.Platform,
): readonly string[] | undefined {
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return trustedGitExecutables[platform];
  }
  return undefined;
}

function trustedGitPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return "C:\\Windows\\System32;C:\\Windows";
  }
  return "/usr/bin:/bin";
}

export function trustedGitEnvironment(
  repository: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_CONFIG: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: dirname(resolve(repository)),
    HOME: "/nonexistent",
    NODE_V8_COVERAGE: process.env["NODE_V8_COVERAGE"],
    PATH: trustedGitPath(platform),
    XDG_CONFIG_HOME: "/nonexistent",
  };
  const entries = Object.entries(trustedGitConfig);
  environment["GIT_CONFIG_COUNT"] = String(entries.length);
  for (const [index, [key, value]] of entries.entries()) {
    const suffix = String(index);
    environment[`GIT_CONFIG_KEY_${suffix}`] = key;
    environment[`GIT_CONFIG_VALUE_${suffix}`] = value;
  }
  return environment;
}

function failedGitResult(): { readonly reason: string; readonly state: "failed" } {
  return Object.freeze({
    reason: "Git failed while running in the trusted platform adapter.",
    state: "failed" as const,
  });
}

function failedTrustedGitResolutionResult(reason: string): {
  readonly reason: string;
  readonly state: "failed";
} {
  return Object.freeze({
    reason: `${trustedGitResolutionFailurePrefix} ${reason}`,
    state: "failed" as const,
  });
}

export function isExecutableRegularFile(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    const initial = lstatSync(path);
    const final = initial.isSymbolicLink() ? statSync(realpathSync(path)) : initial;
    if (!final.isFile()) return false;
    if (platform === "win32") return true;
    return (final.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function resolveTrustedGitExecutable(
  options: ResolveTrustedGitExecutableOptions = {},
): TrustedGitExecutableResolution {
  const useMemoizedResolution =
    options.existsCandidate === undefined &&
    options.isExecutableRegularFile === undefined &&
    options.platform === undefined;
  if (useMemoizedResolution && resolvedTrustedGitExecutable !== undefined) {
    return Object.freeze({
      path: resolvedTrustedGitExecutable,
      state: "resolved" as const,
    });
  }
  const platform = options.platform ?? process.platform;
  const candidates = trustedGitCandidates(platform);
  if (candidates === undefined) {
    return Object.freeze({
      reason: `Trusted Git resolution is unsupported on platform ${platform}.`,
      state: "unresolved" as const,
    });
  }
  const existsCandidate = options.existsCandidate ?? existsSync;
  const validateCandidate =
    options.isExecutableRegularFile ??
    ((path: string) => isExecutableRegularFile(path, platform));
  for (const candidate of candidates) {
    if (!existsCandidate(candidate)) continue;
    if (!validateCandidate(candidate)) continue;
    if (useMemoizedResolution) {
      resolvedTrustedGitExecutable = candidate;
    }
    return Object.freeze({ path: candidate, state: "resolved" as const });
  }
  return Object.freeze({
    reason: "No trusted Git executable candidate satisfied validation.",
    state: "unresolved" as const,
  });
}

function resolveCommandExecutable(
  resolveExecutable: (() => TrustedGitExecutableResolution) | undefined,
  platform: NodeJS.Platform,
): TrustedGitExecutableResolution {
  if (resolveExecutable !== undefined) {
    return resolveExecutable();
  }
  if (platform === process.platform) {
    return resolveTrustedGitExecutable();
  }
  return resolveTrustedGitExecutable({ platform });
}

function trustedGitCommandArguments(
  repository: string | undefined,
  args: readonly string[],
): readonly string[] {
  if (repository === undefined) {
    return args;
  }
  return ["-C", repository, ...args];
}

export function runTrustedGitTextCommand(
  options: RunTrustedGitCommandOptions,
): TrustedGitResult {
  const platform = options.platform ?? process.platform;
  const resolution = resolveCommandExecutable(options.resolveExecutable, platform);
  if (resolution.state === "unresolved") {
    return failedTrustedGitResolutionResult(resolution.reason);
  }
  const result = (options.spawn ?? spawnSync)(
    resolution.path,
    trustedGitCommandArguments(options.repository, options.args),
    {
      cwd: options.repository === undefined ? options.directory : undefined,
      encoding: "utf8",
      env: trustedGitEnvironment(options.directory, platform),
      input: options.input,
      maxBuffer: options.maxBuffer ?? defaultTrustedGitMaxBuffer,
    },
  );
  if (result.status !== 0 || result.error !== undefined) return failedGitResult();
  return Object.freeze({ state: "succeeded" as const, stdout: result.stdout });
}

export function runTrustedGitBytesCommand(
  options: RunTrustedGitCommandOptions,
): TrustedGitBytesResult {
  const platform = options.platform ?? process.platform;
  const resolution = resolveCommandExecutable(options.resolveExecutable, platform);
  if (resolution.state === "unresolved") {
    return failedTrustedGitResolutionResult(resolution.reason);
  }
  const result = (options.spawn ?? spawnSync)(
    resolution.path,
    trustedGitCommandArguments(options.repository, options.args),
    {
      cwd: options.repository === undefined ? options.directory : undefined,
      env: trustedGitEnvironment(options.directory, platform),
      input: options.input,
      maxBuffer: options.maxBuffer ?? defaultTrustedGitMaxBuffer,
    },
  );
  if (result.status !== 0 || result.error !== undefined) return failedGitResult();
  return Object.freeze({ state: "succeeded" as const, stdout: result.stdout });
}

export function runTrustedGit(
  repository: string,
  args: readonly string[],
): TrustedGitResult {
  return runTrustedGitTextCommand({ args, directory: repository, repository });
}

export function runTrustedGitBytes(
  repository: string,
  args: readonly string[],
): TrustedGitBytesResult {
  return runTrustedGitBytesCommand({ args, directory: repository, repository });
}

export function runTrustedGitWithInput(
  repository: string,
  args: readonly string[],
  input: string,
  maxBuffer: number,
): TrustedGitResult {
  return runTrustedGitTextCommand({
    args,
    directory: repository,
    input,
    maxBuffer,
    repository,
  });
}

export function runTrustedGitBytesWithInput(
  repository: string,
  args: readonly string[],
  input: string,
  maxBuffer: number,
): TrustedGitBytesResult {
  return runTrustedGitBytesCommand({
    args,
    directory: repository,
    input,
    maxBuffer,
    repository,
  });
}

export function runTrustedGitForWrite(
  repository: string,
  args: readonly string[],
): TrustedGitResult {
  return runTrustedGitTextCommand({ args, directory: repository, repository });
}

export function runTrustedGitBootstrap(
  directory: string,
  args: readonly string[],
): TrustedGitResult {
  return runTrustedGitTextCommand({ args, directory });
}
