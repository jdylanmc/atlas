import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const trustedGitExecutable = "/usr/bin/git";
const trustedGitConfig = Object.freeze({
  "core.attributesFile": "/dev/null",
  "core.fsmonitor": "false",
  "core.hooksPath": "/dev/null",
} as const);

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

function trustedGitEnvironment(repository: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_CONFIG: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: dirname(resolve(repository)),
    HOME: "/nonexistent",
    NODE_V8_COVERAGE: process.env["NODE_V8_COVERAGE"],
    PATH: "/usr/bin:/bin",
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

function runGit(repository: string, args: readonly string[]): TrustedGitResult {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    encoding: "utf8",
    env: trustedGitEnvironment(repository),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return failedGitResult();
  return Object.freeze({ state: "succeeded" as const, stdout: result.stdout });
}

function runGitBootstrap(directory: string, args: readonly string[]): TrustedGitResult {
  const result = spawnSync(trustedGitExecutable, args, {
    cwd: directory,
    encoding: "utf8",
    env: trustedGitEnvironment(directory),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return failedGitResult();
  return Object.freeze({ state: "succeeded" as const, stdout: result.stdout });
}

function runGitWithInput(
  repository: string,
  args: readonly string[],
  input: string,
  maxBuffer: number,
): TrustedGitResult {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    encoding: "utf8",
    env: trustedGitEnvironment(repository),
    input,
    maxBuffer,
  });
  if (result.status !== 0 || result.error !== undefined) return failedGitResult();
  return Object.freeze({ state: "succeeded" as const, stdout: result.stdout });
}

function runGitBytes(
  repository: string,
  args: readonly string[],
): TrustedGitBytesResult {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    env: trustedGitEnvironment(repository),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return failedGitResult();
  return Object.freeze({ state: "succeeded" as const, stdout: result.stdout });
}

function runGitBytesWithInput(
  repository: string,
  args: readonly string[],
  input: string,
  maxBuffer: number,
): TrustedGitBytesResult {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    env: trustedGitEnvironment(repository),
    input,
    maxBuffer,
  });
  if (result.status !== 0 || result.error !== undefined) return failedGitResult();
  return Object.freeze({ state: "succeeded" as const, stdout: result.stdout });
}

export function runTrustedGit(
  repository: string,
  args: readonly string[],
): TrustedGitResult {
  return runGit(repository, args);
}

export function runTrustedGitBytes(
  repository: string,
  args: readonly string[],
): ReturnType<typeof runGitBytes> {
  return runGitBytes(repository, args);
}

export function runTrustedGitWithInput(
  repository: string,
  args: readonly string[],
  input: string,
  maxBuffer: number,
): TrustedGitResult {
  return runGitWithInput(repository, args, input, maxBuffer);
}

export function runTrustedGitBytesWithInput(
  repository: string,
  args: readonly string[],
  input: string,
  maxBuffer: number,
): TrustedGitBytesResult {
  return runGitBytesWithInput(repository, args, input, maxBuffer);
}

export function runTrustedGitForWrite(
  repository: string,
  args: readonly string[],
): TrustedGitResult {
  return runGit(repository, args);
}

export function runTrustedGitBootstrap(
  directory: string,
  args: readonly string[],
): TrustedGitResult {
  return runGitBootstrap(directory, args);
}
