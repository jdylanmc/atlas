/**
 * The one Vale release Atlas SDK runs. Prose Lint results depend on the Vale
 * version, so Atlas SDK pins it exactly: it downloads this official release
 * asset once per machine, verifies its SHA-256, and refuses any binary that
 * reports a different version. Atlas SDK does not redistribute Vale.
 */
export const valeVersion = "3.24.0";

export interface ValePlatformRelease {
  /** The GitHub release asset carrying the binary. */
  readonly asset: string;
  /** The executable's name inside the asset and the machine cache. */
  readonly binary: "vale" | "vale.exe";
  readonly cpu: "arm64" | "x64";
  readonly os: "darwin" | "linux" | "win32";
  /** SHA-256 of the release asset, from Vale's published checksums. */
  readonly sha256: string;
}

function release(
  os: ValePlatformRelease["os"],
  cpu: ValePlatformRelease["cpu"],
  asset: string,
  sha256: string,
): ValePlatformRelease {
  return Object.freeze({
    asset,
    binary: os === "win32" ? ("vale.exe" as const) : ("vale" as const),
    cpu,
    os,
    sha256,
  });
}

export const valePlatformReleases: readonly ValePlatformRelease[] = Object.freeze([
  release(
    "darwin",
    "arm64",
    `vale_${valeVersion}_macOS_arm64.tar.gz`,
    "87b513f26499f6657c15cf7175ba5b058a7c1ff2bb2d4e07265db2dd43451e44",
  ),
  release(
    "darwin",
    "x64",
    `vale_${valeVersion}_macOS_64-bit.tar.gz`,
    "eeb39e86f1daac27cc2a77fef3af1824d50559bdc22329fb25fb921c80c79472",
  ),
  release(
    "linux",
    "arm64",
    `vale_${valeVersion}_Linux_arm64.tar.gz`,
    "104cbd349279e50c4cb40adb70adf345d93cc4a3a0191f9e68bdccb97086b582",
  ),
  release(
    "linux",
    "x64",
    `vale_${valeVersion}_Linux_64-bit.tar.gz`,
    "867534ddb678abca7f214bc4706ead0922bd5252ffe8035fc227013f66c8b214",
  ),
  release(
    "win32",
    "arm64",
    `vale_${valeVersion}_Windows_arm64.zip`,
    "3ec62981d49558d89c2ee2e9836f10db86ca335fdfaa2b701a9fbeca1496a5c7",
  ),
  release(
    "win32",
    "x64",
    `vale_${valeVersion}_Windows_64-bit.zip`,
    "3a8884774973b6f2826877e1c6388a5feae4704ef88a9a9c912c77ce186990f3",
  ),
]);

export function valePlatformRelease(
  os: string,
  cpu: string,
): ValePlatformRelease | undefined {
  return valePlatformReleases.find((entry) => entry.os === os && entry.cpu === cpu);
}

export function valeReleaseUrl(entry: ValePlatformRelease): string {
  return `https://github.com/vale-cli/vale/releases/download/v${valeVersion}/${entry.asset}`;
}
