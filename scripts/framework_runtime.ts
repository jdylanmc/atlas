#!/usr/bin/env node
/** Bundle-local runtime marker inventoried by the Framework Bundle. */

import { pathToFileURL } from "node:url";

export function runtimeEntrypoint(): string {
  return "atlas-lint";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.error("Run scripts/framework_bootstrap.ts from a Framework Bundle.");
  process.exitCode = 64;
}
