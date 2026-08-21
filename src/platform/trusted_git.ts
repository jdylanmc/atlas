import { spawnSync } from "node:child_process";

const trustedGitExecutable = "/usr/bin/git";

export type TrustedGitResult =
  | {
      readonly reason: string;
      readonly state: "failed";
    }
  | {
      readonly stdout: string;
      readonly state: "succeeded";
    };

function trustedGitEnvironment(): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: "/nonexistent",
    NODE_V8_COVERAGE: process.env["NODE_V8_COVERAGE"],
    PATH: "/usr/bin:/bin",
    XDG_CONFIG_HOME: "/nonexistent",
  };
}

export function runTrustedGit(
  repository: string,
  args: readonly string[],
): TrustedGitResult {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    encoding: "utf8",
    env: trustedGitEnvironment(),
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

export function runTrustedGitBytes(
  repository: string,
  args: readonly string[],
):
  | { readonly reason: string; readonly state: "failed" }
  | {
      readonly stdout: Uint8Array;
      readonly state: "succeeded";
    } {
  const result = spawnSync(trustedGitExecutable, ["-C", repository, ...args], {
    env: trustedGitEnvironment(),
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
