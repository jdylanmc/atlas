import assert from "node:assert/strict";
import test from "node:test";
import {
  checkAtlasSchemaVersion,
  compareAtlasSchemaVersions,
  parseAtlasSchemaVersion,
} from "../src/domain/atlas_schema_version.ts";

test("accepts well-formed MAJOR.MINOR.PATCH schema versions", () => {
  for (const value of ["0.0.0", "1.0.0", "10.2.33", "123.456.789"]) {
    assert.equal(checkAtlasSchemaVersion(value), true, value);
    assert.deepEqual(
      parseAtlasSchemaVersion(value),
      Object.fromEntries(
        ["major", "minor", "patch"].map((key, index) => [
          key,
          Number.parseInt((value.split(".") as readonly string[])[index] as string, 10),
        ]),
      ),
      value,
    );
  }
});

test("rejects malformed schema versions, including non-string values", () => {
  for (const value of [
    "banana",
    "",
    "1.0",
    "1.0.0.0",
    "01.0.0",
    "1.00.0",
    "1.0.00",
    "-1.0.0",
    "1.-1.0",
    "1.0.-1",
    "v1.0.0",
    "1.0.0-beta",
    "1.0.0+build",
    " 1.0.0",
    "1.0.0 ",
    "1..0",
    // A component past 15 digits is refused outright rather than accepted and
    // silently rounded once it exceeds Number.MAX_SAFE_INTEGER.
    "1234567890123456.0.0",
    undefined,
    null,
    123,
    {},
    ["1.0.0"],
  ]) {
    assert.equal(checkAtlasSchemaVersion(value), false, JSON.stringify(value));
  }
  for (const value of ["banana", "1.0", "01.0.0"]) {
    assert.equal(parseAtlasSchemaVersion(value), undefined, value);
  }
});

test("accepts a 15-digit component and keeps it exactly comparable", () => {
  const maxComponent = "9".repeat(15);
  assert.equal(checkAtlasSchemaVersion(`${maxComponent}.0.0`), true);
  assert.equal(
    parseAtlasSchemaVersion(`${maxComponent}.0.0`)?.major,
    Number.parseInt(maxComponent, 10),
  );
  assert.ok(Number.parseInt(maxComponent, 10) <= Number.MAX_SAFE_INTEGER);
  // Two distinct 15-digit majors one apart must not collapse to the same
  // double-precision number, which is exactly the defect the digit cap closes.
  assert.equal(
    compareAtlasSchemaVersions(`${maxComponent}.0.0`, `${"9".repeat(14)}8.0.0`),
    1,
  );
});

test("orders schema versions numerically at each position, not lexically", () => {
  const cases: readonly [string, string, -1 | 0 | 1][] = [
    ["1.0.0", "1.0.0", 0],
    ["1.0.0", "2.0.0", -1],
    ["2.0.0", "1.0.0", 1],
    ["2.0.0", "10.0.0", -1],
    ["10.0.0", "2.0.0", 1],
    ["1.2.0", "1.10.0", -1],
    ["1.10.0", "1.2.0", 1],
    ["1.0.2", "1.0.10", -1],
    ["1.0.10", "1.0.2", 1],
    ["0.0.0", "0.0.1", -1],
  ];
  for (const [left, right, expected] of cases) {
    assert.equal(
      compareAtlasSchemaVersions(left, right),
      expected,
      `${left} vs ${right}`,
    );
  }
});

test("refuses to order a malformed schema version", () => {
  assert.throws(() => compareAtlasSchemaVersions("banana", "1.0.0"), RangeError);
  assert.throws(() => compareAtlasSchemaVersions("1.0.0", "banana"), RangeError);
  assert.throws(() => compareAtlasSchemaVersions("banana", "also-banana"), RangeError);
});
