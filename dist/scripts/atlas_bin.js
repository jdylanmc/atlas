#!/usr/bin/env node
/** Installed Atlas package binary wrapper. */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { main } from "./atlas.js";
export function isAtlasBinEntrypoint(moduleUrl, scriptPath) {
    if (scriptPath === undefined)
        return false;
    try {
        return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(scriptPath);
    }
    catch {
        return false;
    }
}
if (isAtlasBinEntrypoint(import.meta.url, process.argv[1])) {
    process.exitCode = main(process.argv.slice(2));
}
