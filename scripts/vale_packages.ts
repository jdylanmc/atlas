#!/usr/bin/env node
/**
 * Builds and installs the per-platform Vale packages Atlas SDK depends on.
 *
 * Atlas SDK runs one pinned Vale release (src/platform/vale_release.ts). Each
 * supported platform receives that release's binary through an exact-version
 * optional npm dependency, `@jdylanmc/atlas-vale-<os>-<cpu>`. This script
 * downloads a release asset, verifies its pinned SHA-256, and extracts the
 * binary without relying on system archive tools.
 *
 *   vale_packages.ts install            install this machine's package into node_modules
 *   vale_packages.ts pack --out DIR     stage and npm-pack every platform package
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";
import {
  valePlatformRelease,
  valePlatformReleases,
  valeReleaseUrl,
  valeVersion,
  type ValePlatformRelease,
} from "../src/platform/vale_release.ts";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

export interface ExtractedValeRelease {
  readonly binary: Uint8Array;
  readonly license: Uint8Array;
}

export type DownloadAsset = (url: string) => Promise<Uint8Array>;

export type PackDirectory = (directory: string, out: string) => string;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tarString(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return new TextDecoder().decode(end < 0 ? field : field.subarray(0, end));
}

/** Reads the regular files of an uncompressed POSIX tar archive by base name. */
export function tarEntries(archive: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const size = Number.parseInt(tarString(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] as number);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Vale release archive has a malformed tar header.");
    }
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > archive.byteLength) {
      throw new Error("Vale release archive is truncated.");
    }
    if (type === "0" || type === "\0") {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      entries.set(
        path.split("/").at(-1) as string,
        archive.slice(contentStart, contentEnd),
      );
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** Reads the files of a ZIP archive by base name via its central directory. */
export function zipEntries(archive: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = archive.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Vale release archive is not a ZIP file.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Vale release archive has a malformed ZIP directory.");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(
      archive.subarray(offset + 46, offset + 46 + nameLength),
    );
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    if (!name.endsWith("/")) {
      const content =
        method === 0
          ? data.slice()
          : method === 8
            ? new Uint8Array(inflateRawSync(data))
            : undefined;
      if (content === undefined) {
        throw new Error("Vale release archive uses an unsupported ZIP compression.");
      }
      entries.set(name.split("/").at(-1) as string, content);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Verifies a downloaded release asset and extracts its binary and license. */
export function extractValeRelease(
  release: ValePlatformRelease,
  asset: Uint8Array,
): ExtractedValeRelease {
  const digest = sha256(asset);
  if (digest !== release.sha256) {
    throw new Error(
      `${release.asset} has SHA-256 ${digest}; Atlas SDK pins ${release.sha256}.`,
    );
  }
  const entries = release.asset.endsWith(".zip")
    ? zipEntries(asset)
    : tarEntries(new Uint8Array(gunzipSync(asset)));
  const binary = entries.get(release.binary);
  const license = entries.get("LICENSE");
  if (binary === undefined || license === undefined) {
    throw new Error(`${release.asset} does not contain ${release.binary} and LICENSE.`);
  }
  return Object.freeze({ binary, license });
}

const downloadAsset: DownloadAsset = async (url) => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Downloading ${url} failed with HTTP ${String(response.status)}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

export function platformPackageManifest(release: ValePlatformRelease): string {
  return `${JSON.stringify(
    {
      name: release.packageName,
      version: valeVersion,
      description: `Vale ${valeVersion} prose linter binary for Atlas SDK on ${release.os}-${release.cpu}.`,
      license: "MIT",
      repository: { type: "git", url: "git+https://github.com/jdylanmc/atlas.git" },
      os: [release.os],
      cpu: [release.cpu],
      files: [`bin/${release.binary}`, "LICENSE", "README.md"],
      publishConfig: { access: "public" },
    },
    null,
    2,
  )}\n`;
}

function platformPackageReadme(release: ValePlatformRelease): string {
  return `# ${release.packageName}

The [Vale](https://vale.sh) ${valeVersion} binary for ${release.os}-${release.cpu}, repackaged
unmodified from \`${release.asset}\` (SHA-256 \`${release.sha256}\`) for Atlas SDK's prose
Lint. Vale is MIT-licensed by its authors; see \`LICENSE\`. Install \`@jdylanmc/atlas\`,
not this package directly.
`;
}

/** Writes one platform package directory: manifest, README, license, and binary. */
export function writePlatformPackage(
  directory: string,
  release: ValePlatformRelease,
  extracted: ExtractedValeRelease,
): void {
  mkdirSync(join(directory, "bin"), { recursive: true });
  writeFileSync(join(directory, "package.json"), platformPackageManifest(release));
  writeFileSync(join(directory, "README.md"), platformPackageReadme(release));
  writeFileSync(join(directory, "LICENSE"), extracted.license);
  const binary = join(directory, "bin", release.binary);
  writeFileSync(binary, extracted.binary);
  chmodSync(binary, 0o755);
}

function installedVersion(directory: string, release: ValePlatformRelease): string {
  const binary = join(directory, "bin", release.binary);
  if (!existsSync(binary)) return "";
  const result = spawnSync(binary, ["--version"], { encoding: "utf8", env: {} });
  return result.status === 0 ? result.stdout.trim() : "";
}

/** The pinned release for a platform, or an error naming the unsupported one. */
export function hostRelease(
  os: string = process.platform,
  cpu: string = process.arch,
): ValePlatformRelease {
  const release = valePlatformRelease(os, cpu);
  if (release === undefined) {
    throw new Error(`Atlas SDK does not bundle Vale for ${os}-${cpu}.`);
  }
  return release;
}

/** Installs this machine's pinned Vale package into the repository's node_modules. */
export async function installHostPackage(
  root: string,
  release: ValePlatformRelease = hostRelease(),
  download: DownloadAsset = downloadAsset,
): Promise<string> {
  const directory = join(root, "node_modules", ...release.packageName.split("/"));
  if (installedVersion(directory, release) === `vale version ${valeVersion}`) {
    return `${release.packageName}@${valeVersion} already installed`;
  }
  const extracted = extractValeRelease(
    release,
    await download(valeReleaseUrl(release)),
  );
  rmSync(directory, { force: true, recursive: true });
  writePlatformPackage(directory, release, extracted);
  return `installed ${release.packageName}@${valeVersion}`;
}

const npmPack: PackDirectory = (directory, out) => {
  const result = spawnSync(
    "npm",
    ["pack", "--pack-destination", resolve(out), "--ignore-scripts"],
    { cwd: directory, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    throw new Error(`npm pack failed in ${directory}: ${result.stderr}`);
  }
  return result.stdout.trim();
};

/** Stages and packs every platform package into `out`, ready to publish. */
export async function packPlatformPackages(
  out: string,
  releases: readonly ValePlatformRelease[] = valePlatformReleases,
  download: DownloadAsset = downloadAsset,
  pack: PackDirectory = npmPack,
): Promise<readonly string[]> {
  mkdirSync(out, { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), "atlas-vale-pack-"));
  const packed: string[] = [];
  try {
    for (const release of releases) {
      const extracted = extractValeRelease(
        release,
        await download(valeReleaseUrl(release)),
      );
      const directory = join(staging, `${release.os}-${release.cpu}`);
      writePlatformPackage(directory, release, extracted);
      packed.push(pack(directory, out));
    }
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
  return packed;
}

export async function main(
  arguments_: readonly string[],
  install: (root: string) => Promise<string> = (root) => installHostPackage(root),
  packAll: (out: string) => Promise<readonly string[]> = (out) =>
    packPlatformPackages(out),
): Promise<number> {
  try {
    if (arguments_.length === 1 && arguments_[0] === "install") {
      console.log(await install(ROOT));
      return 0;
    }
    if (
      arguments_.length === 3 &&
      arguments_[0] === "pack" &&
      arguments_[1] === "--out"
    ) {
      for (const file of await packAll(arguments_[2] as string)) {
        console.log(file);
      }
      return 0;
    }
  } catch (error: unknown) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
  console.error("usage: vale_packages.ts install | pack --out DIR");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
