import assert from "node:assert/strict";
import type { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  isExecutableRegularFile,
  resolveTrustedGitExecutable,
  runTrustedGit,
  runTrustedGitBootstrap,
  runTrustedGitBytes,
  runTrustedGitBytesCommand,
  runTrustedGitBytesWithInput,
  runTrustedGitForWrite,
  runTrustedGitTextCommand,
  runTrustedGitWithInput,
  trustedGitEnvironment,
  type TrustedGitExecutableResolution,
} from "../src/platform/trusted_git.ts";

const ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE = resolve(ROOT, ".test-workspaces", "trusted-git");

function resolved(path: string): TrustedGitExecutableResolution {
  return Object.freeze({ path, state: "resolved" as const });
}

test("resolveTrustedGitExecutable selects ordered trusted candidates without using injected-call memoization", () => {
  const darwinChecks: string[] = [];
  const darwin = resolveTrustedGitExecutable({
    existsCandidate: (path) => path === "/usr/bin/git",
    isExecutableRegularFile: (path) => {
      darwinChecks.push(path);
      return path === "/usr/bin/git";
    },
    platform: "darwin",
  });
  assert.deepEqual(darwin, resolved("/usr/bin/git"));
  assert.deepEqual(darwinChecks, ["/usr/bin/git"]);

  const linuxMissingFirstChecks: string[] = [];
  const linuxMissingFirst = resolveTrustedGitExecutable({
    existsCandidate: (path) => path === "/bin/git",
    isExecutableRegularFile: (path) => {
      linuxMissingFirstChecks.push(path);
      return path === "/bin/git";
    },
    platform: "linux",
  });
  assert.deepEqual(linuxMissingFirst, resolved("/bin/git"));
  assert.deepEqual(linuxMissingFirstChecks, ["/bin/git"]);

  const linuxChecks: string[] = [];
  const linux = resolveTrustedGitExecutable({
    existsCandidate: (path) => path === "/usr/bin/git" || path === "/bin/git",
    isExecutableRegularFile: (path) => {
      linuxChecks.push(path);
      return path === "/bin/git";
    },
    platform: "linux",
  });
  assert.deepEqual(linux, resolved("/bin/git"));
  assert.deepEqual(linuxChecks, ["/usr/bin/git", "/bin/git"]);

  let win32ExistsCalls = 0;
  const injectedWin32 = {
    existsCandidate: (path: string) => {
      win32ExistsCalls += 1;
      return path === "C:\\Program Files\\Git\\cmd\\git.exe";
    },
    isExecutableRegularFile: (path: string) =>
      path === "C:\\Program Files\\Git\\cmd\\git.exe",
    platform: "win32" as const,
  };
  assert.deepEqual(
    resolveTrustedGitExecutable(injectedWin32),
    resolved("C:\\Program Files\\Git\\cmd\\git.exe"),
  );
  assert.deepEqual(
    resolveTrustedGitExecutable(injectedWin32),
    resolved("C:\\Program Files\\Git\\cmd\\git.exe"),
  );
  assert.equal(win32ExistsCalls, 2);
});

test("resolveTrustedGitExecutable reports unsupported platforms and missing validated candidates", () => {
  assert.deepEqual(resolveTrustedGitExecutable({ platform: "sunos" }), {
    reason: "Trusted Git resolution is unsupported on platform sunos.",
    state: "unresolved",
  });

  assert.deepEqual(
    resolveTrustedGitExecutable({
      existsCandidate: () => false,
      isExecutableRegularFile: () => true,
      platform: "darwin",
    }),
    {
      reason: "No trusted Git executable candidate satisfied validation.",
      state: "unresolved",
    },
  );

  assert.deepEqual(
    resolveTrustedGitExecutable({
      existsCandidate: () => true,
      isExecutableRegularFile: () => false,
      platform: "linux",
    }),
    {
      reason: "No trusted Git executable candidate satisfied validation.",
      state: "unresolved",
    },
  );
});

test("isExecutableRegularFile validates regular files, permissions, symlinks, and missing paths", () => {
  const workspace = resolve(WORKSPACE, "validator");
  rmSync(workspace, { force: true, recursive: true });
  mkdirSync(workspace, { recursive: true });

  const executable = resolve(workspace, "git-like");
  writeFileSync(executable, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(executable, 0o755);

  const plainFile = resolve(workspace, "plain-file");
  writeFileSync(plainFile, "content\n", "utf8");
  chmodSync(plainFile, 0o644);

  const directory = resolve(workspace, "directory");
  mkdirSync(directory, { recursive: true });

  const executableLink = resolve(workspace, "git-link");
  symlinkSync(executable, executableLink);

  const directoryLink = resolve(workspace, "directory-link");
  symlinkSync(directory, directoryLink);

  assert.equal(isExecutableRegularFile(executable, "darwin"), true);
  assert.equal(isExecutableRegularFile(directory, "darwin"), false);
  assert.equal(isExecutableRegularFile(plainFile, "linux"), false);
  assert.equal(isExecutableRegularFile(resolve(workspace, "missing"), "linux"), false);
  assert.equal(isExecutableRegularFile(executableLink, "linux"), true);
  assert.equal(isExecutableRegularFile(directoryLink, "linux"), false);
  assert.equal(isExecutableRegularFile(plainFile, "win32"), true);

  rmSync(workspace, { force: true, recursive: true });
});

test("trustedGitEnvironment rebuilds a scrubbed environment with platform-specific PATH", () => {
  const originalGitDir = process.env["GIT_DIR"];
  const originalGitWorkTree = process.env["GIT_WORK_TREE"];
  const originalGitObjectDirectory = process.env["GIT_OBJECT_DIRECTORY"];
  const originalGitReplaceRefBase = process.env["GIT_REPLACE_REF_BASE"];
  const originalGitExecPath = process.env["GIT_EXEC_PATH"];
  const originalPath = process.env["PATH"];
  try {
    process.env["GIT_DIR"] = "hostile-dir";
    process.env["GIT_WORK_TREE"] = "hostile-work-tree";
    process.env["GIT_OBJECT_DIRECTORY"] = "hostile-objects";
    process.env["GIT_REPLACE_REF_BASE"] = "hostile-replace-ref";
    process.env["GIT_EXEC_PATH"] = "hostile-exec-path";
    process.env["PATH"] = "hostile-path";

    const posixEnvironment = trustedGitEnvironment(resolve(ROOT, "repo"), "linux");
    assert.equal(posixEnvironment["PATH"], "/usr/bin:/bin");
    assert.equal(posixEnvironment["GIT_DIR"], undefined);
    assert.equal(posixEnvironment["GIT_WORK_TREE"], undefined);
    assert.equal(posixEnvironment["GIT_OBJECT_DIRECTORY"], undefined);
    assert.equal(posixEnvironment["GIT_REPLACE_REF_BASE"], undefined);
    assert.equal(posixEnvironment["GIT_EXEC_PATH"], undefined);
    assert.equal(posixEnvironment["GIT_CEILING_DIRECTORIES"], ROOT);
    assert.equal(posixEnvironment["GIT_CONFIG_COUNT"], "3");
    assert.equal(posixEnvironment["GIT_CONFIG_KEY_0"], "core.attributesFile");
    assert.equal(posixEnvironment["GIT_CONFIG_KEY_1"], "core.fsmonitor");
    assert.equal(posixEnvironment["GIT_CONFIG_VALUE_1"], "false");

    const windowsEnvironment = trustedGitEnvironment(resolve(ROOT, "repo"), "win32");
    assert.equal(windowsEnvironment["PATH"], "C:\\Windows\\System32;C:\\Windows");
    assert.equal(windowsEnvironment["GIT_DIR"], undefined);
    assert.equal(windowsEnvironment["GIT_WORK_TREE"], undefined);
    assert.equal(windowsEnvironment["GIT_OBJECT_DIRECTORY"], undefined);
    assert.equal(windowsEnvironment["GIT_REPLACE_REF_BASE"], undefined);
    assert.equal(windowsEnvironment["GIT_EXEC_PATH"], undefined);
  } finally {
    if (originalGitDir === undefined) delete process.env["GIT_DIR"];
    else process.env["GIT_DIR"] = originalGitDir;
    if (originalGitWorkTree === undefined) delete process.env["GIT_WORK_TREE"];
    else process.env["GIT_WORK_TREE"] = originalGitWorkTree;
    if (originalGitObjectDirectory === undefined) {
      delete process.env["GIT_OBJECT_DIRECTORY"];
    } else {
      process.env["GIT_OBJECT_DIRECTORY"] = originalGitObjectDirectory;
    }
    if (originalGitReplaceRefBase === undefined) {
      delete process.env["GIT_REPLACE_REF_BASE"];
    } else {
      process.env["GIT_REPLACE_REF_BASE"] = originalGitReplaceRefBase;
    }
    if (originalGitExecPath === undefined) delete process.env["GIT_EXEC_PATH"];
    else process.env["GIT_EXEC_PATH"] = originalGitExecPath;
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
  }
});

test("trusted git command helpers preserve containment and surface resolution or process failures", () => {
  type SpawnOptions = Exclude<Parameters<typeof spawnSync>[2], undefined>;
  const invocations: Array<{
    readonly args: readonly string[] | undefined;
    readonly executable: string;
    readonly options: SpawnOptions;
  }> = [];

  const textSpawn = ((
    executable: string,
    args: readonly string[] | undefined,
    options: SpawnOptions,
  ) => {
    invocations.push({ args, executable, options });
    return {
      error: undefined,
      output: [null, "text-output\n", ""],
      pid: 1,
      signal: null,
      status: 0,
      stderr: "",
      stdout: "text-output\n",
    };
  }) as unknown as typeof spawnSync;
  const textResult = runTrustedGitTextCommand({
    args: ["rev-parse", "HEAD"],
    directory: ROOT,
    platform: "linux",
    repository: ROOT,
    resolveExecutable: () => resolved("/usr/bin/git"),
    spawn: textSpawn,
  });
  const firstInvocation = invocations[0];
  assert.ok(firstInvocation);
  assert.deepEqual(textResult, { state: "succeeded", stdout: "text-output\n" });
  assert.deepEqual(firstInvocation.args, ["-C", ROOT, "rev-parse", "HEAD"]);
  assert.equal(firstInvocation.executable, "/usr/bin/git");
  assert.equal(firstInvocation.options.cwd, undefined);
  assert.equal(firstInvocation.options.env?.["PATH"], "/usr/bin:/bin");
  assert.equal(firstInvocation.options.maxBuffer, 16 * 1024 * 1024);

  const bytes = Buffer.from([1, 2, 3]);
  const bytesSpawn = ((
    executable: string,
    args: readonly string[] | undefined,
    options: SpawnOptions,
  ) => {
    invocations.push({ args, executable, options });
    return {
      error: undefined,
      output: [null, bytes, Buffer.alloc(0)],
      pid: 2,
      signal: null,
      status: 0,
      stderr: Buffer.alloc(0),
      stdout: bytes,
    };
  }) as unknown as typeof spawnSync;
  const bytesResult = runTrustedGitBytesCommand({
    args: ["status"],
    directory: ROOT,
    input: "stdin",
    maxBuffer: 123,
    platform: "win32",
    resolveExecutable: () => resolved("C:\\Program Files\\Git\\cmd\\git.exe"),
    spawn: bytesSpawn,
  });
  const secondInvocation = invocations[1];
  assert.ok(secondInvocation);
  assert.equal(bytesResult.state, "succeeded");
  assert.deepEqual(Array.from(bytesResult.stdout), [1, 2, 3]);
  assert.deepEqual(secondInvocation.args, ["status"]);
  assert.equal(secondInvocation.executable, "C:\\Program Files\\Git\\cmd\\git.exe");
  assert.equal(secondInvocation.options.cwd, ROOT);
  assert.equal(
    secondInvocation.options.env?.["PATH"],
    "C:\\Windows\\System32;C:\\Windows",
  );
  assert.equal(secondInvocation.options.input, "stdin");
  assert.equal(secondInvocation.options.maxBuffer, 123);

  const unresolvedText = runTrustedGitTextCommand({
    args: ["status"],
    directory: ROOT,
    resolveExecutable: () => ({
      reason: "No trusted Git executable candidate satisfied validation.",
      state: "unresolved",
    }),
    spawn: () => {
      throw new Error("spawn should not run");
    },
  });
  assert.deepEqual(unresolvedText, {
    reason:
      "Could not resolve a trusted Git executable: No trusted Git executable candidate satisfied validation.",
    state: "failed",
  });

  const unresolvedBytes = runTrustedGitBytesCommand({
    args: ["status"],
    directory: ROOT,
    platform: "win32",
  });
  assert.equal(unresolvedBytes.state, "failed");
  assert.match(unresolvedBytes.reason, /^Could not resolve a trusted Git executable:/u);

  const failedText = runTrustedGitTextCommand({
    args: ["status"],
    directory: ROOT,
    resolveExecutable: () => resolved("/usr/bin/git"),
    spawn: (() => ({
      error: undefined,
      output: [null, "", "boom"],
      pid: 3,
      signal: null,
      status: 1,
      stderr: "boom",
      stdout: "",
    })) as unknown as typeof spawnSync,
  });
  assert.deepEqual(failedText, {
    reason: "Git failed while running in the trusted platform adapter.",
    state: "failed",
  });

  const failedBytes = runTrustedGitBytesCommand({
    args: ["status"],
    directory: ROOT,
    resolveExecutable: () => resolved("/usr/bin/git"),
    spawn: (() => ({
      error: new Error("boom"),
      output: [null, Buffer.alloc(0), Buffer.alloc(0)],
      pid: 4,
      signal: null,
      status: 0,
      stderr: Buffer.alloc(0),
      stdout: Buffer.alloc(0),
    })) as unknown as typeof spawnSync,
  });
  assert.deepEqual(failedBytes, {
    reason: "Git failed while running in the trusted platform adapter.",
    state: "failed",
  });
});

test("trusted git public wrappers keep the current host behavior", () => {
  const resolution = resolveTrustedGitExecutable();
  assert.equal(resolution.state, "resolved");
  if (process.platform === "darwin" || process.platform === "linux") {
    assert.equal(resolution.path, "/usr/bin/git");
  }

  const revision = runTrustedGit(ROOT, ["rev-parse", "HEAD"]);
  assert.equal(revision.state, "succeeded");
  assert.match(revision.stdout.trim(), /^[0-9a-f]{40}$/u);

  const revisionBytes = runTrustedGitBytes(ROOT, ["rev-parse", "HEAD"]);
  assert.equal(revisionBytes.state, "succeeded");
  assert.match(
    new TextDecoder().decode(revisionBytes.stdout).trim(),
    /^[0-9a-f]{40}$/u,
  );

  const hashText = runTrustedGitWithInput(
    ROOT,
    ["hash-object", "--stdin"],
    "atlas\n",
    1024,
  );
  assert.equal(hashText.state, "succeeded");
  assert.match(hashText.stdout.trim(), /^[0-9a-f]{40}$/u);

  const hashBytes = runTrustedGitBytesWithInput(
    ROOT,
    ["hash-object", "--stdin"],
    "atlas\n",
    1024,
  );
  assert.equal(hashBytes.state, "succeeded");
  assert.match(new TextDecoder().decode(hashBytes.stdout).trim(), /^[0-9a-f]{40}$/u);

  const writeRevision = runTrustedGitForWrite(ROOT, ["rev-parse", "HEAD"]);
  assert.equal(writeRevision.state, "succeeded");
  assert.match(writeRevision.stdout.trim(), /^[0-9a-f]{40}$/u);

  const bootstrap = runTrustedGitBootstrap(ROOT, ["--version"]);
  assert.equal(bootstrap.state, "succeeded");
  assert.match(bootstrap.stdout, /^git version /u);
});
