import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { lexicalSearchProvider } from "../graph/lexical_search_provider.ts";
import type {
  ExploreCandidate,
  ExploreSearchDocument,
  SearchProvider,
  SearchProviderDiagnostic,
  SearchProviderRanking,
} from "../graph/search_provider.ts";

const packageName = "@tobilu/qmd";
const packageVersion = "2.8.3";
const packageUnpackedBytes = 914_522;
const modelDownloadBytes = 2_040_000_000 as const;
const indexOwnershipMarker = "atlas-qmd-index-owned";
const runtimeOwnershipMarker = "atlas-qmd-tool-runtime-owned";
const supportedTargets = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
] as const);

export const atlasQmdRelease = Object.freeze({
  extensionName: "atlas-qmd",
  modelDownloadBytes,
  nodeRange: ">=22.0.0",
  packageName,
  packageUnpackedBytes,
  packageVersion,
  supportedTargets,
});

export interface AtlasQmdApproval {
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly proposalDigest: string;
}

export interface AtlasQmdInstallProposal {
  readonly action: {
    readonly arguments: readonly string[];
    readonly executable: "npm";
  };
  readonly digest: string;
  readonly kind: "tool-runtime-install";
  readonly location: string;
  readonly package: {
    readonly dependencySizeNote: string;
    readonly name: typeof packageName;
    readonly unpackedBytes: typeof packageUnpackedBytes;
    readonly version: typeof packageVersion;
  };
  readonly reason: string;
}

export interface AtlasQmdModelProposal {
  readonly digest: string;
  readonly downloadBytes: typeof modelDownloadBytes;
  readonly kind: "semantic-model-download";
  readonly location: string;
  readonly models: readonly [
    "embeddinggemma-300M-Q8_0",
    "qwen3-reranker-0.6b-q8_0",
    "qmd-query-expansion-1.7B-q4_k_m",
  ];
}

export interface AtlasQmdRuntimeContext {
  readonly architecture: string;
  readonly atlasHostDirectory: string;
  readonly atlasVersion: string;
  readonly platform: NodeJS.Platform;
  readonly toolRuntimeRoot: string;
}

export interface AtlasQmdRuntimeInspection {
  readonly reason?: string;
  readonly state: "corrupt" | "missing" | "ready";
}

export interface AtlasQmdRankRequest extends AtlasQmdRuntimeContext {
  readonly documents: readonly ExploreSearchDocument[];
  readonly mode: "lexical" | "semantic";
  readonly query: string;
}

export interface AtlasQmdRuntime {
  readonly inspectToolRuntime: (
    context: AtlasQmdRuntimeContext,
  ) => AtlasQmdRuntimeInspection;
  readonly installToolRuntime: (
    proposal: AtlasQmdInstallProposal,
    context: AtlasQmdRuntimeContext,
  ) => void;
  readonly rank: (request: AtlasQmdRankRequest) => readonly ExploreCandidate[];
}

export interface AtlasQmdOptions {
  readonly architecture?: string;
  readonly atlasHostDirectory: string;
  readonly atlasVersion: string;
  readonly installationApproval?: AtlasQmdApproval;
  readonly modelApproval?: AtlasQmdApproval;
  readonly platform?: NodeJS.Platform;
  readonly semantic?: boolean;
  readonly toolRuntimeRoot?: string;
}

export interface AtlasQmdPreparation {
  readonly capability:
    | {
        readonly state: "supported";
        readonly target: string;
      }
    | {
        readonly reason: string;
        readonly state: "unsupported";
        readonly target: string;
      };
  readonly installationProposal?: AtlasQmdInstallProposal;
  readonly mode: "lexical-fallback" | "qmd-lexical" | "qmd-semantic";
  readonly modelProposal?: AtlasQmdModelProposal;
  readonly provider: SearchProvider;
}

interface RuntimeReceipt {
  readonly architecture: string;
  readonly nodeExecutable: string;
  readonly nodeMajor: number;
  readonly packageName: typeof packageName;
  readonly packageVersion: typeof packageVersion;
  readonly platform: NodeJS.Platform;
  readonly schema: "1.0.0";
}

interface IndexManifest {
  readonly atlasHostDirectory: string;
  readonly atlasVersion: string;
  readonly documentDigest: string;
  readonly documents: Readonly<Record<string, string>>;
  readonly packageVersion: typeof packageVersion;
  readonly schema: "1.0.0";
}

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

interface LocalRuntimeOptions {
  readonly indexRoot?: string;
  readonly npmExecutable?: string;
  readonly run?: (
    executable: string,
    arguments_: readonly string[],
    options: {
      readonly cwd?: string;
      readonly env: NodeJS.ProcessEnv;
    },
  ) => CommandResult;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return String(error).replace(/^[A-Za-z]*Error: /u, "");
}

function defaultCacheDirectory(): string {
  return process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
}

function defaultToolRuntimeRoot(
  platform: NodeJS.Platform,
  architecture: string,
): string {
  return join(
    defaultCacheDirectory(),
    "atlas",
    "tool-runtimes",
    "qmd",
    packageVersion,
    `${platform}-${architecture}`,
  );
}

function proposalDigest(value: object): string {
  return sha256(JSON.stringify(value));
}

function installationProposal(
  context: AtlasQmdRuntimeContext,
  reason: string,
): AtlasQmdInstallProposal {
  const action = Object.freeze({
    arguments: Object.freeze([
      "install",
      "--prefix",
      context.toolRuntimeRoot,
      "--ignore-scripts=false",
      "--no-save",
      "--package-lock=false",
      `${packageName}@${packageVersion}`,
    ]),
    executable: "npm" as const,
  });
  const content = {
    action,
    kind: "tool-runtime-install" as const,
    location: context.toolRuntimeRoot,
    package: Object.freeze({
      dependencySizeNote:
        "914522 bytes is the published package's unpacked payload; transitive native dependencies require additional package-manager-reported space.",
      name: packageName,
      unpackedBytes: packageUnpackedBytes,
      version: packageVersion,
    }),
    reason,
  };
  return Object.freeze({ ...content, digest: proposalDigest(content) });
}

function modelProposal(context: AtlasQmdRuntimeContext): AtlasQmdModelProposal {
  const content = {
    downloadBytes: modelDownloadBytes,
    kind: "semantic-model-download" as const,
    location: join(context.toolRuntimeRoot, "cache", "qmd", "models"),
    models: Object.freeze([
      "embeddinggemma-300M-Q8_0",
      "qwen3-reranker-0.6b-q8_0",
      "qmd-query-expansion-1.7B-q4_k_m",
    ] as const),
  };
  return Object.freeze({ ...content, digest: proposalDigest(content) });
}

function approvalMatches(
  approval: AtlasQmdApproval | undefined,
  digest: string,
): boolean {
  return (
    approval !== undefined &&
    approval.proposalDigest === digest &&
    approval.approvedBy.trim() !== "" &&
    Number.isFinite(Date.parse(approval.approvedAt))
  );
}

function fallbackProvider(code: string, message: string): SearchProvider {
  const notice: SearchProviderDiagnostic = Object.freeze({
    code,
    message,
    severity: "warning",
  });
  return Object.freeze({
    rank(
      documents: readonly ExploreSearchDocument[],
      query: string,
      budgets: {
        readonly maxQueryCharacters: number;
        readonly maxTerms: number;
      },
    ): SearchProviderRanking {
      return Object.freeze({
        candidates: lexicalSearchProvider.rank(documents, query, budgets),
        diagnostics: Object.freeze([notice]),
      });
    },
  });
}

function qmdProvider(
  context: AtlasQmdRuntimeContext,
  runtime: AtlasQmdRuntime,
  mode: "lexical" | "semantic",
  notice?: SearchProviderDiagnostic,
): SearchProvider {
  return Object.freeze({
    rank(
      documents: readonly ExploreSearchDocument[],
      query: string,
      budgets: {
        readonly maxQueryCharacters: number;
        readonly maxTerms: number;
      },
    ): SearchProviderRanking {
      try {
        return Object.freeze({
          candidates: runtime.rank({ ...context, documents, mode, query }),
          ...(notice === undefined ? {} : { diagnostics: Object.freeze([notice]) }),
        });
      } catch (error) {
        return Object.freeze({
          candidates: lexicalSearchProvider.rank(documents, query, budgets),
          diagnostics: Object.freeze([
            Object.freeze({
              code: "ATLAS_QMD_RUNTIME_FALLBACK",
              message: `atlas-qmd failed; built-in lexical ranking was used: ${errorMessage(error)}`,
              severity: "warning" as const,
            }),
          ]),
        });
      }
    },
  });
}

function runCommand(
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env: NodeJS.ProcessEnv;
  },
): CommandResult {
  const result = spawnSync(executable, arguments_, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    encoding: "utf8",
    env: options.env,
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runtimePaths(root: string): {
  readonly bin: string;
  readonly ownership: string;
  readonly packageManifest: string;
  readonly receipt: string;
} {
  const packageRoot = join(root, "node_modules", "@tobilu", "qmd");
  return {
    bin: join(packageRoot, "bin", "qmd"),
    ownership: join(root, ".atlas-qmd-owned"),
    packageManifest: join(packageRoot, "package.json"),
    receipt: join(root, "atlas-qmd-runtime.json"),
  };
}

function isRuntimeReceipt(
  value: unknown,
  context: AtlasQmdRuntimeContext,
): value is RuntimeReceipt {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<RuntimeReceipt>;
  return (
    candidate.schema === "1.0.0" &&
    candidate.packageName === packageName &&
    candidate.packageVersion === packageVersion &&
    candidate.platform === context.platform &&
    candidate.architecture === context.architecture &&
    typeof candidate.nodeExecutable === "string" &&
    candidate.nodeExecutable !== "" &&
    typeof candidate.nodeMajor === "number" &&
    candidate.nodeMajor >= 22
  );
}

function assertSafeOwnedDirectory(
  path: string,
  markerPath: string,
  expectedMarker: string,
): void {
  const resolvedPath = resolve(path);
  if (resolvedPath === resolve("/") || resolvedPath === resolve(homedir())) {
    throw new Error(`Refusing unsafe atlas-qmd managed directory: ${resolvedPath}`);
  }
  if (!existsSync(resolvedPath) || readdirSync(resolvedPath).length === 0) return;
  let marker: string;
  try {
    marker = readFileSync(markerPath, "utf8");
  } catch {
    throw new Error(`Refusing to replace unowned atlas-qmd state at ${resolvedPath}.`);
  }
  if (marker !== `${expectedMarker}\n`) {
    throw new Error(`Refusing to replace unowned atlas-qmd state at ${resolvedPath}.`);
  }
}

function documentProjection(document: ExploreSearchDocument): string {
  return [
    `# ${document.title}`,
    "",
    `Atlas object: ${document.id}`,
    `Atlas type: ${document.type}`,
    `Atlas path: ${document.path}`,
    `Tags: ${document.tags.join(", ")}`,
    "",
    document.body,
    "",
  ].join("\n");
}

function documentDigest(documents: readonly ExploreSearchDocument[]): string {
  return sha256(
    JSON.stringify(
      documents.map((document) => ({
        body: document.body,
        id: document.id,
        path: document.path,
        tags: [...document.tags],
        title: document.title,
        type: document.type,
      })),
    ),
  );
}

function documentMapping(
  documents: readonly ExploreSearchDocument[],
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      documents.map((document, index) => [
        `${String(index).padStart(6, "0")}.md`,
        document.id,
      ]),
    ),
  );
}

function documentMappingMatches(
  value: unknown,
  expected: Readonly<Record<string, string>>,
): value is Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  const expectedEntries = Object.entries(expected);
  const candidateKeys = Object.keys(candidate);
  return (
    candidateKeys.length === expectedEntries.length &&
    expectedEntries.every(([filename, objectId]) => candidate[filename] === objectId)
  );
}

function commandFailure(command: string, result: CommandResult): Error {
  const detail = result.stderr.trim() || result.stdout.trim() || "no diagnostic output";
  return new Error(`${command} exited ${String(result.status)}: ${detail}`);
}

export function createLocalAtlasQmdRuntime(
  options: LocalRuntimeOptions = {},
): AtlasQmdRuntime {
  const execute = options.run ?? runCommand;
  const indexRoot =
    options.indexRoot ??
    join(defaultCacheDirectory(), "atlas", "explore-indexes", "qmd");
  const npmExecutable = options.npmExecutable ?? "npm";

  function inspectToolRuntime(
    context: AtlasQmdRuntimeContext,
  ): AtlasQmdRuntimeInspection {
    const paths = runtimePaths(context.toolRuntimeRoot);
    if (
      !existsSync(paths.ownership) &&
      !existsSync(paths.receipt) &&
      !existsSync(paths.packageManifest) &&
      !existsSync(paths.bin)
    ) {
      return Object.freeze({ state: "missing" as const });
    }
    try {
      if (readFileSync(paths.ownership, "utf8") !== `${runtimeOwnershipMarker}\n`) {
        return Object.freeze({
          reason: "The configured Tool Runtime location is not owned by atlas-qmd.",
          state: "corrupt" as const,
        });
      }
      const receipt = readJson(paths.receipt);
      const manifest = readJson(paths.packageManifest) as {
        readonly name?: unknown;
        readonly version?: unknown;
      };
      if (
        !isRuntimeReceipt(receipt, context) ||
        manifest.name !== packageName ||
        manifest.version !== packageVersion ||
        !existsSync(paths.bin) ||
        !existsSync(receipt.nodeExecutable)
      ) {
        return Object.freeze({
          reason: "The owned atlas-qmd Tool Runtime is incomplete or incompatible.",
          state: "corrupt" as const,
        });
      }
      const version = execute(receipt.nodeExecutable, [paths.bin, "--version"], {
        cwd: context.toolRuntimeRoot,
        env: {
          ...process.env,
          NO_COLOR: "1",
          XDG_CACHE_HOME: join(context.toolRuntimeRoot, "cache"),
        },
      });
      if (
        version.status !== 0 ||
        !version.stdout.trim().startsWith(`qmd ${packageVersion}`)
      ) {
        return Object.freeze({
          reason: "The owned atlas-qmd Tool Runtime failed its version health check.",
          state: "corrupt" as const,
        });
      }
      return Object.freeze({ state: "ready" as const });
    } catch (error) {
      return Object.freeze({
        reason: `The owned atlas-qmd Tool Runtime metadata is unreadable: ${errorMessage(error)}`,
        state: "corrupt" as const,
      });
    }
  }

  function installToolRuntime(
    proposal: AtlasQmdInstallProposal,
    context: AtlasQmdRuntimeContext,
  ): void {
    const paths = runtimePaths(context.toolRuntimeRoot);
    assertSafeOwnedDirectory(
      context.toolRuntimeRoot,
      paths.ownership,
      runtimeOwnershipMarker,
    );
    rmSync(context.toolRuntimeRoot, { force: true, recursive: true });
    mkdirSync(context.toolRuntimeRoot, { recursive: true });
    writeFileSync(paths.ownership, `${runtimeOwnershipMarker}\n`, "utf8");
    const result = execute(npmExecutable, proposal.action.arguments, {
      env: { ...process.env },
    });
    if (result.status !== 0) {
      rmSync(context.toolRuntimeRoot, { force: true, recursive: true });
      throw commandFailure("atlas-qmd Tool Runtime installation", result);
    }
    if (!existsSync(paths.packageManifest) || !existsSync(paths.bin)) {
      rmSync(context.toolRuntimeRoot, { force: true, recursive: true });
      throw new Error("atlas-qmd Tool Runtime installation did not produce QMD.");
    }
    const receipt: RuntimeReceipt = Object.freeze({
      architecture: context.architecture,
      nodeExecutable: process.execPath,
      nodeMajor: Number.parseInt(process.versions.node, 10),
      packageName,
      packageVersion,
      platform: context.platform,
      schema: "1.0.0",
    });
    writeFileSync(paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  }

  function qmd(
    context: AtlasQmdRuntimeContext,
    cwd: string,
    arguments_: readonly [string, ...string[]],
  ): CommandResult {
    const paths = runtimePaths(context.toolRuntimeRoot);
    const receipt = readJson(paths.receipt);
    if (!isRuntimeReceipt(receipt, context)) {
      throw new Error("atlas-qmd Tool Runtime receipt is incompatible.");
    }
    const result = execute(receipt.nodeExecutable, [paths.bin, ...arguments_], {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
        XDG_CACHE_HOME: join(context.toolRuntimeRoot, "cache"),
      },
    });
    if (result.status !== 0) throw commandFailure(`qmd ${arguments_[0]}`, result);
    return result;
  }

  function ensureIndex(
    request: AtlasQmdRankRequest,
    forceRebuild = false,
  ): {
    readonly directory: string;
    readonly manifest: IndexManifest;
  } {
    const hostKey = sha256(resolve(request.atlasHostDirectory)).slice(0, 24);
    const versionKey = sha256(request.atlasVersion).slice(0, 24);
    const directory = join(indexRoot, hostKey, versionKey);
    const manifestPath = join(directory, "atlas-qmd-index.json");
    const ownershipPath = join(directory, ".atlas-qmd-owned");
    const desiredDigest = documentDigest(request.documents);
    const desiredMapping = documentMapping(request.documents);
    if (!forceRebuild) {
      try {
        const existing = readJson(manifestPath) as Partial<IndexManifest>;
        if (
          existing.schema === "1.0.0" &&
          existing.packageVersion === packageVersion &&
          existing.atlasHostDirectory === resolve(request.atlasHostDirectory) &&
          existing.atlasVersion === request.atlasVersion &&
          existing.documentDigest === desiredDigest &&
          documentMappingMatches(existing.documents, desiredMapping) &&
          existsSync(join(directory, ".qmd", "index.sqlite"))
        ) {
          return { directory, manifest: existing as IndexManifest };
        }
      } catch {
        // Missing or corrupt owned index state is rebuilt below.
      }
    }

    assertSafeOwnedDirectory(directory, ownershipPath, indexOwnershipMarker);
    rmSync(directory, { force: true, recursive: true });
    const documentsDirectory = join(directory, "documents");
    mkdirSync(documentsDirectory, { recursive: true });
    writeFileSync(ownershipPath, `${indexOwnershipMarker}\n`, "utf8");
    request.documents.forEach((document, index) => {
      const filename = `${String(index).padStart(6, "0")}.md`;
      writeFileSync(
        join(documentsDirectory, filename),
        documentProjection(document),
        "utf8",
      );
    });
    qmd(request, directory, ["init"]);
    qmd(request, directory, [
      "collection",
      "add",
      documentsDirectory,
      "--name",
      "atlas",
      "--mask",
      "*.md",
    ]);
    qmd(request, directory, ["update"]);
    const manifest: IndexManifest = Object.freeze({
      atlasHostDirectory: resolve(request.atlasHostDirectory),
      atlasVersion: request.atlasVersion,
      documentDigest: desiredDigest,
      documents: desiredMapping,
      packageVersion,
      schema: "1.0.0",
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { directory, manifest };
  }

  function rankIndexed(
    request: AtlasQmdRankRequest,
    indexed: ReturnType<typeof ensureIndex>,
  ): readonly ExploreCandidate[] {
    if (request.mode === "semantic") {
      qmd(request, indexed.directory, ["pull"]);
      qmd(request, indexed.directory, ["embed", "-c", "atlas"]);
    }
    const result = qmd(request, indexed.directory, [
      request.mode === "semantic" ? "query" : "search",
      "--format",
      "json",
      "-n",
      String(request.documents.length),
      "-c",
      "atlas",
      "--",
      request.query,
    ]);
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) throw new Error("QMD returned non-array JSON.");
    const candidates: ExploreCandidate[] = [];
    for (const row of parsed) {
      if (row === null || typeof row !== "object") continue;
      const candidate = row as { readonly file?: unknown; readonly score?: unknown };
      if (typeof candidate.file !== "string" || typeof candidate.score !== "number") {
        continue;
      }
      const objectId = indexed.manifest.documents[basename(candidate.file)];
      if (objectId === undefined || !Number.isFinite(candidate.score)) continue;
      candidates.push(Object.freeze({ objectId, score: candidate.score }));
    }
    return Object.freeze(candidates);
  }

  function isOwnedIndexCorruption(error: unknown): boolean {
    const message = errorMessage(error).toLowerCase();
    return [
      "database disk image is malformed",
      "file is not a database",
      "malformed database schema",
      "no such table",
      "sqlite_corrupt",
      "sqlite_notadb",
    ].some((signature) => message.includes(signature));
  }

  function rank(request: AtlasQmdRankRequest): readonly ExploreCandidate[] {
    const indexed = ensureIndex(request);
    try {
      return rankIndexed(request, indexed);
    } catch (error) {
      if (!isOwnedIndexCorruption(error)) throw error;
      return rankIndexed(request, ensureIndex(request, true));
    }
  }

  return Object.freeze({ inspectToolRuntime, installToolRuntime, rank });
}

export function prepareAtlasQmd(
  options: AtlasQmdOptions,
  runtime?: AtlasQmdRuntime,
): AtlasQmdPreparation {
  if (options.atlasHostDirectory.trim() === "") {
    throw new TypeError("atlas-qmd requires an Atlas Host Directory.");
  }
  if (options.atlasVersion.trim() === "") {
    throw new TypeError("atlas-qmd requires an exact resolved Atlas version.");
  }
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const target = `${platform}-${architecture}`;
  if (!(supportedTargets as readonly string[]).includes(target)) {
    const reason = `atlas-qmd does not support ${target}; built-in lexical Explore remains available.`;
    return Object.freeze({
      capability: Object.freeze({ reason, state: "unsupported" as const, target }),
      mode: "lexical-fallback" as const,
      provider: fallbackProvider("ATLAS_QMD_UNSUPPORTED", reason),
    });
  }

  const context: AtlasQmdRuntimeContext = Object.freeze({
    architecture,
    atlasHostDirectory: resolve(options.atlasHostDirectory),
    atlasVersion: options.atlasVersion,
    platform,
    toolRuntimeRoot: resolve(
      options.toolRuntimeRoot ?? defaultToolRuntimeRoot(platform, architecture),
    ),
  });
  const selectedRuntime = runtime ?? createLocalAtlasQmdRuntime();
  const inspection = selectedRuntime.inspectToolRuntime(context);
  if (inspection.state !== "ready") {
    const proposal = installationProposal(
      context,
      inspection.reason ??
        "The pinned atlas-qmd Tool Runtime is not installed in its machine-scoped location.",
    );
    if (!approvalMatches(options.installationApproval, proposal.digest)) {
      const approvalReason =
        options.installationApproval === undefined
          ? proposal.reason
          : "The supplied installation approval does not match the exact proposal.";
      return Object.freeze({
        capability: Object.freeze({ state: "supported" as const, target }),
        installationProposal: proposal,
        mode: "lexical-fallback" as const,
        provider: fallbackProvider(
          "ATLAS_QMD_INSTALLATION_APPROVAL_REQUIRED",
          `${approvalReason} Built-in lexical Explore remains available.`,
        ),
      });
    }
    try {
      selectedRuntime.installToolRuntime(proposal, context);
    } catch (error) {
      return Object.freeze({
        capability: Object.freeze({ state: "supported" as const, target }),
        installationProposal: proposal,
        mode: "lexical-fallback" as const,
        provider: fallbackProvider(
          "ATLAS_QMD_INSTALLATION_FAILED",
          `atlas-qmd installation failed; built-in lexical Explore remains available: ${errorMessage(error)}`,
        ),
      });
    }
  }

  if (options.semantic === true) {
    const proposal = modelProposal(context);
    if (!approvalMatches(options.modelApproval, proposal.digest)) {
      return Object.freeze({
        capability: Object.freeze({ state: "supported" as const, target }),
        mode: "qmd-lexical" as const,
        modelProposal: proposal,
        provider: qmdProvider(context, selectedRuntime, "lexical", {
          code: "ATLAS_QMD_MODEL_APPROVAL_REQUIRED",
          message:
            "Semantic QMD models require separate approval; QMD lexical ranking was used.",
          severity: "warning",
        }),
      });
    }
    return Object.freeze({
      capability: Object.freeze({ state: "supported" as const, target }),
      mode: "qmd-semantic" as const,
      provider: qmdProvider(context, selectedRuntime, "semantic"),
    });
  }

  return Object.freeze({
    capability: Object.freeze({ state: "supported" as const, target }),
    mode: "qmd-lexical" as const,
    provider: qmdProvider(context, selectedRuntime, "lexical"),
  });
}
