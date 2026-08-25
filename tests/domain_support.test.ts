import assert from "node:assert/strict";
import test from "node:test";

import { compareCodePoints, sha256Hex } from "../src/domain/domain_support.ts";
import { virtualAtlasViewSchemaVersion } from "../src/domain/virtual_atlas_view.ts";

test("domain support orders code points and hashes deterministically", () => {
  assert.equal(compareCodePoints("a", "aa"), -1);
  assert.equal(compareCodePoints("b", "a"), 1);
  assert.equal(sha256Hex("atlas"), sha256Hex("atlas"));
  assert.equal(virtualAtlasViewSchemaVersion, "1.0.0");
});
