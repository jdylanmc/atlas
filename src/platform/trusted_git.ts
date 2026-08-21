import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const trustedGitExecutable = "/usr/bin/git";
const trustedWriteGitConfig = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.attributesFile=/dev/null",
] as const);

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
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: dirname(resolve(repository)),
    HOME: "/nonexistent",
    NODE_V8_COVERAGE: process.env["NODE_V8_COVERAGE"],
    PATH: "/usr/bin:/bin",
    XDG_CONFIG_HOME: "/nonexistent",
  };
}

function runGit(
  repository: string,
  args: readonly string[],
  mode: "read" | "write",
): TrustedGitResult {
  const result = spawnSync(
    trustedGitExecutable,
    ["-C", repository, ...(mode === "write" ? trustedWriteGitConfig : []), ...args],
    {
      encoding: "utf8",
      env: trustedGitEnvironment(repository),
      maxBuffer: 16 * 1024 * 1024,
    },
  );
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
  return runGit(repository, args, "read");
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
  return runGit(repository, args, "write");
}
