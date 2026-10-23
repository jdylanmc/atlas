import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  extractValeBinary,
  tarEntries,
  zipEntries,
} from "../src/platform/vale_archive.ts";
import { fakeRelease, tar, zip } from "./vale_archive_fixtures.ts";

const encoder = new TextEncoder();

test("tar entries are read by base name, skipping non-files", () => {
  const entries = tarEntries(
    tar([
      { name: "dir/", type: "5" },
      { content: "binary", name: "vale_3/vale" },
      { content: "license", name: "LICENSE", prefix: "deep/path" },
      { name: "empty", size: "" },
      { content: "full", name: "n".repeat(100) },
    ]),
  );
  assert.deepEqual(
    [...entries].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]),
    [
      ["vale", "binary"],
      ["LICENSE", "license"],
      ["empty", ""],
      ["n".repeat(100), "full"],
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

test("release assets must match their pinned digest and carry the binary", () => {
  const archive = gzipSync(
    tar([
      { content: "bin", name: "vale" },
      { content: "MIT", name: "LICENSE" },
    ]),
  );
  const release = fakeRelease("vale_x_Linux_64-bit.tar.gz", archive);
  assert.equal(new TextDecoder().decode(extractValeBinary(release, archive)), "bin");

  assert.throws(
    () => extractValeBinary({ ...release, sha256: "0".repeat(64) }, archive),
    /has SHA-256 [0-9a-f]{64}; Atlas SDK pins 0{64}\./u,
  );

  const windows = zip([{ content: "bin", name: "readme.txt" }]);
  assert.throws(
    () =>
      extractValeBinary(
        fakeRelease("vale_x_Windows_64-bit.zip", windows, "win32"),
        windows,
      ),
    /does not contain vale\.exe\./u,
  );
});
