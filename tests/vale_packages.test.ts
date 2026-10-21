import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import {
  extractValeRelease,
  hostRelease,
  installHostPackage,
  main,
  packPlatformPackages,
  platformPackageManifest,
  sha256,
  tarEntries,
  zipEntries,
} from "../scripts/vale_packages.ts";
import {
  valePlatformRelease,
  valeVersion,
  type ValePlatformRelease,
} from "../src/platform/vale_release.ts";

const encoder = new TextEncoder();

interface TarEntry {
  readonly content?: string;
  readonly name: string;
  readonly prefix?: string;
  readonly size?: string;
  readonly type?: string;
}

function tar(entries: readonly TarEntry[], trailer = true): Uint8Array {
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

interface ZipEntry {
  readonly content: string;
  readonly method?: number;
  readonly name: string;
}

function zip(
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

function fakeRelease(
  asset: string,
  bytes: Uint8Array,
  os = "linux",
): ValePlatformRelease {
  return Object.freeze({
    asset,
    binary: os === "win32" ? ("vale.exe" as const) : ("vale" as const),
    cpu: "x64" as const,
    os: os as ValePlatformRelease["os"],
    packageName: `@jdylanmc/atlas-vale-${os}-x64`,
    sha256: sha256(bytes),
  });
}

const fakeBinary = `#!/bin/sh\necho "vale version ${valeVersion}"\n`;

test("tar entries are read by base name, skipping non-files", () => {
  const entries = tarEntries(
    tar([
      { name: "dir/", type: "5" },
      { content: "binary", name: "vale_3/vale" },
      { content: "license", name: "LICENSE", prefix: "deep/path" },
      { name: "empty", size: "" },
    ]),
  );
  assert.deepEqual(
    [...entries].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]),
    [
      ["vale", "binary"],
      ["LICENSE", "license"],
      ["empty", ""],
    ],
  );
  assert.equal(tarEntries(tar([{ content: "x", name: "a" }], false)).size, 1);
});

test("malformed or truncated tar archives are refused", () => {
  assert.throws(
    () => tarEntries(tar([{ name: "a", size: "zz" }])),
    /malformed tar header/u,
  );
  const truncated = tar([{ content: "x".repeat(600), name: "a" }]).subarray(0, 700);
  assert.throws(() => tarEntries(truncated), /truncated/u);
});

test("zip entries are read by base name from stored and deflated data", () => {
  const entries = zipEntries(
    zip([
      { content: "", name: "vale/" },
      { content: "binary", name: "vale/vale.exe" },
      { content: "license text", method: 8, name: "LICENSE" },
    ]),
  );
  assert.deepEqual(
    [...entries].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]),
    [
      ["vale.exe", "binary"],
      ["LICENSE", "license text"],
    ],
  );
});

test("malformed or unsupported zip archives are refused", () => {
  assert.throws(
    () => zipEntries(encoder.encode("no zip here at all, sorry")),
    /not a ZIP/u,
  );
  assert.throws(
    () => zipEntries(zip([{ content: "x", name: "a" }], 0x12345678)),
    /malformed ZIP directory/u,
  );
  assert.throws(
    () => zipEntries(zip([{ content: "x", method: 12, name: "a" }])),
    /unsupported ZIP compression/u,
  );
});

test("release assets must match their pinned digest and carry binary and license", () => {
  const archive = gzipSync(
    tar([
      { content: "bin", name: "vale" },
      { content: "MIT", name: "LICENSE" },
    ]),
  );
  const release = fakeRelease("vale_x_Linux_64-bit.tar.gz", archive);
  const extracted = extractValeRelease(release, archive);
  assert.equal(new TextDecoder().decode(extracted.binary), "bin");
  assert.equal(new TextDecoder().decode(extracted.license), "MIT");

  assert.throws(
    () => extractValeRelease({ ...release, sha256: "0".repeat(64) }, archive),
    /has SHA-256 [0-9a-f]{64}; Atlas SDK pins 0{64}\./u,
  );

  const windows = zip([{ content: "bin", name: "vale.exe" }]);
  assert.throws(
    () =>
      extractValeRelease(
        fakeRelease("vale_x_Windows_64-bit.zip", windows, "win32"),
        windows,
      ),
    /does not contain vale\.exe and LICENSE/u,
  );
});

test("platform package manifests pin the platform and ship only the binary", () => {
  const release = valePlatformRelease("win32", "arm64") as ValePlatformRelease;
  assert.deepEqual(JSON.parse(platformPackageManifest(release)), {
    cpu: ["arm64"],
    description: `Vale ${valeVersion} prose linter binary for Atlas SDK on win32-arm64.`,
    files: ["bin/vale.exe", "LICENSE", "README.md"],
    license: "MIT",
    name: "@jdylanmc/atlas-vale-win32-arm64",
    os: ["win32"],
    publishConfig: { access: "public" },
    repository: { type: "git", url: "git+https://github.com/jdylanmc/atlas.git" },
    version: valeVersion,
  });
});

test("the host release is the pinned release for this platform", () => {
  assert.equal(hostRelease("darwin", "arm64"), valePlatformRelease("darwin", "arm64"));
  assert.equal(hostRelease(), valePlatformRelease(process.platform, process.arch));
  assert.throws(
    () => hostRelease("aix", "ppc64"),
    /does not bundle Vale for aix-ppc64/u,
  );
});

test("installing the host package writes it once into node_modules", async (t) => {
  if (process.platform === "win32") {
    t.skip("the fake Vale binary is a POSIX shell script");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "atlas-vale-install-"));
  const archive = gzipSync(
    tar([
      { content: fakeBinary, name: "vale" },
      { content: "MIT", name: "LICENSE" },
    ]),
  );
  const release = fakeRelease("vale_x_Linux_64-bit.tar.gz", archive);
  const downloads: string[] = [];
  const download = (url: string) => {
    downloads.push(url);
    return Promise.resolve(archive);
  };
  assert.equal(
    await installHostPackage(root, release, download),
    `installed ${release.packageName}@${valeVersion}`,
  );
  const directory = join(root, "node_modules", "@jdylanmc", "atlas-vale-linux-x64");
  assert.equal(readFileSync(join(directory, "LICENSE"), "utf8"), "MIT");
  assert.equal(statSync(join(directory, "bin", "vale")).mode & 0o111, 0o111);
  assert.equal(
    (
      JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        name: string;
      }
    ).name,
    release.packageName,
  );
  assert.match(
    readFileSync(join(directory, "README.md"), "utf8"),
    /repackaged\nunmodified/u,
  );
  assert.equal(
    await installHostPackage(root, release, download),
    `${release.packageName}@${valeVersion} already installed`,
  );
  assert.deepEqual(downloads, [
    `https://github.com/vale-cli/vale/releases/download/v${valeVersion}/vale_x_Linux_64-bit.tar.gz`,
  ]);
});

test("packing stages every platform package and cleans its staging area", async () => {
  const out = mkdtempSync(join(tmpdir(), "atlas-vale-out-"));
  const archive = gzipSync(
    tar([
      { content: "bin", name: "vale" },
      { content: "MIT", name: "LICENSE" },
    ]),
  );
  const release = fakeRelease("vale_x_Linux_64-bit.tar.gz", archive);
  const staged: string[] = [];
  const packed = await packPlatformPackages(
    out,
    [release],
    () => Promise.resolve(archive),
    (directory, destination) => {
      assert.equal(destination, out);
      assert.ok(existsSync(join(directory, "bin", "vale")));
      staged.push(directory);
      return "atlas-vale-linux-x64-3.24.0.tgz";
    },
  );
  assert.deepEqual(packed, ["atlas-vale-linux-x64-3.24.0.tgz"]);
  assert.equal(staged.length, 1);
  assert.equal(existsSync(staged[0] as string), false);
});

test("the command installs, packs, and reports failures and usage", async () => {
  const log = mock.method(console, "log", () => undefined);
  const error = mock.method(console, "error", () => undefined);
  try {
    assert.equal(
      await main(["install"], (root) => Promise.resolve(`installed into ${root}`)),
      0,
    );
    assert.equal(
      await main(["pack", "--out", "dist/x"], undefined, (out) =>
        Promise.resolve([`${out}/a.tgz`, `${out}/b.tgz`]),
      ),
      0,
    );
    assert.equal(
      await main(["install"], () => Promise.reject(new Error("offline"))),
      1,
    );
    assert.equal(await main(["pack"]), 2);
    assert.match(String(log.mock.calls[0]?.arguments[0]), /^installed into /u);
    assert.deepEqual(
      log.mock.calls.slice(1).map((call) => call.arguments[0] as unknown),
      ["dist/x/a.tgz", "dist/x/b.tgz"],
    );
    assert.deepEqual(
      error.mock.calls.map((call) => call.arguments[0] as unknown),
      ["error: offline", "usage: vale_packages.ts install | pack --out DIR"],
    );
  } finally {
    log.mock.restore();
    error.mock.restore();
  }
});
