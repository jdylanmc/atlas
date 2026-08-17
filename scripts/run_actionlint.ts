#!/usr/bin/env node
/** Download and run the repository-pinned Actionlint release. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const VERSION = "1.7.7";
const RELEASE_BASE = `https://github.com/rhysd/actionlint/releases/download/v${VERSION}`;
const SHELLCHECK_VERSION = "0.11.0";
const SHELLCHECK_RELEASE_BASE = `https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}`;
const REPOSITORY_ROOT = resolve(
  process.env["ATLAS_REPOSITORY_ROOT"] ?? resolve(import.meta.dirname, ".."),
);
const TOOL_CACHE = resolve(
  process.env["ATLAS_TOOL_CACHE"] ?? join(REPOSITORY_ROOT, "node_modules", ".cache"),
);

const ARCHES = {
  arm64: "arm64",
  x64: "amd64",
} as const;

const CHECKSUMS = {
  "darwin-amd64": "28e5de5a05fc558474f638323d736d822fff183d2d492f0aecb2b73cc44584f5",
  "darwin-arm64": "2693315b9093aeacb4ebd91a993fea54fc215057bf0da2659056b4bc033873db",
  "linux-amd64": "023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757",
  "linux-arm64": "401942f9c24ed71e4fe71b76c7d638f66d8633575c4016efd2977ce7c28317d0",
  "windows-amd64": "7f12f1801bca3d480d67aaf7774f4c2a6359a3ca8eebe382c95c10c9704aa731",
  "windows-arm64": "76e9514cfac18e5677aa04f3a89873c981f16a2f2353bb97372a86cd09b1f5a8",
} as const;

type SupportedAsset = keyof typeof CHECKSUMS;

const SHELLCHECK_CHECKSUMS = {
  "darwin-amd64": "c2c15e08df0e8fbc374c335b230a7ee958c313fa5714817a59aa59f1aa594f51",
  "darwin-arm64": "339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f",
  "linux-amd64": "b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6",
  "linux-arm64": "68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc",
  "windows-amd64": "8a4e35ab0b331c85d73567b12f2a444df187f483e5079ceffa6bda1faa2e740e",
} as const;

type SupportedShellCheckAsset = keyof typeof SHELLCHECK_CHECKSUMS;

export function platformName(
  platform: NodeJS.Platform = process.platform,
): "darwin" | "linux" | "windows" {
  if (platform === "darwin" || platform === "linux") {
    return platform;
  }
  if (platform === "win32") {
    return "windows";
  }
  throw new Error(`Actionlint is not pinned for platform ${platform}`);
}

export function architectureName(
  architecture: NodeJS.Architecture = process.arch,
): "amd64" | "arm64" {
  if (architecture === "x64" || architecture === "arm64") {
    return ARCHES[architecture];
  }
  throw new Error(`Actionlint is not pinned for architecture ${architecture}`);
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function downloadArchive(
  path: string,
  releaseBase: string,
  asset: string,
  checksum: string,
): Promise<void> {
  const response = await fetch(`${releaseBase}/${asset}`);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${asset}: ${String(response.status)} ${response.statusText}`,
    );
  }
  const data = new Uint8Array(await response.arrayBuffer());
  const actualChecksum = sha256(data);
  if (actualChecksum !== checksum) {
    throw new Error(
      `${asset} checksum mismatch: expected ${checksum}, received ${actualChecksum}`,
    );
  }
  writeFileSync(path, data, { mode: 0o600 });
}

async function prepareActionlint(): Promise<string> {
  const platform = platformName();
  const architecture = architectureName();
  const assetKey: SupportedAsset = `${platform}-${architecture}`;
  const checksum = CHECKSUMS[assetKey];
  const extension = platform === "windows" ? "zip" : "tar.gz";
  const asset = `actionlint_${VERSION}_${platform}_${architecture}.${extension}`;
  const cacheRoot = join(TOOL_CACHE, "actionlint", VERSION, assetKey);
  const archivePath = join(cacheRoot, asset);
  const binaryName = platform === "windows" ? "actionlint.exe" : "actionlint";
  const binaryPath = join(cacheRoot, binaryName);
  mkdirSync(cacheRoot, { recursive: true });

  if (existsSync(archivePath) && sha256(readFileSync(archivePath)) !== checksum) {
    rmSync(archivePath);
  }
  if (!existsSync(archivePath)) {
    await downloadArchive(archivePath, RELEASE_BASE, asset, checksum);
  }
  if (lstatSync(archivePath).isSymbolicLink()) {
    throw new Error("Cached Actionlint archive must not be a symbolic link");
  }

  rmSync(binaryPath, { force: true });
  execFileSync(
    "tar",
    [platform === "windows" ? "-xf" : "-xzf", archivePath, "-C", cacheRoot, binaryName],
    { cwd: REPOSITORY_ROOT, stdio: "inherit" },
  );
  const binaryStat = lstatSync(binaryPath);
  if (binaryStat.isSymbolicLink() || !binaryStat.isFile()) {
    throw new Error("Extracted Actionlint binary must be a regular file");
  }
  if (platform !== "windows") {
    chmodSync(binaryPath, 0o755);
  }
  return binaryPath;
}

async function prepareShellCheck(): Promise<string> {
  const platform = platformName();
  const architecture = architectureName();
  const shellCheckArchitecture =
    platform === "windows" ? "amd64" : architecture === "arm64" ? "aarch64" : "x86_64";
  const assetKey: SupportedShellCheckAsset =
    platform === "windows" ? "windows-amd64" : `${platform}-${architecture}`;
  const checksum = SHELLCHECK_CHECKSUMS[assetKey];
  const extension = platform === "windows" ? "zip" : "tar.gz";
  const asset =
    platform === "windows"
      ? `shellcheck-v${SHELLCHECK_VERSION}.${extension}`
      : `shellcheck-v${SHELLCHECK_VERSION}.${platform}.${shellCheckArchitecture}.${extension}`;
  const cacheRoot = join(TOOL_CACHE, "shellcheck", SHELLCHECK_VERSION, assetKey);
  const archivePath = join(cacheRoot, asset);
  const extractedDirectory = join(cacheRoot, `shellcheck-v${SHELLCHECK_VERSION}`);
  const binaryName = platform === "windows" ? "shellcheck.exe" : "shellcheck";
  const binaryPath =
    platform === "windows"
      ? join(cacheRoot, binaryName)
      : join(extractedDirectory, binaryName);
  mkdirSync(cacheRoot, { recursive: true });

  if (existsSync(archivePath) && sha256(readFileSync(archivePath)) !== checksum) {
    rmSync(archivePath);
  }
  if (!existsSync(archivePath)) {
    await downloadArchive(archivePath, SHELLCHECK_RELEASE_BASE, asset, checksum);
  }
  if (lstatSync(archivePath).isSymbolicLink()) {
    throw new Error("Cached ShellCheck archive must not be a symbolic link");
  }

  rmSync(extractedDirectory, { recursive: true, force: true });
  rmSync(binaryPath, { force: true });
  execFileSync(
    "tar",
    [
      platform === "windows" ? "-xf" : "-xzf",
      archivePath,
      "-C",
      cacheRoot,
      platform === "windows"
        ? binaryName
        : `shellcheck-v${SHELLCHECK_VERSION}/${binaryName}`,
    ],
    { cwd: REPOSITORY_ROOT, stdio: "inherit" },
  );
  const binaryStat = lstatSync(binaryPath);
  if (binaryStat.isSymbolicLink() || !binaryStat.isFile()) {
    throw new Error("Extracted ShellCheck binary must be a regular file");
  }
  if (platform !== "windows") {
    chmodSync(binaryPath, 0o755);
  }
  return binaryPath;
}

type ActionlintDependencies = {
  prepareActionlint: () => Promise<string>;
  prepareShellCheck: () => Promise<string>;
  execute: (
    file: string,
    args: readonly string[],
    options: { cwd: string; stdio: "inherit" },
  ) => unknown;
};

export async function runActionlint(
  args: string[] = process.argv.slice(2),
  dependencies: ActionlintDependencies = {
    prepareActionlint,
    prepareShellCheck,
    execute: execFileSync,
  },
): Promise<number> {
  const [actionlintPath, shellCheckPath] = await Promise.all([
    dependencies.prepareActionlint(),
    dependencies.prepareShellCheck(),
  ]);
  dependencies.execute(
    actionlintPath,
    ["-shellcheck", shellCheckPath, "-pyflakes", "", ...args],
    {
      cwd: REPOSITORY_ROOT,
      stdio: "inherit",
    },
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = await runActionlint();
}
