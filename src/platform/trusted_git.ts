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

function runGit(repository: string, args: readonly string[]): TrustedGitResult {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    encoding: "utf8",
    env: trustedGitEnvironment(repository),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return Object.freeze({
      reason: "Git failed while running in the trusted platform adapter.",
      state: "failed" as const,
    });
  }
  return Object.freeze({ state: "succeeded" as const, stdout: result.stdout });
}

function runGitBytes(
  repository: string,
  args: readonly string[],
):
  | { readonly reason: string; readonly state: "failed" }
  | {
      readonly stdout: Uint8Array;
      readonly state: "succeeded";
    } {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    env: trustedGitEnvironment(repository),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return Object.freeze({
      reason: "Git failed while running in the trusted platform adapter.",
      state: "failed" as const,
    });
  }
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

export function runTrustedGitForWrite(
  repository: string,
  args: readonly string[],
): TrustedGitResult {
  return runGit(repository, args);
}
