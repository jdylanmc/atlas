const pageDirectories = new Set(["bonfires", "insights", "lore", "pillars", "threads"]);

export type RealmTextClassification = "page" | "opaque";

export function normalizeRealmRelativePath(path: string): string | undefined {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    return undefined;
  }
  const segments = path.split("/");
  if (segments.includes("..")) {
    return undefined;
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".");
  if (normalized.length < 2 || normalized[0] !== ".atlas") {
    return undefined;
  }
  return normalized.join("/");
}

export function classifyRealmTextPath(path: string): RealmTextClassification {
  if (path === ".atlas/index.md") {
    return "page";
  }
  if (/^\.atlas\/types\/[^/]+\/.+\.md$/u.test(path)) {
    return "page";
  }
  const match = /^\.atlas\/([^/]+)\/.+\.md$/u.exec(path);
  return match !== null && pageDirectories.has(match[1] as string) ? "page" : "opaque";
}
