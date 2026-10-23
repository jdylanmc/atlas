import { createHash } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import type { ValePlatformRelease } from "./vale_release.ts";

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

/**
 * Verifies a downloaded official Vale release asset against its pinned SHA-256
 * and returns the executable inside it. Nothing from an unverified asset is
 * extracted.
 */
export function extractValeBinary(
  release: ValePlatformRelease,
  asset: Uint8Array,
): Uint8Array {
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
  if (binary === undefined) {
    throw new Error(`${release.asset} does not contain ${release.binary}.`);
  }
  return binary;
}
