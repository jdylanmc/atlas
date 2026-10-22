import { deflateRawSync } from "node:zlib";
import { sha256 } from "../src/platform/vale_archive.ts";
import type { ValePlatformRelease } from "../src/platform/vale_release.ts";

const encoder = new TextEncoder();

export interface TarEntry {
  readonly content?: string;
  readonly name: string;
  readonly prefix?: string;
  readonly size?: string;
  readonly type?: string;
}

export function tar(entries: readonly TarEntry[], trailer = true): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512);
    const content = encoder.encode(entry.content ?? "");
    header.set(encoder.encode(entry.name), 0);
    header.set(
      encoder.encode(
        entry.size ?? `${content.byteLength.toString(8).padStart(11, "0")}\0`,
      ),
      124,
    );
    header.set(encoder.encode(entry.type ?? "0"), 156);
    if (entry.prefix !== undefined) header.set(encoder.encode(entry.prefix), 345);
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(content.byteLength / 512) * 512);
    padded.set(content);
    blocks.push(padded);
  }
  if (trailer) blocks.push(new Uint8Array(1024));
  return Buffer.concat(blocks);
}

export interface ZipEntry {
  readonly content: string;
  readonly method?: number;
  readonly name: string;
}

export function zip(
  entries: readonly ZipEntry[],
  directorySignature = 0x02014b50,
): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 0;
    const raw = encoder.encode(entry.content);
    const data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = encoder.encode(entry.name);
    const local = new Uint8Array(30 + name.byteLength + data.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, data.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(data, 30 + name.byteLength);
    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, directorySignature, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, data.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.byteLength;
  }
  const directorySize = centrals.reduce((total, entry) => total + entry.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function fakeRelease(
  asset: string,
  bytes: Uint8Array,
  os = "linux",
): ValePlatformRelease {
  return Object.freeze({
    asset,
    binary: os === "win32" ? ("vale.exe" as const) : ("vale" as const),
    cpu: "x64" as const,
    os: os as ValePlatformRelease["os"],
    sha256: sha256(bytes),
  });
}
