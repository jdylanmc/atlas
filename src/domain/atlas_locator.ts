import { compareCodePoints } from "./domain_support.ts";
import type { Finding } from "./finding.ts";

export interface AtlasLocator {
  readonly atlasPath: string;
  readonly branch: string;
  readonly canonicalRepository: string;
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
}

export interface AtlasLocatorInput {
  readonly atlasPath: string;
  readonly branch: string;
  readonly repositoryLocator: string;
}

export type AtlasLocatorParseResult =
  | { readonly locator: AtlasLocator; readonly state: "parsed" }
  | { readonly findings: readonly Finding[]; readonly state: "invalid" };

const attribution = Object.freeze({
  checkId: "sdk-core.atlas-locator",
  kind: "sdk-core" as const,
  trusted: true as const,
});

const credentialsRejectedMessage =
  "Atlas Locator must not embed credentials or SSH user-info.";

const repositoryPathRejectedMessage =
  "Atlas Locator must name an HTTPS or SSH Git repository.";

function finding(code: string, message: string, path: string): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    message,
    path,
    severity: "error" as const,
  });
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    /* c8 ignore next -- control characters are rejected by dedicated malformed-locator cases. */
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function cleanSegment(value: string): string | undefined {
  if (value === "" || value === "." || value === "..") return undefined;
  if (value.includes("/") || value.includes("\\") || hasControlCharacter(value)) {
    return undefined;
  }
  return value;
}

function canonicalAtlasPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === ".") return ".";
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) return undefined;
  const segments = trimmed.split("/");
  const cleaned = segments.map(cleanSegment);
  if (cleaned.some((segment) => segment === undefined)) return undefined;
  return cleaned.join("/");
}

function canonicalBranch(branch: string): string | undefined {
  const trimmed = branch.trim();
  if (
    trimmed === "" ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    hasControlCharacter(trimmed) ||
    /[\\ ~^:?*]/u.test(trimmed) ||
    trimmed.includes("[")
  ) {
    return undefined;
  }
  const segments = trimmed.split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return trimmed;
}

function freezeLocator(parts: {
  readonly atlasPath: string;
  readonly branch: string;
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
}): AtlasLocator {
  return Object.freeze({
    atlasPath: parts.atlasPath,
    branch: parts.branch,
    canonicalRepository: `${parts.host}/${parts.owner}/${parts.repository}`,
    host: parts.host,
    owner: parts.owner,
    repository: parts.repository,
  });
}

function fromUrl(urlText: string):
  | {
      readonly credentials: boolean;
      readonly host?: string;
      readonly owner?: string;
      readonly repository?: string;
    }
  | undefined {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "ssh:") return undefined;
  if (url.username !== "" || url.password !== "") {
    return Object.freeze({ credentials: true as const });
  }
  const segments = url.pathname
    .replace(/\.git$/u, "")
    .replace(/^\/+|\/+$/gu, "")
    .split("/");
  if (segments.length !== 2) return undefined;
  const [owner, repository] = segments as [string, string];
  const cleanedOwner = cleanSegment(owner);
  const cleanedRepository = cleanSegment(repository);
  /* c8 ignore next -- invalid repository segments are rejected by explicit malformed-locator tests. */
  if (cleanedOwner === undefined || cleanedRepository === undefined) return undefined;
  return Object.freeze({
    credentials: false as const,
    host: url.host.toLowerCase(),
    owner: cleanedOwner,
    repository: cleanedRepository,
  });
}

function fromScp(urlText: string):
  | {
      readonly credentials: boolean;
      readonly host?: string;
      readonly owner?: string;
      readonly repository?: string;
    }
  | undefined {
  const match = /^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+)$/u.exec(urlText);
  if (match === null) return undefined;
  const user = match.groups?.["user"] as string;
  const host = match.groups?.["host"] as string;
  const path = match.groups?.["path"] as string;
  if (user !== "git") {
    return Object.freeze({ credentials: true as const });
  }
  const segments = path
    .replace(/\.git$/u, "")
    .replace(/^\/+|\/+$/gu, "")
    .split("/");
  if (segments.length !== 2) return undefined;
  const [owner, repository] = segments as [string, string];
  const cleanedOwner = cleanSegment(owner);
  const cleanedRepository = cleanSegment(repository);
  if (cleanedOwner === undefined || cleanedRepository === undefined) return undefined;
  return Object.freeze({
    credentials: false as const,
    host: host.toLowerCase(),
    owner: cleanedOwner,
    repository: cleanedRepository,
  });
}

function repositoryParts(locator: string):
  | {
      readonly credentials: boolean;
      readonly host?: string;
      readonly owner?: string;
      readonly repository?: string;
    }
  | undefined {
  return fromUrl(locator) ?? fromScp(locator);
}

export function atlasLocatorCredentialMessage(): string {
  return credentialsRejectedMessage;
}

export function atlasLocatorFromParts(parts: {
  readonly atlasPath: string;
  readonly branch: string;
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
}): AtlasLocator {
  return freezeLocator({
    atlasPath: canonicalAtlasPath(parts.atlasPath) ?? ".",
    branch: canonicalBranch(parts.branch) ?? parts.branch,
    host: parts.host.toLowerCase(),
    owner: parts.owner,
    repository: parts.repository,
  });
}

export function parseAtlasLocator(
  input: AtlasLocatorInput,
  path = ".atlas",
): AtlasLocatorParseResult {
  const branch = canonicalBranch(input.branch);
  const atlasPath = canonicalAtlasPath(input.atlasPath);
  const repository = repositoryParts(input.repositoryLocator);
  const findings: Finding[] = [];
  if (branch === undefined || atlasPath === undefined) {
    findings.push(
      finding(
        "ATLAS_INGEST_SOURCE_MARKER_INVALID",
        "Atlas Locator must carry a canonical branch and Atlas-relative path.",
        path,
      ),
    );
  }
  if (repository?.credentials === true) {
    findings.push(
      finding("ATLAS_LOCATOR_CREDENTIALS_REJECTED", credentialsRejectedMessage, path),
    );
  } else if (repository === undefined) {
    findings.push(
      finding(
        "ATLAS_INGEST_SOURCE_MARKER_INVALID",
        repositoryPathRejectedMessage,
        path,
      ),
    );
  }
  if (findings.length > 0) {
    return Object.freeze({
      findings: Object.freeze(
        findings.toSorted((left, right) => compareCodePoints(left.code, right.code)),
      ),
      state: "invalid" as const,
    });
  }
  const normalizedRepository = repository as {
    readonly credentials: false;
    readonly host: string;
    readonly owner: string;
    readonly repository: string;
  };
  return Object.freeze({
    locator: freezeLocator({
      atlasPath: atlasPath as string,
      branch: branch as string,
      host: normalizedRepository.host,
      owner: normalizedRepository.owner,
      repository: normalizedRepository.repository,
    }),
    state: "parsed" as const,
  });
}
