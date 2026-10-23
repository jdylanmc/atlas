#!/usr/bin/env node
/** Prepares the pinned Vale binary in the machine cache, as the first Lint would. */

import { resolveValeBinary } from "../src/platform/vale_prose_linter.ts";

const resolution = resolveValeBinary();
if (resolution.state === "resolved") {
  console.log(`Vale ready at ${resolution.path}`);
} else {
  console.error(`error: ${resolution.reason}`);
  process.exitCode = 1;
}
