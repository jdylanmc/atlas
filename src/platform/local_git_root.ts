import { lstatSync, type Stats } from "node:fs";
import { dirname, resolve } from "node:path";

export function findGitRoot(
  start: string,
  readStat: (
    path: string,
    options: { readonly throwIfNoEntry: false },
  ) => Stats | undefined = lstatSync,
): string | undefined {
  let current = resolve(start);
  for (;;) {
    const gitPath = resolve(current, ".git");
    let stat: Stats | undefined;
    try {
      stat = readStat(gitPath, { throwIfNoEntry: false });
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOTDIR") {
        return undefined;
      }
      throw error;
    }
    if (stat !== undefined) return current;
    const next = dirname(current);
    if (next === current) return undefined;
    current = next;
  }
}
