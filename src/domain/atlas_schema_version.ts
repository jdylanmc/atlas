// `atlas-sdk-schema` is a permanent, load-bearing contract: every future Atlas
// SDK version must be able to read it in an Atlas written by any other
// version, so its format must not itself evolve with the schema it identifies.
// The format is fixed here as MAJOR.MINOR.PATCH, each a non-negative integer
// with no leading zero, so ordering is arithmetic rather than lexical: this is
// what lets "2.0.0" order before "10.0.0", which plain string comparison gets
// backwards. Each component is additionally capped at 15 digits, so every
// component a well-formed version can carry is strictly less than 10^15 and
// therefore stays below Number.MAX_SAFE_INTEGER (2^53 - 1); without that cap,
// two distinct component values above that threshold would collapse to the
// same double-precision number and silently order as equal.
const schemaVersionPattern =
  /^(0|[1-9][0-9]{0,14})\.(0|[1-9][0-9]{0,14})\.(0|[1-9][0-9]{0,14})$/u;

export interface AtlasSchemaVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Reports whether `value` is a well-formed `atlas-sdk-schema` version: three
 * dot-separated non-negative integers with no leading zero. A version that
 * has no defined order is not a version, so this is the one gate every reader
 * of the field shares instead of each restating its own pattern.
 */
export function checkAtlasSchemaVersion(value: unknown): value is string {
  return typeof value === "string" && schemaVersionPattern.test(value);
}

/**
 * Parses a well-formed `atlas-sdk-schema` version into its ordered numeric
 * components, or returns undefined when `value` is not well-formed. A caller
 * that already confirmed `checkAtlasSchemaVersion(value)` still receives a
 * defined result, since both share the one pattern above.
 */
export function parseAtlasSchemaVersion(value: string): AtlasSchemaVersion | undefined {
  const match = schemaVersionPattern.exec(value);
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return Object.freeze({
    major: Number.parseInt(major as string, 10),
    minor: Number.parseInt(minor as string, 10),
    patch: Number.parseInt(patch as string, 10),
  });
}

function compareComponent(left: number, right: number): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Orders two well-formed `atlas-sdk-schema` versions: negative when `left`
 * precedes `right`, positive when it follows, zero when they name the same
 * version. This is the one shared ordering every caller comparing two schema
 * versions uses rather than restating comparison per caller. It orders
 * numerically component by component — major, then minor, then patch — so
 * "2.0.0" precedes "10.0.0" though plain string comparison would place
 * "10.0.0" first, and "1.2.0" precedes "1.10.0" for the same reason one
 * position later.
 *
 * Both arguments must already be well-formed, established by
 * `checkAtlasSchemaVersion`. A malformed argument here is a defect in the
 * caller — validation belongs before ordering, not after — so this throws
 * rather than returning a value that would silently rank an unparseable
 * version as though it were comparable.
 */
export function compareAtlasSchemaVersions(left: string, right: string): -1 | 0 | 1 {
  const leftVersion = parseAtlasSchemaVersion(left);
  const rightVersion = parseAtlasSchemaVersion(right);
  if (leftVersion === undefined || rightVersion === undefined) {
    throw new RangeError(
      "compareAtlasSchemaVersions requires two well-formed atlas-sdk-schema versions; validate each with checkAtlasSchemaVersion first.",
    );
  }
  return (
    compareComponent(leftVersion.major, rightVersion.major) ||
    compareComponent(leftVersion.minor, rightVersion.minor) ||
    compareComponent(leftVersion.patch, rightVersion.patch)
  );
}
