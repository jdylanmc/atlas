import assert from "node:assert/strict";
import type {
  AtlasQmdOptions,
  AtlasQmdPreparation,
} from "../src/extensions/atlas_qmd.ts";
import type { InputContractResult } from "../src/interfaces/input_contract_command.ts";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { readInstalledConsumerCorpus } from "./installed_consumer_corpus.ts";
import { exerciseInitializationArtifactConflicts } from "./initialization_artifact_probes.ts";
import { exerciseGovernanceRetirement } from "./governance_retirement_probe.ts";
import { parseMachineOperationResult } from "./machine_operation_result.ts";
import { createSuiteArtifactOwner } from "./suite_artifact.ts";
import type { AtlasInitializationResult } from "../src/operations/initialize_operation.ts";
import type { LintOperationResult } from "../src/operations/lint_operation.ts";
import type { ExploreOperationResult } from "../src/operations/explore_operation.ts";
import { initializeCommandExitCodes } from "../src/interfaces/initialize_command.ts";
import { lintCommandExitCodes } from "../src/interfaces/lint_command.ts";
import { exploreCommandExitCodes } from "../src/interfaces/explore_command.ts";
import { governCommandExitCodes } from "../src/interfaces/governance_command.ts";
import { ingestCommandExitCodes } from "../src/interfaces/ingest_command.ts";
import {
  governanceAttestationOperation,
  governanceAttestationPayload,
  type AtlasGovernanceResult,
} from "../src/operations/governance_operation.ts";
import {
  ingestScopeAttestationOperation,
  ingestScopeAttestationPayload,
  type AtlasIngestResult,
} from "../src/operations/ingest_operation.ts";
import { attestationPayloadDigest } from "../src/operations/operation_support.ts";
import { probeAtlasIngestSource } from "../src/operations/ingest_operation.ts";
import type { AtlasLock } from "../src/domain/atlas_lock.ts";

const ROOT = resolve(import.meta.dirname, "..");

interface PackageContract {
  readonly bin?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly files?: readonly string[];
  readonly private?: boolean;
  readonly publishConfig?: { readonly access?: string };
  readonly version?: string;
}

interface PackedFile {
  readonly path: string;
}

interface PackDryRun {
  readonly files: readonly PackedFile[];
  readonly version: string;
}

function readPackage(): PackageContract {
  return JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as PackageContract;
}

function walkFiles(directory: string): readonly string[] {
  const paths: string[] = [];
  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      paths.push(
        absolute
          .slice(ROOT.length + 1)
          .split(sep)
          .join("/"),
      );
    }
  }
  walk(directory);
  return paths.toSorted();
}

function withPackSource<T>(run: (source: string) => T): T {
  const workspace = mkdtempSync(join(tmpdir(), "atlas-pack-source-"));
  const source = join(workspace, "source");
  try {
    const excluded = new Set([
      ".git",
      ".test-workspaces",
      "coverage",
      "dist",
      "node_modules",
    ]);
    cpSync(ROOT, source, {
      filter: (path) => {
        const pathFromRoot = relative(ROOT, path);
        return (
          pathFromRoot === "" ||
          !excluded.has(pathFromRoot.split(sep)[0] ?? pathFromRoot)
        );
      },
      recursive: true,
    });
    symlinkSync(join(ROOT, "node_modules"), join(source, "node_modules"), "dir");
    return run(source);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
}

function packDryRun(injectedRelativePath?: string): {
  readonly injectedPathExists: boolean;
  readonly pack: PackDryRun;
} {
  return withPackSource((source) => {
    const injectedPath =
      injectedRelativePath === undefined
        ? undefined
        : join(source, injectedRelativePath);
    if (injectedPath !== undefined) {
      mkdirSync(resolve(injectedPath, ".."), { recursive: true });
      writeFileSync(injectedPath, 'console.error("unreviewed");\n');
    }
    const output = execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--silent", "--ignore-scripts=false"],
      {
        cwd: source,
        encoding: "utf8",
        killSignal: "SIGKILL",
        timeout: 180_000,
      },
    );
    const [pack] = JSON.parse(output) as readonly PackDryRun[];
    assert.ok(pack);
    return {
      injectedPathExists: injectedPath === undefined ? false : existsSync(injectedPath),
      pack,
    };
  });
}

test("package metadata declares the supported consumption contract", () => {
  const packageJson = readPackage();

  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.publishConfig?.access, "public");
  assert.deepEqual(packageJson.bin, { atlas: "./dist/scripts/atlas_bin.js" });
  assert.deepEqual(packageJson.files, ["README.md", "dist/**/*.d.ts", "dist/**/*.js"]);
  assert.deepEqual(packageJson.exports, {
    ".": {
      types: "./dist/src/index.d.ts",
      default: "./dist/src/index.js",
    },
    "./atlas-qmd": {
      types: "./dist/src/extensions/atlas_qmd.d.ts",
      default: "./dist/src/extensions/atlas_qmd.js",
    },
    "./package.json": "./package.json",
  });
});

test("source public API barrel exposes the same root contract", async () => {
  const atlas = (await import("../src/index.ts")) as {
    readonly lintCommandUsage: string;
    readonly runLintCommandOperation: unknown;
  };

  assert.match(atlas.lintCommandUsage, /^usage: atlas lint/u);
  assert.equal(typeof atlas.runLintCommandOperation, "function");
});

test("package root is importable and internal subpaths are private", async () => {
  const atlas = (await import("@jdylanmc/atlas")) as {
    readonly lintCommandUsage: string;
    readonly runLintCommandOperation: unknown;
  };

  assert.match(atlas.lintCommandUsage, /^usage: atlas lint/u);
  assert.equal(typeof atlas.runLintCommandOperation, "function");
  const atlasQmd = (await import("@jdylanmc/atlas/atlas-qmd")) as {
    readonly prepareAtlasQmd: (options: AtlasQmdOptions) => AtlasQmdPreparation;
  };
  const unsupported = atlasQmd.prepareAtlasQmd({
    architecture: "arm64",
    atlasHostDirectory: "/fixture/atlas",
    atlasVersion: "fixture-snapshot",
    platform: "win32",
  });
  assert.equal(unsupported.capability.state, "unsupported");
  assert.equal(unsupported.mode, "lexical-fallback");
  const internalSpecifier = "@jdylanmc/atlas/src/operations/lint_operation.ts";
  await assert.rejects(import(internalSpecifier), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
});

test("npm artifact contains only the runtime allowlist", () => {
  assert.equal(statSync(join(ROOT, "dist", "scripts", "atlas.js")).isFile(), true);
  const { pack } = packDryRun();
  assert.equal(pack.version, "0.1.0");

  const actual = pack.files.map((file) => file.path).toSorted();
  const expected = [
    "README.md",
    "package.json",
    ...walkFiles(join(ROOT, "dist")).filter(
      (path) => path.endsWith(".d.ts") || path.endsWith(".js"),
    ),
  ].toSorted();
  assert.deepEqual(actual, expected);
  assert.equal(
    actual.some((path) => path.startsWith("tests/")),
    false,
  );
  assert.equal(
    actual.some((path) => path.startsWith(".test-workspaces/")),
    false,
  );
  assert.equal(
    actual.some((path) => path.startsWith("src/")),
    false,
  );
  assert.equal(
    actual.some((path) => path.includes("package-lock.json")),
    false,
  );
});

test("prepack rebuild removes ignored dist files before packaging", () => {
  const { injectedPathExists, pack } = packDryRun("dist/proof-unreviewed.js");
  const actual = pack.files.map((file) => file.path).toSorted();

  assert.equal(injectedPathExists, false);
  assert.equal(actual.includes("dist/proof-unreviewed.js"), false);
});

// Issue #204 retired the assembled-bundle model, and with it the only test that
// ran Atlas commands under production-only conditions. The bundle is gone; the
// properties it proved are not, because ADR-0002 made the published package the
// way an operator obtains Atlas SDK. This installs the packed artifact with
// development dependencies omitted and drives the installed executable, so a
// runtime import that only a development dependency satisfies fails here rather
// than on an adopter's first command.
//
// It remains in this file so one permanent package-test surface owns dry-run and
// installed artifacts. Each pack builds from an isolated copy, allowing prepack
// to replace its private `dist/` without mutating the producer's build output.

interface InstalledCommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function packArtifact(destination: string): string {
  mkdirSync(destination, { recursive: true });
  // `--ignore-scripts=false` runs `prepack`, so the artifact under test is built
  // by the same path `package:publish` uses rather than from whatever `dist/`
  // happened to contain when this suite started.
  withPackSource((source) =>
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts=false", "--pack-destination", destination, "--silent"],
      { cwd: source, killSignal: "SIGKILL", stdio: "ignore", timeout: 180_000 },
    ),
  );
  const [tarball] = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
  assert.ok(tarball !== undefined, "npm pack produced no tarball");
  return join(destination, tarball);
}

const installedConsumerArtifact = createSuiteArtifactOwner(packArtifact);
after(() => installedConsumerArtifact.dispose());

/**
 * A consumer with its own directory, its own Git history, and Atlas SDK
 * installed from the packed artifact with production dependencies only.
 *
 * It lives under the operating system temporary directory rather than inside
 * this repository, and that placement is the whole mechanism: Node resolves a
 * bare specifier by walking parent directories, so a consumer nested under the
 * repository would reach the development `node_modules` and satisfy an import
 * the published package never declared. An earlier version of this test was
 * nested, and passed while `yaml` was a development dependency. Monkey-patching
 * `node:fs` does not substitute for this, because the module loader does not
 * read through it.
 */
function createConsumer(workspace: string): string {
  const consumer = join(workspace, "consumer");
  mkdirSync(consumer, { recursive: true });

  // The consumer is seeded with this repository's own verified lockfile, and
  // that is what makes an offline install possible at all. `npm ci` populates
  // the cache with tarballs keyed by resolved URL; it never caches a packument.
  // `npm install <tarball>` into a directory with no lockfile has to build an
  // ideal tree, which needs a packument for every dependency, so under
  // `--offline` it fails with ENOTCACHED on any cache but a developer's warm
  // one. With a lockfile there is nothing to resolve: npm reads the exact
  // versions, integrity hashes, and resolved URLs it was given.
  //
  // The consumer must not borrow the SDK's `name` together with an `exports`
  // map, or a bare specifier would self-resolve to the consumer root instead of
  // `node_modules` and silently destroy the isolation this function exists to
  // create. Versions are pinned by the seeded lockfile, and `npm ci` verifies
  // each package against the `integrity` hash it records; there is nothing left
  // for this function to assert about them that npm has not already enforced.
  const sdkPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    readonly dependencies: Readonly<Record<string, string>>;
  };
  const sdkLock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  const consumerPackage = {
    dependencies: sdkPackage.dependencies,
    name: "atlas-consumer",
    private: true,
    version: "0.0.0",
  };
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify(consumerPackage, null, 2)}\n`,
  );
  const consumerLock = {
    ...sdkLock,
    name: consumerPackage.name,
    packages: {
      ...sdkLock.packages,
      "": {
        dependencies: sdkPackage.dependencies,
        name: consumerPackage.name,
        version: consumerPackage.version,
      },
    },
    version: consumerPackage.version,
  };
  writeFileSync(
    join(consumer, "package-lock.json"),
    `${JSON.stringify(consumerLock, null, 2)}\n`,
  );

  const offlineInstall = {
    cwd: consumer,
    killSignal: "SIGKILL" as const,
    stdio: "ignore" as const,
    timeout: 180_000,
  };
  execFileSync(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"],
    offlineInstall,
  );
  execFileSync(
    "npm",
    [
      "install",
      installedConsumerArtifact.artifact(),
      "--omit=dev",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--silent",
    ],
    offlineInstall,
  );

  writeFileSync(join(consumer, ".gitignore"), "node_modules/\n");
  for (const argv of [
    ["init", "--quiet", "--initial-branch=main"],
    ["config", "user.email", "atlas@example.invalid"],
    ["config", "user.name", "Atlas Consumer"],
    ["add", "package.json", "package-lock.json", ".gitignore"],
    ["commit", "--quiet", "-m", "Create consumer before Atlas Initialization"],
  ]) {
    consumerGit(consumer, argv);
  }
  return consumer;
}

function consumerGit(consumer: string, arguments_: readonly string[]): string {
  return consumerGitRaw(consumer, arguments_).trim();
}

function consumerGitRaw(consumer: string, arguments_: readonly string[]): string {
  // Atlas Snapshot capture reads committed bytes. Global and system Git configuration
  // are neutralized: an operator with `commit.gpgsign` would otherwise send this
  // into a `pinentry` prompt that blocks forever, and a synchronous test body
  // has nothing above it that can interrupt.
  return execFileSync("git", arguments_, {
    cwd: consumer,
    encoding: "utf8",
    env: consumerEnvironment(),
    killSignal: "SIGKILL" as const,
    timeout: 30_000,
  });
}

function consumerEnvironment(guard?: string): NodeJS.ProcessEnv {
  // Runtime children receive no API keys, NODE_PATH, or inherited Node loaders.
  // Keep only process launch, workspace placement, and coverage requirements.
  const environment: NodeJS.ProcessEnv = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const key of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "NODE_V8_COVERAGE",
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  if (guard !== undefined) {
    environment["NODE_OPTIONS"] = `--import=${pathToFileURL(guard).href}`;
  }
  return environment;
}

/**
 * Blocks Node sockets in the child process, not subprocess Git networking.
 * Only the Node network half of the
 * guard the retired clean-clone test carried is restored: its filesystem half
 * wrapped `node:fs`, which the module loader does not read through, so it could
 * never have blocked the resolution it advertised. Patching
 * `net.Socket.prototype.connect` does work. The local Git journey has no remote,
 * and npm's offline lockfile/cache installation is enforced separately.
 */
function writeNetworkGuard(path: string): void {
  writeFileSync(
    path,
    `import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
net.Socket.prototype.connect = function blockedConnect() {
  throw new Error("network access blocked");
};
syncBuiltinESMExports();
`,
  );
}

function runInstalled(
  consumer: string,
  guard: string,
  arguments_: readonly string[],
  nodeArguments: readonly string[] = [],
): InstalledCommandResult {
  const result = spawnSync(
    process.execPath,
    [...nodeArguments, join(consumer, "node_modules", ".bin", "atlas"), ...arguments_],
    {
      cwd: consumer,
      encoding: "utf8",
      env: consumerEnvironment(guard),
      killSignal: "SIGKILL",
      timeout: 120_000,
    },
  );
  assert.equal(result.error, undefined);
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function diagnosticIndices(text: string): ReadonlySet<number> {
  const indices = new Set<number>();
  const mask = /^mask@(\d+):([0-9a-f]+)$/u.exec(text);
  if (mask !== null) {
    const offset = Number(mask[1]);
    const hex = mask[2] as string;
    assert.equal(offset % 8, 0);
    assert.equal(hex.length % 2, 0);
    for (const [byte, value] of Buffer.from(hex, "hex").entries()) {
      for (let bit = 0; bit < 8; bit += 1) {
        if ((value & (2 ** bit)) !== 0) indices.add(offset + byte * 8 + bit);
      }
    }
  } else {
    for (const range of text.split(",")) {
      assert.match(range, /^\d+(?:\.\.\d+)?$/u);
      const [first, last = first] = range.split("..").map(Number);
      assert.ok(first !== undefined && last !== undefined && first <= last);
      for (let index = first; index <= last; index += 1) indices.add(index);
    }
  }
  return indices;
}

// No `{ timeout }` on this test on purpose. Its body is synchronous, so it never
// yields to the runner's event loop and a declared test timeout can never fire -
// it would read as a guarantee while bounding nothing. Every child process
// carries its own timeout and SIGKILL instead, which is a bound that actually
// holds and keeps the cleanup in `finally` reachable.
for (const entry of readInstalledConsumerCorpus().cases) {
  test(`adversarial installed-consumer corpus: ${entry.name}`, () => {
    const workspace = mkdtempSync(join(tmpdir(), "atlas-installed-"));
    const producerOutputProof =
      entry.isolatedPackPreservesProducerOutput === true
        ? join(ROOT, "dist", "proof-producer-output.js")
        : undefined;
    let producerOutputIdentity:
      | { readonly ino: bigint; readonly mtimeNs: bigint; readonly size: bigint }
      | undefined;
    try {
      if (producerOutputProof !== undefined) {
        // Test-sensitivity control: root prepack would delete this file.
        writeFileSync(producerOutputProof, 'console.error("producer output");\n');
        const stats = statSync(producerOutputProof, { bigint: true });
        producerOutputIdentity = {
          ino: stats.ino,
          mtimeNs: stats.mtimeNs,
          size: stats.size,
        };
      }
      const consumer = createConsumer(workspace);
      if (producerOutputProof !== undefined) {
        assert.equal(
          readFileSync(producerOutputProof, "utf8"),
          'console.error("producer output");\n',
        );
        const stats = statSync(producerOutputProof, { bigint: true });
        assert.deepEqual(
          { ino: stats.ino, mtimeNs: stats.mtimeNs, size: stats.size },
          producerOutputIdentity,
        );
      }
      assert.ok(!realpathSync(consumer).startsWith(`${realpathSync(ROOT)}${sep}`));
      assert.equal(consumerGit(consumer, ["remote"]), "");
      assert.equal(existsSync(join(consumer, "src")), false);

      const guard = join(workspace, "network_guard.mjs");
      writeNetworkGuard(guard);

      // Positive control. A guard nothing can trip is indistinguishable from a
      // guard that is not armed, and the previous version of this test shipped
      // exactly that. Prove the injection works before trusting what it permits.
      const control = join(workspace, "control.mjs");
      writeFileSync(
        control,
        'import net from "node:net";\nnet.connect(1, "127.0.0.1");\n',
      );
      const armed = spawnSync(process.execPath, [control], {
        encoding: "utf8",
        env: consumerEnvironment(guard),
        killSignal: "SIGKILL",
        timeout: 30_000,
      });
      assert.notEqual(armed.status, 0, "the network guard did not arm");
      assert.match(armed.stderr, /network access blocked/u);

      const vocabulary = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          [
            'import assert from "node:assert/strict";',
            'import { readFileSync, realpathSync } from "node:fs";',
            'import { createRequire } from "node:module";',
            'import { resolve, sep } from "node:path";',
            'import { fileURLToPath } from "node:url";',
            'const packageUrl = import.meta.resolve("@jdylanmc/atlas/package.json");',
            'const modules = realpathSync("node_modules");',
            'assert.equal(realpathSync(fileURLToPath(packageUrl)), resolve(modules, "@jdylanmc/atlas/package.json"));',
            'const { dependencies } = JSON.parse(readFileSync(new URL(packageUrl), "utf8"));',
            "const require = createRequire(packageUrl);",
            "for (const name of Object.keys(dependencies)) assert.ok(realpathSync(require.resolve(name)).startsWith(`${modules}${sep}`), name);",
            'await assert.rejects(import("eslint"), { code: "ERR_MODULE_NOT_FOUND" });',
            'await assert.rejects(import("@jdylanmc/atlas/src/operations/lint_operation.ts"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });',
            'const { prepareAtlasQmd } = await import("@jdylanmc/atlas/atlas-qmd");',
            'const optional = prepareAtlasQmd({ architecture: "arm64", atlasHostDirectory: ".", atlasVersion: "fixture", platform: "win32" });',
            'assert.equal(optional.capability.state, "unsupported");',
            'assert.equal(optional.mode, "lexical-fallback");',
            'const { validateVocabularyAgreement } = await import(new URL("./dist/src/lint/validate_vocabulary_agreement.js", import.meta.resolve("@jdylanmc/atlas/package.json")));',
            'const findings = validateVocabularyAgreement({}, [], [{ term: "Anchor", reason: "installed-package probe" }],',
            '{ path: "CONTEXT.md", content: "**Anchor**:\\n_Avoid_: Bonfire\\n" },',
            `[{ path: "scripts/atlas_sdk_agents.ts", content: ${JSON.stringify('const matcher = /"Bonfire"/u; const ratio = value! / "Bonfires" / divisor;')} }]);`,
            'assert.deepEqual(findings.map(({ code }) => code), ["ATLAS_VOCABULARY_IDENTIFIER_AVOIDED"]);',
            'assert.match(findings[0].message, /"Bonfires"/u);',
          ].join("\n"),
        ],
        {
          cwd: consumer,
          encoding: "utf8",
          env: consumerEnvironment(guard),
          killSignal: "SIGKILL",
          timeout: 30_000,
        },
      );
      assert.equal(vocabulary.status, 0, vocabulary.stderr);
      assert.equal(vocabulary.stderr, "");

      assert.equal(existsSync(join(consumer, ".atlas")), false);
      const base = consumerGit(consumer, ["rev-parse", "HEAD"]);
      const beforePlan = consumerGit(consumer, ["status", "--porcelain"]);
      const branchesBeforePlan = consumerGit(consumer, ["branch", "--list"]);
      if (entry.repeatedEmptyEdges !== undefined) {
        const probe = entry.repeatedEmptyEdges;
        const empty = JSON.stringify({
          "ingest-request-schema": "1.0.0",
          scope: {},
          candidateGraph: {
            "candidate-graph-schema": "1.0.0",
            concepts: [],
            disputes: [],
            edges: [],
            sources: [],
          },
        });
        const count = Math.floor(
          (probe.maxRawBytes - Buffer.byteLength(empty) + 1) / 3,
        );
        const json = empty.replace(
          '"edges":[]',
          `"edges":[${Array<string>(count).fill("{}").join(",")}]`,
        );
        assert.ok(Buffer.byteLength(json) <= probe.maxRawBytes);
        const inputPath = join(workspace, "maximum-malformed-input.json");
        writeFileSync(inputPath, json.padEnd(probe.maxRawBytes, " "));
        const refused = runInstalled(
          consumer,
          guard,
          ["ingest", "reconcile", "--machine", "--ingest-request", inputPath],
          [`--max-old-space-size=${String(probe.maxHeapMiB)}`],
        );
        assert.equal(refused.status, 64, refused.stderr);
        const result = parseMachineOperationResult(refused.stdout);
        const messages = result.handoff.validationState.findings.flatMap(
          ({ message }) => message.split("\n"),
        );
        assert.equal(messages.length, probe.expectedFields.length + 10);
        for (const field of probe.expectedFields) {
          assert.ok(
            messages.some((message) =>
              message.startsWith(
                `request.candidateGraph.edges[0..${String(count - 1)}].${field} `,
              ),
            ),
            field,
          );
        }
        for (const pairs of [
          probe.alternatingPairs,
          Math.floor((probe.maxRawBytes - Buffer.byteLength(empty) + 1) / 5),
        ]) {
          const alternating = empty.replace(
            '"edges":[]',
            `"edges":[${Array<string>(pairs).fill("{},0").join(",")}]`,
          );
          assert.ok(Buffer.byteLength(alternating) <= probe.maxRawBytes);
          writeFileSync(inputPath, alternating.padEnd(probe.maxRawBytes, " "));
          const rejected = runInstalled(
            consumer,
            guard,
            ["ingest", "reconcile", "--machine", "--ingest-request", inputPath],
            [`--max-old-space-size=${String(probe.maxHeapMiB)}`],
          );
          assert.equal(rejected.status, 64, rejected.stderr);
          const result = parseMachineOperationResult(rejected.stdout);
          const lines = result.handoff.validationState.findings.flatMap(({ message }) =>
            message.split("\n"),
          );
          assert.equal(lines.length, probe.expectedFields.length + 11);
          const edgeErrors = lines.filter((line) =>
            line.startsWith("request.candidateGraph.edges["),
          );
          assert.equal(edgeErrors.length, probe.expectedFields.length + 1);
          const observedFields = new Set<string>();
          for (const line of edgeErrors) {
            const match =
              /^request\.candidateGraph\.edges\[([^\]]+)\](?:\.([a-zA-Z]+))? (.+)$/u.exec(
                line,
              );
            assert.ok(match);
            const indices = diagnosticIndices(match[1] as string);
            const field = match[2];
            const identity = field ?? "$object";
            assert.equal(observedFields.has(identity), false);
            observedFields.add(identity);
            assert.ok(field === undefined || probe.expectedFields.includes(field));
            if (field === undefined) assert.equal(match[3], "must be an object");
            assert.equal(indices.size, pairs);
            for (let index = 0; index < pairs * 2; index += 1) {
              assert.equal(
                indices.has(index),
                index % 2 === (field === undefined ? 1 : 0),
              );
            }
          }
          assert.deepEqual(
            [...observedFields].sort(),
            ["$object", ...probe.expectedFields].sort(),
          );
        }
        assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), base);
        assert.equal(consumerGit(consumer, ["branch", "--list"]), branchesBeforePlan);
        assert.equal(consumerGit(consumer, ["status", "--porcelain"]), beforePlan);
        assert.equal(existsSync(join(consumer, ".atlas")), false);
      }
      let principleExample:
        { readonly path: string; readonly content: string } | undefined;
      if (entry.inputContracts !== undefined) {
        const usage = runInstalled(consumer, guard, []);
        assert.equal(usage.status, 64);
        assert.match(
          parseMachineOperationResult(usage.stdout).handoff.recommendedNextAction,
          /input-contract/u,
        );
        const discovery = runInstalled(consumer, guard, [
          "input-contract",
          "--machine",
        ]);
        assert.equal(discovery.status, 64);
        const available = parseMachineOperationResult(discovery.stdout).handoff
          .recommendedNextAction;
        for (const probe of entry.inputContracts) {
          assert.ok(available.includes(probe.name));
          const described = runInstalled(consumer, guard, [
            "input-contract",
            "--machine",
            probe.name,
          ]);
          assert.equal(described.status, 0, described.stdout);
          assert.equal(described.stderr, "");
          const document = parseMachineOperationResult(
            described.stdout,
          ) as InputContractResult;
          assert.equal(document.operation.kind, "input-contract");
          assert.equal(document.completion, "completed");
          assert.equal(document.disposition, "success");
          assert.equal(document.handoff.homeAtlas.state, "not-applicable");
          assert.equal(document.handoff.baseSnapshot.state, "not-applicable");
          assert.equal(document.handoff.proposedChanges.state, "not-applicable");
          assert.ok(document.payload.state === "completed");
          const contract = document.payload.contract;
          assert.equal(contract.name, probe.name);
          assert.equal(
            contract.schema.$schema,
            "https://json-schema.org/draft/2020-12/schema",
          );
          assert.deepEqual(contract.schema["required"], probe.expectedRequired);
          assert.equal(contract.maxFileBytes, 1_048_576);
          if (probe.name === "governance-request") {
            assert.ok(contract.principleExample);
            assert.match(contract.principleExample.notice, /not approval/u);
            principleExample = contract.principleExample;
          }
          const inputPath = join(workspace, `${probe.name}-invalid.json`);
          writeFileSync(inputPath, JSON.stringify(probe.input));
          const refused = runInstalled(consumer, guard, [
            ...probe.arguments,
            inputPath,
          ]);
          assert.equal(refused.status, 64, refused.stdout);
          assert.equal(refused.stderr, "");
          const refusal = parseMachineOperationResult(refused.stdout);
          assert.equal(refusal.completion, "not-completed");
          const findings = refusal.handoff.validationState.findings;
          assert.deepEqual(
            findings.map(({ code }) => code),
            probe.expectedCodes,
          );
          const invalid = findings.filter(({ code }) =>
            code.endsWith("_INPUT_INVALID"),
          );
          const messages = invalid.flatMap(({ message }) => message.split("\n"));
          assert.equal(messages.length, probe.expectedPaths.length);
          for (const path of probe.expectedPaths) {
            assert.ok(
              messages.some((message) => message.startsWith(`${path} `)),
              path,
            );
          }
          assert.ok(
            refusal.handoff.recommendedNextAction.includes(
              `atlas input-contract --machine ${probe.name}`,
            ),
          );
        }
        assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), base);
        assert.equal(consumerGit(consumer, ["branch", "--list"]), branchesBeforePlan);
        assert.equal(consumerGit(consumer, ["status", "--porcelain"]), beforePlan);
        assert.equal(existsSync(join(consumer, ".atlas")), false);
      }
      for (const probe of entry.ingestPlan ?? []) {
        const scopePath = join(workspace, probe.scopeFixture);
        writeFileSync(
          scopePath,
          readFileSync(join(ROOT, "tests", "fixtures", "ingest", probe.scopeFixture)),
        );
        const plan = runInstalled(consumer, guard, [
          "ingest",
          "plan",
          "--machine",
          "--ingest-scope",
          scopePath,
        ]);
        assert.equal(plan.stderr, "");
        assert.equal(
          plan.status,
          probe.expectation === "accept" ? 0 : probe.expectedExit,
          plan.stdout,
        );
        const planned = parseMachineOperationResult(plan.stdout);
        assert.equal(planned.operation.kind, "ingest");
        const payload = planned.payload as Readonly<Record<string, unknown>>;
        if (probe.expectation === "accept") {
          assert.equal(planned.completion, "completed");
          assert.equal(planned.disposition, "success");
          assert.equal(planned.handoff.validationState.state, "passed");
          assert.deepEqual(planned.handoff.validationState.findings, []);
          assert.equal(planned.handoff.homeAtlas.state, "not-applicable");
          assert.equal(planned.handoff.baseSnapshot.state, "not-applicable");
          assert.equal(planned.handoff.proposedChanges.state, "not-applicable");
          assert.equal(planned.handoff.reviewLink.state, "not-applicable");
          assert.deepEqual(payload, { crawlAssignment: probe.expectedAssignment });
        } else {
          assert.equal(planned.completion, "not-completed");
          assert.equal(planned.disposition, "failed");
          assert.deepEqual(
            planned.handoff.validationState.findings.map(({ code }) => code),
            [probe.expectedCode],
          );
          assert.equal("crawlAssignment" in payload, false);
        }
        assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), base);
        assert.equal(consumerGit(consumer, ["branch", "--list"]), branchesBeforePlan);
        assert.equal(consumerGit(consumer, ["status", "--porcelain"]), beforePlan);
        assert.equal(existsSync(join(consumer, ".atlas")), false);
      }
      const initialize = runInstalled(consumer, guard, [
        "initialize",
        "--machine",
        "--atlas-host-directory",
        consumer,
      ]);
      assert.equal(
        initialize.status,
        initializeCommandExitCodes.success,
        initialize.stdout,
      );
      assert.equal(initialize.stderr, "");
      const initialization = parseMachineOperationResult(
        initialize.stdout,
      ) as AtlasInitializationResult;
      assert.equal(initialization.completion, "completed");
      assert.equal(initialization.disposition, "success");
      const { proposalBranch, targetBranch, targetHead } =
        initialization.payload.workflowState;
      assert.equal(targetBranch, "main");
      assert.equal(targetHead, base);
      assert.notEqual(proposalBranch, targetBranch);
      assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), base);
      assert.equal(existsSync(join(consumer, ".atlas")), false);
      const proposal = consumerGit(consumer, ["rev-parse", proposalBranch]);
      assert.notEqual(proposal, base);
      assert.equal(consumerGit(consumer, ["rev-parse", `${proposal}^`]), base);
      assert.deepEqual(
        consumerGit(consumer, ["diff", "--name-only", base, proposal]).split("\n"),
        entry.expectedAtlasPaths,
      );
      assert.equal(
        initialization.payload.atlasReadinessReport?.lintStamp.atlasCommit,
        proposal,
      );
      if (entry.readinessArtifacts !== undefined) {
        const directory = join(
          consumer,
          ".atlas-operation-workspaces",
          ".artifacts",
          proposalBranch,
        );
        const markdownPath = join(directory, "readiness-report.md");
        const stampPath = join(directory, "lint-stamp.json");
        assert.equal(
          existsSync(markdownPath),
          true,
          "initialize did not emit the documented Markdown Readiness Report",
        );
        const markdown = readFileSync(markdownPath, "utf8");
        assert.deepEqual(
          markdown.split("\n").filter((line) => /^#{1,2} /u.test(line)),
          entry.readinessArtifacts.headings,
        );
        assert.ok(markdown.includes(entry.readinessArtifacts.governance));
        assert.equal(
          markdown.includes("proposes no Atlas Manifest"),
          false,
          "the report denied a Manifest present in the proposal",
        );
        assert.ok(markdown.includes(proposal));
        assert.deepEqual(JSON.parse(readFileSync(stampPath, "utf8")), {
          "lint-stamp-schema": "1.0.0",
          atlasCommit: proposal,
          evidenceRevision: proposal,
        });
        assert.ok(initialization.handoff.recommendedNextAction.includes(markdownPath));
        assert.ok(initialization.handoff.recommendedNextAction.includes(stampPath));
        assert.deepEqual(initialization.payload.outputArtifacts, {
          lintStamp: stampPath,
          readinessReportMarkdown: markdownPath,
        });
        const reportStat = statSync(markdownPath, { bigint: true });
        const stampStat = statSync(stampPath, { bigint: true });
        const resumed = runInstalled(consumer, guard, [
          "initialize",
          "--machine",
          "--atlas-host-directory",
          consumer,
          "--resume-proposal-branch",
          proposalBranch,
        ]);
        assert.equal(resumed.status, 0, resumed.stdout);
        assert.equal(resumed.stderr, "");
        assert.equal(readFileSync(markdownPath, "utf8"), markdown);
        for (const [path, previous] of [
          [markdownPath, reportStat],
          [stampPath, stampStat],
        ] as const) {
          const current = statSync(path, { bigint: true });
          assert.equal(current.ino, previous.ino);
          assert.equal(current.mtimeNs, previous.mtimeNs);
        }
        const rendered = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            [
              'import { readFileSync } from "node:fs";',
              'import { renderAtlasReadinessReportMarkdown } from "@jdylanmc/atlas";',
              'const { report, enriched } = JSON.parse(readFileSync(0, "utf8"));',
              "const empty = { ...report, capabilities: [], unresolvedDecisions: [] };",
              "process.stdout.write(JSON.stringify({",
              "  enriched: renderAtlasReadinessReportMarkdown({ ...report, ...enriched }),",
              "  empty: renderAtlasReadinessReportMarkdown(empty),",
              "}));",
            ].join("\n"),
          ],
          {
            cwd: consumer,
            encoding: "utf8",
            env: consumerEnvironment(guard),
            input: JSON.stringify({
              report: initialization.payload.atlasReadinessReport,
              enriched: entry.readinessArtifacts.enrichedReport,
            }),
            killSignal: "SIGKILL",
            timeout: 30_000,
          },
        );
        assert.equal(rendered.status, 0, rendered.stderr);
        assert.equal(rendered.stderr, "");
        const renderedReports = JSON.parse(rendered.stdout) as {
          readonly enriched: string;
          readonly empty: string;
        };
        for (const text of entry.readinessArtifacts.enrichedMarkdown) {
          assert.ok(renderedReports.enriched.includes(text), text);
        }
        assert.ok(
          renderedReports.empty.includes("No capability entries were reported."),
        );
        assert.ok(
          renderedReports.empty.includes("No unresolved decisions were reported."),
        );
        exerciseInitializationArtifactConflicts({
          artifacts: initialization.payload.outputArtifacts,
          cases: entry.readinessArtifacts.conflicts,
          gitState: () =>
            [
              consumerGit(consumer, ["show-ref"]),
              consumerGit(consumer, ["status", "--porcelain"]),
            ].join("\n"),
          resume: () => {
            const resumed = runInstalled(consumer, guard, [
              "initialize",
              "--machine",
              "--atlas-host-directory",
              consumer,
              "--resume-proposal-branch",
              proposalBranch,
            ]);
            assert.equal(resumed.status, 2, resumed.stdout);
            assert.equal(resumed.stderr, "");
            return parseMachineOperationResult(
              resumed.stdout,
            ) as AtlasInitializationResult;
          },
        });
        assert.equal(consumerGit(consumer, ["status", "--porcelain"]), beforePlan);
      }

      const unmerged = runInstalled(consumer, guard, [
        "lint",
        "--machine",
        "--atlas-host-directory",
        consumer,
      ]);
      assert.equal(unmerged.status, lintCommandExitCodes.usage, unmerged.stdout);
      const unmergedLint = parseMachineOperationResult(
        unmerged.stdout,
      ) as LintOperationResult;
      assert.equal(unmergedLint.completion, "not-completed");
      assert.equal(unmergedLint.disposition, "failed");
      assert.deepEqual(
        unmergedLint.handoff.validationState.findings.map(({ code }) => code),
        [entry.unmergedLintCode],
      );

      consumerGit(consumer, ["merge", "--ff-only", proposalBranch]);
      assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), proposal);
      assert.equal(consumerGit(consumer, ["branch", "--show-current"]), targetBranch);
      assert.equal(consumerGit(consumer, ["status", "--porcelain"]), "");
      assert.equal(existsSync(join(consumer, ".atlas", "index.md")), true);

      const lint = runInstalled(consumer, guard, [
        "lint",
        "--machine",
        "--atlas-host-directory",
        consumer,
      ]);
      assert.equal(lint.status, lintCommandExitCodes.success, lint.stderr);
      assert.equal(lint.stderr, "");
      const lintResult = parseMachineOperationResult(
        lint.stdout,
      ) as LintOperationResult;
      assert.equal(lintResult.completion, "completed");
      assert.equal(lintResult.disposition, "success");
      assert.ok(lintResult.payload.state === "completed");
      assert.deepEqual(lintResult.payload.lint.findings, []);

      const explore = runInstalled(consumer, guard, [
        "explore",
        "--machine",
        entry.query,
        "--atlas-host-directory",
        consumer,
      ]);
      assert.equal(explore.status, exploreCommandExitCodes.success, explore.stderr);
      assert.equal(explore.stderr, "");
      const exploreResult = parseMachineOperationResult(
        explore.stdout,
      ) as ExploreOperationResult;
      assert.equal(exploreResult.completion, "completed");
      assert.equal(exploreResult.disposition, "success");
      assert.equal(exploreResult.handoff.homeAtlas.state, "known");
      // Reachability is not function: an installed build whose search provider
      // returned nothing would still complete, still classify the Home Atlas,
      // and still exit zero.
      assert.ok(exploreResult.payload.results.length > 0);
      const [firstResult] = exploreResult.payload.results;
      assert.ok(firstResult !== undefined);
      assert.equal(firstResult.route[0]?.objectId, entry.expectedRootAnchorId);
      if (entry.providerInvocation !== undefined) {
        const providerProbe = join(consumer, "provider-consumer.mjs");
        writeFileSync(
          providerProbe,
          [
            'import assert from "node:assert/strict";',
            'import { readdirSync, readFileSync } from "node:fs";',
            'import { join, relative } from "node:path";',
            'import { runExploreOperation } from "@jdylanmc/atlas";',
            "const encoder = new TextEncoder();",
            "function files(directory) {",
            "  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {",
            "    const path = join(directory, entry.name);",
            "    return entry.isDirectory() ? files(path) : [path];",
            "  });",
            "}",
            'const capturedFiles = files(".atlas").map((path) => ({',
            '  bytes: encoder.encode(readFileSync(path, "utf8")),',
            '  path: relative(".", path).split("\\\\").join("/"),',
            "}));",
            "let providerCalls = 0;",
            "const provider = Object.freeze({",
            "  rank(documents) {",
            "    providerCalls += 1;",
            `    assert.ok(documents.some(({ id }) => id === ${JSON.stringify(entry.providerInvocation.expectedResultId)}));`,
            "    return Object.freeze([",
            `      Object.freeze({ objectId: ${JSON.stringify(entry.providerInvocation.rejectedObjectId)}, score: 100 }),`,
            `      Object.freeze({ objectId: ${JSON.stringify(entry.providerInvocation.expectedResultId)}, score: 1 }),`,
            "    ]);",
            "  },",
            "});",
            "const result = runExploreOperation({",
            '  baseSnapshot: { reference: "installed-provider-base", state: "known" },',
            "  capturedFiles,",
            '  homeAtlas: { reference: "installed-provider-home", state: "known" },',
            "  provider,",
            `  query: ${JSON.stringify(entry.query)},`,
            "});",
            `assert.equal(providerCalls, ${String(entry.providerInvocation.expectedProviderCalls)});`,
            `assert.equal(result.payload.results[0]?.result.id, ${JSON.stringify(entry.providerInvocation.expectedResultId)});`,
            `assert.equal(result.payload.results.some(({ result }) => result.id === ${JSON.stringify(entry.providerInvocation.rejectedObjectId)}), false);`,
            `assert.equal(result.payload.results[0]?.route[0]?.objectId, ${JSON.stringify(entry.expectedRootAnchorId)});`,
          ].join("\n"),
          "utf8",
        );
        const providerInvocation = spawnSync(process.execPath, [providerProbe], {
          cwd: consumer,
          encoding: "utf8",
          env: consumerEnvironment(guard),
          killSignal: "SIGKILL",
          timeout: 30_000,
        });
        assert.equal(providerInvocation.status, 0, providerInvocation.stderr);
        assert.equal(providerInvocation.stderr, "");
        rmSync(providerProbe);
      }
      if (entry.cacheFailure !== undefined) {
        if (
          [
            "invalid-lock-on-update",
            "first-metadata-cleanup",
            "first-metadata-cleanup-discarded",
            "lock-persistence",
          ].includes(entry.cacheFailure.mode)
        ) {
          const tracking = probeAtlasIngestSource({
            approvedAt: "2026-08-25T00:00:00Z",
            approvedBy: "Fixture Maintainer",
            asOf: "2026-08-25T00:00:00Z",
            atlasPath: ".",
            branch: "main",
            fromAnchorId: "anchor:root",
            repositoryLocator: "https://github.com/fixture/without-atlas.git",
            title: "Tracked Home Atlas",
          });
          assert.equal(tracking.state, "tracked-atlas");
          for (const change of tracking.changes) {
            mkdirSync(dirname(join(consumer, change.path)), { recursive: true });
            writeFileSync(join(consumer, change.path), change.content);
          }
          consumerGit(consumer, ["add", ".atlas"]);
          consumerGit(consumer, [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Track persistence fixture",
          ]);
        }
        const beforeHead = consumerGit(consumer, ["rev-parse", "HEAD"]);
        const beforeRoot = readFileSync(join(consumer, ".atlas", "index.md"));
        const remote = join(workspace, "remote-without-atlas");
        mkdirSync(remote);
        consumerGit(remote, ["init", "--quiet", "--initial-branch=main"]);
        writeFileSync(join(remote, "README.md"), "# Repository without an Atlas\n");
        if (entry.cacheFailure.mode !== "missing-atlas") {
          mkdirSync(join(remote, ".atlas"));
          writeFileSync(join(remote, ".atlas", "index.md"), beforeRoot);
        }
        consumerGit(remote, ["add", "."]);
        consumerGit(remote, [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "Create a non-Atlas remote",
        ]);
        const probe = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            [
              'import assert from "node:assert/strict";',
              'import fs, { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";',
              'import { syncBuiltinESMExports } from "node:module";',
              'import { execFileSync, spawnSync } from "node:child_process";',
              'import { dirname, join, sep } from "node:path";',
              'import { atlasCacheKey, atlasLocatorFromParts, createAtlasLock, deriveAtlasSlug, resolveAtlasCache, runExploreOperation } from "@jdylanmc/atlas";',
              `const input = ${JSON.stringify({ home: consumer, remote, mode: entry.cacheFailure.mode })};`,
              'const locator = atlasLocatorFromParts({ host: "github.com", owner: "fixture", repository: "without-atlas", branch: "main", atlasPath: "." });',
              "const slug = deriveAtlasSlug(locator);",
              'const trackedAtlas = { declarationId: `tracked-atlas:${slug.value}`, defaultBranch: "main", locator, slug, title: "Missing Atlas" };',
              'const request = { homeAtlasDirectory: input.home, introducedByAnchorId: "anchor:root", introducedByEdgeId: "edge:track", trackedAtlas };',
              'let now = "2026-08-30T00:00:00Z";',
              "let contacts = 0;",
              'const options = { now: () => now, resolveRemote: () => input.mode === "interrupted-first-contact" && contacts++ > 0 ? `${input.remote}-unreachable` : input.remote };',
              'const lockPath = join(input.home, ".atlas", "atlas-cache", "atlas-lock.json");',
              'const homeGit = (args) => execFileSync("git", ["-C", input.home, ...args], { timeout: 30000 });',
              'const homeHead = homeGit(["rev-parse", "HEAD"]).toString("utf8").trim();',
              'const homePaths = homeGit(["ls-tree", "-rz", "--name-only", homeHead, "--", ".atlas"]).toString("utf8").split("\\0").filter(Boolean);',
              'const homeFiles = homePaths.map((path) => ({ path, bytes: homeGit(["show", `${homeHead}:${path}`]) }));',
              "const explore = (cacheOptions) => runExploreOperation({",
              "atlasCacheResolver: { resolve: (entry) => resolveAtlasCache({ ...entry, homeAtlasDirectory: input.home }, cacheOptions) },",
              'baseSnapshot: { reference: homeHead, state: "known" },',
              'capturedFiles: homeFiles, homeAtlas: { reference: "local-home-atlas", state: "known" }, query: "Home Atlas",',
              "});",
              "const verifyExplore = (result, snapshot, online, maintenance) => {",
              'assert.equal(result.completion, "completed");',
              'assert.equal(result.disposition, "success");',
              'assert.equal(result.handoff.unresolvedHumanDecisions.state, "none");',
              'assert.deepEqual(result.payload.degradation.diagnostics.map(({ code }) => code), online ? [] : ["ATLAS_CROSS_ATLAS_CACHED_OFFLINE"]);',
              "assert.deepEqual(result.payload.maintenanceFindings?.map(({ code }) => code) ?? [], maintenance);",
              'assert.equal(result.handoff.degradationState.state, online ? "not-degraded" : "degraded");',
              'if (online) { assert.equal(result.payload.degradation.level, "valid-structured"); assert.equal(result.handoff.validationState.state, "passed"); }',
              'assert.ok(result.payload.results.some(({ result: item }) => item.snapshot?.role === "home"));',
              'const tracked = result.payload.results.find(({ result: item }) => item.snapshot?.role === "tracked");',
              "assert.ok(tracked !== undefined);",
              "assert.equal(tracked.result.snapshot.snapshot, snapshot);",
              "assert.match(tracked.result.body, /Home Atlas/u);",
              'assert.equal(tracked.route[0].objectId, "anchor:root");',
              "assert.ok(tracked.route.length > 1);",
              "};",
              'if (input.mode === "missing-atlas") {',
              "const result = resolveAtlasCache(request, options);",
              'assert.equal(result.state, "unreachable");',
              'const dependencies = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")).dependencies : [];',
              "console.log(JSON.stringify({ state: result.state, code: result.findings[0]?.code, dependencies }));",
              '} else if (input.mode === "first-metadata-cleanup" || input.mode === "first-metadata-cleanup-discarded") {',
              "const first = resolveAtlasCache(request, options);",
              'assert.equal(first.state, "resolved");',
              "rmSync(first.snapshot.cacheDirectory, { recursive: true });",
              "const original = { openSync: fs.openSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync };",
              "const files = new Map(); const artifacts = new Set(); let injected = false;",
              "fs.openSync = (...args) => { const path = String(args[0]); const fd = original.openSync(...args); files.set(fd, path); if (path.includes('metadata.json.pending-')) artifacts.add(path); return fd; };",
              "fs.writeFileSync = (...args) => {",
              'const file = typeof args[0] === "number" ? files.get(args[0]) : String(args[0]);',
              'if (!injected && file?.includes("metadata.json") === true) { original.writeFileSync(args[0], \'{"dependencies":[\', args[2]); injected = true; throw new Error("Fixture partial metadata write failure"); }',
              "return original.writeFileSync(...args);",
              "};",
              'fs.renameSync = (...args) => { if (input.mode === "first-metadata-cleanup-discarded" && String(args[0]).includes(`${sep}.pending-`) && String(args[1]) === first.snapshot.cacheDirectory) { injected = true; throw new Error("Fixture cache publication failure"); } return original.renameSync(...args); };',
              'fs.rmSync = (...args) => { if (artifacts.has(String(args[0]))) throw new Error("Fixture metadata cleanup failure"); return original.rmSync(...args); };',
              "syncBuiltinESMExports(); let result;",
              "try { result = explore(options); } finally { Object.assign(fs, original); syncBuiltinESMExports(); }",
              'const cleanup = result.payload.maintenanceFindings.find(({ code }) => code === "ATLAS_CROSS_ATLAS_CACHE_CLEANUP_FAILED");',
              "assert.ok(cleanup !== undefined);",
              "const staged = [...artifacts].find((path) => path.includes(`${sep}.pending-`));",
              "assert.ok(staged !== undefined);",
              "assert.equal(existsSync(staged), false);",
              'assert.deepEqual(result.payload.maintenanceFindings.map(({ code }) => code), ["ATLAS_CROSS_ATLAS_CACHE_CLEANUP_FAILED", "ATLAS_CROSS_ATLAS_CACHE_METADATA_WRITE_FAILED"]);',
              'if (input.mode === "first-metadata-cleanup") {',
              'verifyExplore(result, first.snapshot.snapshot, true, ["ATLAS_CROSS_ATLAS_CACHE_CLEANUP_FAILED", "ATLAS_CROSS_ATLAS_CACHE_METADATA_WRITE_FAILED"]);',
              "assert.ok(cleanup.path.startsWith(first.snapshot.cacheDirectory));",
              'assert.equal(readFileSync(cleanup.path, "utf8"), \'{"dependencies":[\');',
              "rmSync(cleanup.path);",
              'console.log(JSON.stringify({ state: "resolved", code: "ATLAS_CROSS_ATLAS_CACHE_CLEANUP_FAILED", offlineCode: "ATLAS_CROSS_ATLAS_CACHE_CLEANUP_FAILED" }));',
              "} else {",
              'assert.equal(result.completion, "completed"); assert.equal(result.disposition, "success");',
              'assert.equal(result.handoff.unresolvedHumanDecisions.state, "pending");',
              'assert.deepEqual(result.payload.degradation.diagnostics.map(({ code }) => code), ["ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE"]);',
              'assert.ok(result.payload.results.some(({ result: item }) => item.snapshot?.role === "home"));',
              'assert.equal(result.payload.results.some(({ result: item }) => item.snapshot?.role === "tracked"), false);',
              "assert.equal(existsSync(dirname(staged)), false); assert.equal(existsSync(first.snapshot.cacheDirectory), false);",
              "assert.notEqual(cleanup.path, staged); assert.doesNotMatch(cleanup.message, /Inspect the retained file/u);",
              'console.log(JSON.stringify({ state: "resolved", code: "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE", offlineCode: "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE" }));',
              "}",
              '} else if (input.mode === "invalid-lock-on-update") {',
              "const first = resolveAtlasCache(request, options);",
              'assert.equal(first.state, "resolved");',
              'const metadataPath = join(first.snapshot.cacheDirectory, "metadata.json");',
              'const validDependency = JSON.parse(readFileSync(metadataPath, "utf8"));',
              'const unrelatedLocator = atlasLocatorFromParts({ host: "github.com", owner: "fixture", repository: "unrelated", branch: "main", atlasPath: "." });',
              "const unrelatedCacheKey = atlasCacheKey(unrelatedLocator);",
              'const fields = ["cacheKey", "fetchedAt", "introducedByAnchorId", "introducedByEdgeId", "locator", "slug", "snapshot"];',
              'const locatorFields = ["atlasPath", "branch", "canonicalRepository", "host", "owner", "repository"];',
              "const without = (field) => { const dependency = { ...validDependency }; delete dependency[field]; return JSON.stringify({ dependencies: [dependency] }); };",
              "const wrong = (field) => JSON.stringify({ dependencies: [{ ...validDependency, [field]: 0 }] });",
              "const invalidLocator = (field, value) => JSON.stringify({ dependencies: [{ ...validDependency, locator: value === undefined ? Object.fromEntries(Object.entries(validDependency.locator).filter(([key]) => key !== field)) : { ...validDependency.locator, [field]: value } }] });",
              'const invalidLocks = [\'{"dependencies":null}\', \'{"dependencies":[null]}\', \'{"dependencies":[\', "42", "null", "[]", \'{"dependencies":[{"cacheKey":" "}]}\', JSON.stringify({ dependencies: [{ cacheKey: unrelatedCacheKey }] }), ...fields.flatMap((field) => [without(field), wrong(field)]), ...locatorFields.flatMap((field) => [invalidLocator(field, undefined), invalidLocator(field, 0)]), JSON.stringify({ dependencies: [{ ...validDependency, slug: { value: 0 } }] })];',
              'const remoteGit = (args) => execFileSync("git", args, { cwd: input.remote, encoding: "utf8", timeout: 30000 }).trim();',
              'writeFileSync(join(input.remote, "README.md"), "# Repository advanced while Lock is malformed\\n");',
              'remoteGit(["add", "README.md"]);',
              'remoteGit(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Advance malformed Lock fixture"]);',
              'const updatedSnapshot = remoteGit(["rev-parse", "HEAD"]);',
              'now = "2026-09-01T00:00:00Z";',
              'for (const phase of ["update", "first"]) {',
              "for (const bytes of invalidLocks) {",
              "writeFileSync(lockPath, bytes);",
              'if (phase === "first") rmSync(first.snapshot.cacheDirectory, { recursive: true });',
              "const updated = explore(options);",
              'verifyExplore(updated, updatedSnapshot, true, ["ATLAS_CROSS_ATLAS_LOCK_REPAIR_FAILED"]);',
              'assert.equal(readFileSync(lockPath, "utf8"), bytes);',
              'const updatedMetadata = JSON.parse(readFileSync(join(first.snapshot.cacheDirectory, "metadata.json"), "utf8"));',
              "assert.equal(updatedMetadata.snapshot, updatedSnapshot);",
              'assert.equal(updatedMetadata.fetchedAt, "2026-09-01T00:00:00Z");',
              "}}",
              "const matchingIncomplete = JSON.stringify({ dependencies: [{ cacheKey: validDependency.cacheKey }] });",
              "writeFileSync(lockPath, matchingIncomplete);",
              "renameSync(input.remote, `${input.remote}-offline`);",
              "const malformedOffline = explore(options);",
              'verifyExplore(malformedOffline, updatedSnapshot, false, ["ATLAS_CROSS_ATLAS_LOCK_REPAIR_FAILED"]);',
              'assert.equal(readFileSync(lockPath, "utf8"), matchingIncomplete);',
              "rmSync(lockPath);",
              "const recovered = explore(options);",
              "verifyExplore(recovered, updatedSnapshot, false, []);",
              'const recoveryMetadata = JSON.parse(readFileSync(join(first.snapshot.cacheDirectory, "metadata.json"), "utf8"));',
              'assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf8")), createAtlasLock([recoveryMetadata]));',
              'assert.equal(recoveryMetadata.fetchedAt, "2026-09-01T00:00:00Z");',
              "assert.match(recoveryMetadata.introducedByAnchorId, /^anchor:/u);",
              "assert.match(recoveryMetadata.introducedByEdgeId, /^edge:/u);",
              'console.log(JSON.stringify({ state: "resolved", code: "ATLAS_CROSS_ATLAS_LOCK_REPAIR_FAILED", offlineCode: "ATLAS_CROSS_ATLAS_LOCK_REPAIR_FAILED" }));',
              '} else if (input.mode === "lock-persistence") {',
              "const first = resolveAtlasCache(request, options);",
              'assert.equal(first.state, "resolved");',
              'const metadataPath = join(first.snapshot.cacheDirectory, "metadata.json");',
              "const metadataBytes = readFileSync(metadataPath);",
              'const metadata = JSON.parse(metadataBytes.toString("utf8"));',
              'const otherLocator = atlasLocatorFromParts({ host: "github.com", owner: "fixture", repository: "other", branch: "main", atlasPath: "." });',
              "const other = { ...metadata, cacheKey: atlasCacheKey(otherLocator), locator: otherLocator, slug: deriveAtlasSlug(otherLocator) };",
              'const previousLock = JSON.stringify({ dependencies: [other] }, null, 2) + "\\n";',
              "renameSync(input.remote, `${input.remote}-offline`);",
              'now = "2026-09-01T00:00:00Z";',
              'for (const fault of ["second-read", "partial-write", "replacement", "creation-conflict", "cleanup-failure"]) {',
              "writeFileSync(lockPath, previousLock);",
              "const original = { openSync: fs.openSync, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync };",
              "const files = new Map(); const artifacts = new Set(); let reads = 0; let injected = false;",
              "fs.openSync = (...args) => {",
              'const path = String(args[0]); if (fault === "creation-conflict" && path.startsWith(lockPath)) { original.writeFileSync(path, "Other owner"); artifacts.add(path); injected = true; }',
              "const fd = original.openSync(...args); files.set(fd, path); if (path.startsWith(lockPath)) artifacts.add(path); return fd;",
              "};",
              "fs.readFileSync = (...args) => {",
              'if (String(args[0]) === lockPath && ++reads === 2 && fault === "second-read") { injected = true; throw new Error("Fixture second Lock read failure"); }',
              "return original.readFileSync(...args);",
              "};",
              "fs.writeFileSync = (...args) => {",
              'const file = typeof args[0] === "number" ? files.get(args[0]) : String(args[0]);',
              'if (["partial-write", "cleanup-failure"].includes(fault) && file?.startsWith(lockPath)) { original.writeFileSync(args[0], \'{"dependencies":[\', args[2]); injected = true; throw new Error("Fixture partial Lock write failure"); }',
              "return original.writeFileSync(...args);",
              "};",
              "fs.renameSync = (...args) => {",
              'if (fault === "replacement" && String(args[1]) === lockPath) { injected = true; assert.deepEqual(JSON.parse(original.readFileSync(args[0], "utf8")), createAtlasLock([other, metadata])); throw new Error("Fixture Lock replacement failure"); }',
              "return original.renameSync(...args);",
              "};",
              'fs.rmSync = (...args) => { if (fault === "cleanup-failure" && artifacts.has(String(args[0]))) throw new Error("Fixture cleanup failure"); return original.rmSync(...args); };',
              "syncBuiltinESMExports(); let result;",
              "try { result = explore(options); } finally { Object.assign(fs, original); syncBuiltinESMExports(); }",
              'const expected = fault === "second-read" ? [] : [...(fault === "cleanup-failure" ? ["ATLAS_CROSS_ATLAS_CACHE_CLEANUP_FAILED"] : []), "ATLAS_CROSS_ATLAS_LOCK_REPAIR_FAILED"];',
              "verifyExplore(result, first.snapshot.snapshot, false, expected);",
              "assert.deepEqual(readFileSync(metadataPath), metadataBytes);",
              'if (fault === "second-read") { assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf8")), createAtlasLock([other, metadata])); }',
              'else { assert.equal(injected, true); assert.equal(readFileSync(lockPath, "utf8"), previousLock); }',
              "for (const path of artifacts) {",
              'if (["creation-conflict", "cleanup-failure"].includes(fault)) { assert.equal(readFileSync(path, "utf8"), fault === "creation-conflict" ? "Other owner" : \'{"dependencies":[\'); if (fault === "cleanup-failure") assert.equal(result.payload.maintenanceFindings[0].path, path); rmSync(path); }',
              'else assert.equal(existsSync(path), false, "Unpublished owned file must be cleaned up");',
              "}",
              "}",
              'console.log(JSON.stringify({ state: "resolved", code: "ATLAS_CROSS_ATLAS_LOCK_REPAIR_FAILED", offlineCode: "ATLAS_CROSS_ATLAS_LOCK_REPAIR_FAILED" }));',
              '} else if (input.mode === "unrecorded-publication") {',
              "const first = resolveAtlasCache(request, {",
              "  ...options,",
              "  readGit(repository, args) {",
              '    if (!repository.includes(".pending-") && args[0] === "rev-parse" && args[1] === "refs/heads/main") return { state: "failed", reason: "Fixture published Snapshot read failure" };',
              '    const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8", timeout: 30000 });',
              '    return result.status === 0 ? { state: "succeeded", stdout: result.stdout, stderr: result.stderr } : { state: "failed", reason: result.error?.message ?? result.stderr };',
              "  },",
              "});",
              'assert.equal(first.state, "unreachable");',
              "assert.equal(existsSync(lockPath), false);",
              'const metadataPath = join(input.home, ".atlas", "atlas-cache", "atlases", atlasCacheKey(locator), "metadata.json");',
              "const metadataBytes = readFileSync(metadataPath);",
              'const metadata = JSON.parse(metadataBytes.toString("utf8"));',
              'assert.equal(metadata.fetchedAt, "2026-08-30T00:00:00Z");',
              "renameSync(input.remote, `${input.remote}-offline`);",
              'now = "2026-09-01T00:00:00Z";',
              'const recovered = resolveAtlasCache({ ...request, introducedByAnchorId: "anchor:later", introducedByEdgeId: "edge:later" }, options);',
              'assert.equal(recovered.state, "resolved");',
              "assert.equal(recovered.snapshot.snapshot, metadata.snapshot);",
              'assert.equal(existsSync(lockPath), true, "Usable offline dependency must be recorded");',
              "const lockBytes = readFileSync(lockPath);",
              'assert.deepEqual(JSON.parse(lockBytes.toString("utf8")), { dependencies: [metadata] });',
              "assert.deepEqual(readFileSync(metadataPath), metadataBytes);",
              "const repeated = resolveAtlasCache(request, options);",
              'assert.equal(repeated.state, "resolved");',
              "assert.deepEqual(repeated.snapshot.capturedFiles, recovered.snapshot.capturedFiles);",
              "assert.deepEqual(readFileSync(lockPath), lockBytes);",
              "assert.deepEqual(readFileSync(metadataPath), metadataBytes);",
              "console.log(JSON.stringify({ state: recovered.state, code: recovered.snapshot.findings[0]?.code, offlineCode: repeated.snapshot.findings[0]?.code }));",
              "} else {",
              "const first = resolveAtlasCache(request, options);",
              'assert.equal(first.state, "resolved");',
              "assert.deepEqual(first.snapshot.findings, []);",
              'const metadataPath = join(first.snapshot.cacheDirectory, "metadata.json");',
              "const previousLock = readFileSync(lockPath);",
              "const previousMetadata = readFileSync(metadataPath);",
              'const git = (args) => execFileSync("git", args, { cwd: input.remote, encoding: "utf8", timeout: 30000 });',
              'if (input.mode === "uncapturable-update") {',
              'git(["rm", "-r", ".atlas"]);',
              'git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Remove the remote Atlas"]);',
              "}",
              'now = "2026-09-01T00:00:00Z";',
              "const updated = resolveAtlasCache(request, options);",
              'assert.equal(updated.state, "resolved");',
              "assert.equal(updated.snapshot.snapshot, first.snapshot.snapshot);",
              "assert.deepEqual(updated.snapshot.capturedFiles, first.snapshot.capturedFiles);",
              "assert.deepEqual(readFileSync(lockPath), previousLock);",
              "assert.deepEqual(readFileSync(metadataPath), previousMetadata);",
              "renameSync(input.remote, `${input.remote}-offline`);",
              "const offline = resolveAtlasCache(request, options);",
              'assert.equal(offline.state, "resolved");',
              "assert.equal(offline.snapshot.snapshot, first.snapshot.snapshot);",
              "assert.deepEqual(offline.snapshot.capturedFiles, first.snapshot.capturedFiles);",
              "assert.deepEqual(readFileSync(lockPath), previousLock);",
              "assert.deepEqual(readFileSync(metadataPath), previousMetadata);",
              "console.log(JSON.stringify({ state: updated.state, code: updated.snapshot.findings[0]?.code, offlineCode: offline.snapshot.findings[0]?.code }));",
              "}",
            ].join("\n"),
          ],
          {
            cwd: consumer,
            encoding: "utf8",
            env: consumerEnvironment(guard),
            killSignal: "SIGKILL",
            timeout: 120_000,
          },
        );
        assert.equal(probe.error, undefined);
        assert.equal(probe.status, 0, probe.stderr);
        assert.equal(probe.stderr, "");
        assert.deepEqual(
          JSON.parse(probe.stdout),
          entry.cacheFailure.mode === "missing-atlas"
            ? {
                code: entry.cacheFailure.expectedCode,
                dependencies: [],
                state: "unreachable",
              }
            : {
                code: entry.cacheFailure.expectedCode,
                offlineCode: entry.cacheFailure.expectedCode,
                state: "resolved",
              },
        );
        assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), beforeHead);
        assert.deepEqual(
          readFileSync(join(consumer, ".atlas", "index.md")),
          beforeRoot,
        );
        assert.equal(consumerGit(consumer, ["status", "--porcelain"]), "");
      }
      if (entry.connectedExplore !== undefined) {
        const probe = entry.connectedExplore;
        const remote = join(workspace, "connected-explore");
        mkdirSync(remote);
        consumerGit(remote, ["init", "--quiet", "--initial-branch=main"]);
        const rootBytes = readFileSync(join(consumer, ".atlas", "index.md"));
        mkdirSync(join(remote, ".atlas"));
        writeFileSync(join(remote, ".atlas", "index.md"), rootBytes);
        for (const path of [
          ".atlas/anchors/lint.md",
          ".atlas/concepts/canonical-serialization.md",
          ".atlas/edges/lint-covers-canonical-serialization.md",
          ".atlas/sources/atlas-sdk-lint.md",
        ]) {
          const bytes = readFileSync(join(ROOT, "tests/fixtures/complete-atlas", path));
          for (const host of [consumer, remote]) {
            mkdirSync(dirname(join(host, path)), { recursive: true });
            writeFileSync(join(host, path), bytes);
          }
        }
        const commitFixture = (host: string, message: string) => {
          consumerGit(host, ["add", "."]);
          consumerGit(host, [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            message,
          ]);
          return consumerGit(host, ["rev-parse", "HEAD"]);
        };
        const track = (repository: string) => {
          const tracked = probeAtlasIngestSource({
            approvedAt: "2026-08-25T00:00:00Z",
            approvedBy: "Fixture Maintainer",
            asOf: "2026-08-25T00:00:00Z",
            atlasPath: ".",
            branch: "main",
            fromAnchorId: "anchor:root",
            repositoryLocator: `https://github.com/fixture/${repository}.git`,
            title: repository,
          });
          assert.equal(tracked.state, "tracked-atlas");
          for (const change of tracked.changes) {
            mkdirSync(dirname(join(consumer, change.path)), { recursive: true });
            writeFileSync(join(consumer, change.path), change.content);
          }
          return tracked.changes.map(({ path }) => path);
        };
        const verifyCatalogHop = (
          result: ExploreOperationResult,
          found: ExploreOperationResult["payload"]["results"][number],
        ) => {
          const hop = found.route.find(
            ({ objectId }) => objectId === probe.expectedCatalogTargetId,
          );
          assert.ok(hop);
          assert.equal(Object.hasOwn(hop, "edgeId"), false);
          assert.deepEqual(hop.catalogFallback, {
            anchorId: entry.expectedRootAnchorId,
          });
          const anchor = result.payload.reanchors[hop.reanchorIndex ?? -1]?.anchor;
          assert.equal(anchor?.id, entry.expectedRootAnchorId);
          assert.equal(anchor.path, ".atlas/index.md");
          assert.deepEqual(anchor.snapshot, hop.snapshot);
          assert.equal(found.route[0]?.catalogFallback, undefined);
          assert.equal(found.route.at(-1)?.catalogFallback, undefined);
          for (const step of found.route.slice(1)) {
            assert.ok(
              step.catalogFallback !== undefined || typeof step.edgeId === "string",
            );
          }
        };
        let remoteHead = commitFixture(remote, "Seed connected knowledge");
        let homeHead = commitFixture(consumer, "Seed Home catalog knowledge");
        const singleArguments = [
          "explore",
          "--machine",
          probe.query,
          "--atlas-host-directory",
          consumer,
        ];
        const single = runInstalled(consumer, guard, singleArguments);
        assert.equal(single.status, 0, single.stderr);
        assert.equal(single.stderr, "");
        const repeatedSingle = runInstalled(consumer, guard, singleArguments);
        assert.equal(repeatedSingle.status, 0, repeatedSingle.stderr);
        assert.equal(repeatedSingle.stdout, single.stdout);
        const singleResult = parseMachineOperationResult(
          single.stdout,
        ) as ExploreOperationResult;
        const singleFound = singleResult.payload.results.find(
          ({ result }) => result.id === probe.expectedConceptId,
        );
        assert.ok(singleFound);
        verifyCatalogHop(singleResult, singleFound);
        assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), homeHead);
        assert.equal(consumerGit(consumer, ["status", "--porcelain"]), "");
        assert.deepEqual(readFileSync(join(consumer, ".atlas/index.md")), rootBytes);
        const moduleSource = [
          'import assert from "node:assert/strict";',
          'import { execFileSync, spawnSync } from "node:child_process";',
          'import { resolveAtlasCache, runExploreOperation } from "@jdylanmc/atlas";',
          "const inputText = process.argv[1];",
          "assert.ok(inputText !== undefined);",
          "const input = JSON.parse(inputText);",
          'assert.equal(typeof input.home, "string");',
          'assert.equal(typeof input.query, "string");',
          'assert.ok(input.remotes !== null && typeof input.remotes === "object");',
          "const cleanupOptions = input.failCleanup === true ? {",
          "  writeGit(repository, args) {",
          '    if (args[0] === "update-ref" && args[1] === "-d") return { state: "failed", reason: "Fixture temporary-reference cleanup failure" };',
          '    const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8", timeout: 30000 });',
          '    return result.status === 0 ? { state: "succeeded", stdout: result.stdout, stderr: result.stderr } : { state: "failed", reason: result.error?.message ?? result.stderr };',
          "  },",
          "} : {};",
          'const git = (args) => execFileSync("git", ["-C", input.home, ...args], { timeout: 30000 });',
          'const snapshot = git(["rev-parse", "HEAD"]).toString("utf8").trim();',
          'const paths = git(["ls-tree", "-rz", "--name-only", snapshot, "--", ".atlas"]).toString("utf8").split("\\0").filter(Boolean);',
          "const result = runExploreOperation({",
          "  atlasCacheResolver: {",
          "    resolve(request) {",
          "      const remote = input.remotes[request.trackedAtlas.locator.repository];",
          '      assert.equal(typeof remote, "string", "No Git fixture for this tracked Atlas");',
          "      return resolveAtlasCache(",
          "        { ...request, homeAtlasDirectory: input.home },",
          "        { ...cleanupOptions, resolveRemote: () => remote },",
          "      );",
          "    },",
          "  },",
          '  baseSnapshot: { reference: snapshot, state: "known" },',
          '  capturedFiles: paths.map((path) => ({ bytes: git(["show", `${snapshot}:${path}`]), path })),',
          '  homeAtlas: { reference: "local-home-atlas", state: "known" },',
          "  query: input.query,",
          "});",
          "process.stdout.write(`${JSON.stringify(result)}\\n`);",
        ].join("\n");
        const runModule = (failCleanup = false) => {
          const result = spawnSync(
            process.execPath,
            [
              "--input-type=module",
              "--eval",
              moduleSource,
              JSON.stringify({
                failCleanup,
                home: consumer,
                query: probe.query,
                remotes: {
                  "connected-explore": remote,
                  "never-cached": join(workspace, "never-cached"),
                },
              }),
            ],
            {
              cwd: consumer,
              encoding: "utf8",
              env: consumerEnvironment(guard),
              killSignal: "SIGKILL",
              timeout: 120_000,
            },
          );
          assert.equal(result.error, undefined);
          assert.equal(result.status, 0, result.stderr);
          assert.equal(result.stderr, "");
          return parseMachineOperationResult(result.stdout) as ExploreOperationResult;
        };
        const verifyContext = (
          result: ExploreOperationResult,
          codes: readonly string[],
          withTracked = true,
        ) => {
          assert.equal(result.completion, "completed");
          assert.equal(result.disposition, "success");
          assert.equal(result.handoff.baseSnapshot.state, "known");
          assert.equal(result.handoff.baseSnapshot.reference, homeHead);
          assert.deepEqual(
            result.payload.degradation.diagnostics.map(({ code }) => code).toSorted(),
            codes.toSorted(),
          );
          assert.equal(
            result.handoff.degradationState.state,
            codes.length === 0 ? "not-degraded" : "degraded",
          );
          for (const role of ["home", "tracked"] as const) {
            if (role === "tracked" && !withTracked) {
              assert.ok(
                result.payload.results.every(
                  ({ result: item }) => item.snapshot?.role === "home",
                ),
              );
              continue;
            }
            const found = result.payload.results.find(
              ({ result: item }) =>
                item.id === probe.expectedConceptId && item.snapshot?.role === role,
            );
            assert.ok(
              found !== undefined,
              `Missing ${role} Concept: ${JSON.stringify(result)}`,
            );
            const expectedSnapshot = role === "home" ? homeHead : remoteHead;
            assert.equal(found.result.snapshot?.snapshot, expectedSnapshot);
            assert.equal(
              found.result.snapshot.slug,
              role === "home" ? "local-home-atlas" : probe.expectedTrackedSlug,
            );
            assert.match(found.result.body, /\[\^sdk-lint\]/u);
            assert.equal(found.route[0]?.objectId, entry.expectedRootAnchorId);
            assert.equal(found.route[0].snapshot?.role, "home");
            assert.equal(found.route.at(-1)?.objectId, probe.expectedConceptId);
            assert.equal(
              found.route.at(-1)?.edgeId,
              "edge:lint-covers-canonical-serialization",
            );
            verifyCatalogHop(result, found);
            const citation = found.citedContext.find(
              ({ id }) => id === probe.expectedSourceId,
            );
            assert.ok(citation !== undefined);
            assert.ok(citation.body.includes(probe.expectedSourceText));
            assert.equal(citation.snapshot?.role, role);
            assert.equal(citation.snapshot.snapshot, expectedSnapshot);
            if (role === "tracked") {
              assert.ok(
                found.route.some(
                  (step) =>
                    step.objectId === "anchor:root" &&
                    step.snapshot?.role === "tracked",
                ),
              );
              assert.ok(
                result.payload.reanchors.some(
                  ({ anchor }) =>
                    anchor.id === "anchor:root" && anchor.snapshot?.role === "tracked",
                ),
              );
            }
          }
          assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), homeHead);
          assert.equal(consumerGit(consumer, ["status", "--porcelain"]), "");
          assert.deepEqual(
            readFileSync(join(consumer, ".atlas", "index.md")),
            rootBytes,
          );
        };
        const lockPath = join(consumer, ".atlas", "atlas-cache", "atlas-lock.json");
        const unavailablePaths = track("never-cached");
        homeHead = commitFixture(consumer, "Track an unavailable first connection");
        const firstContact = runModule();
        verifyContext(
          firstContact,
          ["ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE"],
          false,
        );
        assert.equal(firstContact.handoff.unresolvedHumanDecisions.state, "pending");
        assert.equal(existsSync(lockPath), false);
        consumerGit(consumer, ["rm", "--", ...unavailablePaths]);
        track("connected-explore");
        homeHead = commitFixture(consumer, "Track connected fixture knowledge");
        verifyContext(runModule(), []);
        const lock = JSON.parse(readFileSync(lockPath, "utf8")) as AtlasLock;
        assert.equal(lock.dependencies.length, 1);
        const dependency = lock.dependencies[0];
        assert.ok(dependency !== undefined);
        assert.equal(dependency.slug.value, probe.expectedTrackedSlug);
        assert.equal(dependency.snapshot, remoteHead);
        const cacheDirectory = join(
          consumer,
          ".atlas",
          "atlas-cache",
          "atlases",
          dependency.cacheKey,
        );
        // Only this disposable bare repository maps the canonical URL to real local Git transport.
        consumerGit(join(cacheDirectory, "repository.git"), [
          "config",
          `url.${remote}.insteadOf`,
          "https://github.com/fixture/connected-explore.git",
        ]);
        const runCli = () => {
          const result = runInstalled(consumer, guard, [
            "explore",
            "--machine",
            probe.query,
            "--atlas-host-directory",
            consumer,
          ]);
          assert.equal(result.status, exploreCommandExitCodes.success, result.stdout);
          assert.equal(result.stderr, "");
          return parseMachineOperationResult(result.stdout) as ExploreOperationResult;
        };
        verifyContext(runCli(), []);
        if (probe.cleanupFailureCode !== undefined) {
          const conceptPath = join(
            remote,
            ".atlas/concepts/canonical-serialization.md",
          );
          writeFileSync(
            conceptPath,
            `${readFileSync(conceptPath, "utf8")}\nCurrent fixture revision.[^sdk-lint]\n`,
          );
          remoteHead = commitFixture(remote, "Update tracked knowledge");
          const cleanup = runModule(true);
          verifyContext(cleanup, []);
          assert.equal(cleanup.payload.degradation.level, "valid-structured");
          assert.equal(cleanup.handoff.validationState.state, "passed");
          assert.equal(cleanup.handoff.unresolvedHumanDecisions.state, "none");
          assert.deepEqual(
            cleanup.payload.maintenanceFindings?.map(({ code }) => code),
            [probe.cleanupFailureCode],
          );
          assert.ok(
            cleanup.payload.results.some(
              ({ result }) =>
                result.snapshot?.role === "tracked" &&
                result.body.includes("Current fixture revision."),
            ),
          );
        }
        const previousLock = readFileSync(lockPath);
        const previousMetadata = readFileSync(join(cacheDirectory, "metadata.json"));
        renameSync(remote, `${remote}-offline`);
        verifyContext(runCli(), ["ATLAS_CROSS_ATLAS_CACHED_OFFLINE"]);
        verifyContext(runModule(), ["ATLAS_CROSS_ATLAS_CACHED_OFFLINE"]);
        track("never-cached");
        homeHead = commitFixture(consumer, "Track an unavailable fixture");
        const missing = runModule();
        verifyContext(missing, [
          "ATLAS_CROSS_ATLAS_CACHED_OFFLINE",
          "ATLAS_CROSS_ATLAS_FIRST_CONTACT_UNREACHABLE",
        ]);
        assert.equal(missing.handoff.unresolvedHumanDecisions.state, "pending");
        assert.deepEqual(readFileSync(lockPath), previousLock);
        assert.deepEqual(
          readFileSync(join(cacheDirectory, "metadata.json")),
          previousMetadata,
        );
      }
      if (entry.retirement !== undefined) {
        exerciseGovernanceRetirement(consumer, entry.retirement, (arguments_) =>
          runInstalled(consumer, guard, arguments_),
        );
      }
      if (principleExample !== undefined) {
        const fields = {
          "governance-request-schema": "1.0.0" as const,
          action: "create" as const,
          subject: "principle" as const,
          changelog:
            "Created the fixture Quality Principle from the CLI authoring reference.",
          changes: [
            {
              path: principleExample.path,
              content: principleExample.content.replaceAll(
                "Example Maintainer",
                "Fixture Maintainer",
              ),
            },
          ],
        };
        const operation = governanceAttestationOperation(fields);
        const nonce = "installed-cli-authoring-reference";
        const requestPath = join(workspace, "documented-principle.json");
        writeFileSync(
          requestPath,
          JSON.stringify({
            ...fields,
            attestation: {
              "approval-attestation-schema": "1.0.0",
              approvedAt: "2026-08-22T00:00:00Z",
              approver: "Fixture Maintainer",
              nonce,
              operation,
              payloadDigest: attestationPayloadDigest(
                operation,
                nonce,
                governanceAttestationPayload(fields),
              ),
            },
          }),
        );
        const governed = runInstalled(consumer, guard, [
          "govern",
          "--machine",
          "--request",
          requestPath,
          "--atlas-host-directory",
          consumer,
        ]);
        assert.equal(governed.status, 0, governed.stdout);
        assert.equal(governed.stderr, "");
        const result = parseMachineOperationResult(
          governed.stdout,
        ) as AtlasGovernanceResult;
        assert.equal(result.completion, "completed");
        assert.equal(result.disposition, "success");
        const proposedBranch = result.payload.workflowState.proposalBranch;
        const proposedPage = consumerGitRaw(consumer, [
          "show",
          `${proposedBranch}:${principleExample.path}`,
        ]);
        assert.match(proposedPage, /id: principle:quality/u);
        assert.match(proposedPage, /## Amendments/u);
        if (entry.governanceTreeReceipt === true) {
          const writeReceipt = result.payload.workflowState.effectReceipts.find(
            ({ effect }) => effect === "write-change-set",
          );
          assert.ok(writeReceipt);
          assert.equal(
            writeReceipt.receipt,
            consumerGit(consumer, ["rev-parse", `${proposedBranch}^{tree}`]),
          );
          assert.equal(proposedPage, fields.changes[0]?.content);
          assert.equal(
            consumerGitRaw(consumer, ["show", `${proposedBranch}:package.json`]),
            consumerGitRaw(consumer, ["show", "HEAD:package.json"]),
          );

          const aliasFields = {
            ...fields,
            changes: [
              {
                path: ".atlas/principles/installed-alias.md",
                content: principleExample.content.replace(
                  "id: principle:quality",
                  "id: principle:installed-alias",
                ),
              },
              {
                path: ".atlas/PRINCIPLES/installed-alias.md",
                content: principleExample.content.replace(
                  "id: principle:quality",
                  "id: principle:installed-alias",
                ),
              },
            ],
          };
          const aliasOperation = governanceAttestationOperation(aliasFields);
          const aliasNonce = "installed-governance-path-alias";
          const aliasRequestPath = join(workspace, "governance-path-alias.json");
          writeFileSync(
            aliasRequestPath,
            JSON.stringify({
              ...aliasFields,
              attestation: {
                "approval-attestation-schema": "1.0.0",
                approvedAt: "2026-08-22T00:00:00Z",
                approver: "Fixture Maintainer",
                nonce: aliasNonce,
                operation: aliasOperation,
                payloadDigest: attestationPayloadDigest(
                  aliasOperation,
                  aliasNonce,
                  governanceAttestationPayload(aliasFields),
                ),
              },
            }),
          );
          const aliasResult = runInstalled(consumer, guard, [
            "govern",
            "--machine",
            "--request",
            aliasRequestPath,
            "--atlas-host-directory",
            consumer,
          ]);
          assert.equal(
            aliasResult.status,
            governCommandExitCodes.operationFailed,
            aliasResult.stdout,
          );
          assert.deepEqual(
            (
              parseMachineOperationResult(aliasResult.stdout) as AtlasGovernanceResult
            ).handoff.validationState.findings.map(({ code }) => code),
            ["ATLAS_GOVERNANCE_CHANGE_PATH_COLLISION"],
          );

          const driftGuard = join(workspace, "git-drift-guard.mjs");
          writeFileSync(
            driftGuard,
            [
              'import childProcess from "node:child_process";',
              'import { readFileSync } from "node:fs";',
              'import { join } from "node:path";',
              'import { syncBuiltinESMExports } from "node:module";',
              "const originalSpawnSync = childProcess.spawnSync;",
              'const target = ".atlas/principles/quality-filtered.md";',
              "childProcess.spawnSync = function driftOneObjectWrite(command, arguments_, options) {",
              '  const hashIndex = arguments_?.indexOf("hash-object") ?? -1;',
              '  if (hashIndex >= 0 && arguments_?.includes("--no-filters") && arguments_.at(-1) === target) {',
              '    const repository = arguments_[arguments_.indexOf("-C") + 1];',
              '    const content = readFileSync(join(repository, target), "utf8").replaceAll("Fixture", "Drifted");',
              '    const driftArguments = [...arguments_.slice(0, hashIndex), "hash-object", "-w", "--stdin"];',
              "    return originalSpawnSync(command, driftArguments, { ...options, input: content });",
              "  }",
              "  return originalSpawnSync(command, arguments_, options);",
              "};",
              "syncBuiltinESMExports();",
            ].join("\n"),
          );
          writeFileSync(
            join(consumer, "host-note.txt"),
            "Host content must survive Governance proposals.\n",
          );
          consumerGit(consumer, ["add", "host-note.txt"]);
          consumerGit(consumer, ["commit", "-m", "test: advance host content"]);
          const driftTargetHead = consumerGit(consumer, ["rev-parse", "HEAD"]);
          const commitCount = consumerGit(consumer, ["rev-list", "--all", "--count"]);
          const driftFields = {
            ...fields,
            changes: [
              {
                path: ".atlas/principles/quality-filtered.md",
                content: (fields.changes[0]?.content ?? "").replace(
                  "id: principle:quality",
                  "id: principle:quality-filtered",
                ),
              },
            ],
          };
          const driftOperation = governanceAttestationOperation(driftFields);
          const driftNonce = "installed-governance-written-drift";
          const driftRequestPath = join(workspace, "governance-written-drift.json");
          writeFileSync(
            driftRequestPath,
            JSON.stringify({
              ...driftFields,
              attestation: {
                "approval-attestation-schema": "1.0.0",
                approvedAt: "2026-08-22T00:00:00Z",
                approver: "Fixture Maintainer",
                nonce: driftNonce,
                operation: driftOperation,
                payloadDigest: attestationPayloadDigest(
                  driftOperation,
                  driftNonce,
                  governanceAttestationPayload(driftFields),
                ),
              },
            }),
          );
          const driftResult = runInstalled(
            consumer,
            guard,
            [
              "govern",
              "--machine",
              "--request",
              driftRequestPath,
              "--atlas-host-directory",
              consumer,
            ],
            [`--import=${pathToFileURL(driftGuard).href}`],
          );
          assert.equal(
            driftResult.status,
            governCommandExitCodes.operationFailed,
            driftResult.stdout,
          );
          const driftGovernance = parseMachineOperationResult(
            driftResult.stdout,
          ) as AtlasGovernanceResult;
          assert.deepEqual(
            driftGovernance.handoff.validationState.findings.map(({ code }) => code),
            ["ATLAS_GOVERNANCE_WRITTEN_CHANGE_SET_MISMATCH"],
          );
          assert.equal(
            driftGovernance.payload.workflowState.effectReceipts.some(
              ({ effect }) =>
                effect === "commit-proposal" || effect === "lint-proposal",
            ),
            false,
          );
          assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), driftTargetHead);
          assert.equal(
            consumerGit(consumer, ["rev-list", "--all", "--count"]),
            commitCount,
          );
        }
        assert.equal(consumerGit(consumer, ["status", "--porcelain"]), "");
      }
      if (entry.governance !== undefined) {
        const fields = {
          "governance-request-schema": "1.0.0" as const,
          action: "create" as const,
          changes: [entry.governance.change],
          changelog: "Created Quality Principle.",
          subject: "principle" as const,
        };
        const operation = governanceAttestationOperation(fields);
        const nonce = "installed-governance-no-duplicates";
        const requestPath = join(workspace, "governance-request.json");
        writeFileSync(
          requestPath,
          JSON.stringify({
            ...fields,
            attestation: {
              "approval-attestation-schema": "1.0.0",
              approvedAt: "2026-08-21T00:00:00Z",
              approver: "Fixture Maintainer",
              nonce,
              operation,
              payloadDigest: attestationPayloadDigest(
                operation,
                nonce,
                governanceAttestationPayload(fields),
              ),
            },
          }),
        );
        const govern = runInstalled(consumer, guard, [
          "govern",
          "--machine",
          "--request",
          requestPath,
          "--atlas-host-directory",
          consumer,
        ]);
        assert.equal(
          govern.status,
          governCommandExitCodes.operationFailed,
          govern.stdout,
        );
        assert.equal(govern.stderr, "");
        const governed = parseMachineOperationResult(
          govern.stdout,
        ) as AtlasGovernanceResult;
        assert.equal(governed.completion, "not-completed");
        assert.equal(governed.disposition, "failed");
        const findings = governed.handoff.validationState.findings;
        assert.deepEqual(
          findings.map(({ code }) => code).toSorted(),
          entry.governance.expectedCodes,
        );
        assert.ok(findings.every(({ path }) => path === entry.governance?.change.path));
        assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), proposal);
        assert.equal(
          consumerGit(consumer, ["branch", "--list", "atlas-governance-*"]),
          "",
        );
        assert.equal(consumerGit(consumer, ["status", "--porcelain"]), "");
      }
      if (entry.citationCorrespondence !== undefined) {
        const probe = entry.citationCorrespondence;
        const sourcePath = join(consumer, "docs", "citation-source.md");
        mkdirSync(join(consumer, "docs"), { recursive: true });
        writeFileSync(sourcePath, probe.sourceContent);
        consumerGit(consumer, ["add", "docs/citation-source.md"]);
        consumerGit(consumer, ["commit", "-m", "test: add citation source"]);
        const revisionTime = consumerGit(consumer, [
          "log",
          "-1",
          "--format=%cI",
          "--",
          "docs/citation-source.md",
        ]);
        const scopeFields = {
          "ingest-scope-schema": "1.0.0" as const,
          asOf: revisionTime,
          authority: "official" as const,
          entryPoint: "docs",
          excludedPaths: [],
          freshnessWindowDays: probe.freshness?.requestWindowDays ?? 30,
          includedPaths: ["docs"],
          maxDepth: 2,
          sourceId: "source:installed-citation",
        };
        const operation = ingestScopeAttestationOperation(scopeFields.sourceId);
        const nonce = "installed-citation-correspondence";
        const request = {
          "ingest-request-schema": "1.0.0" as const,
          candidateGraph: {
            "candidate-graph-schema": "1.0.0" as const,
            concepts: [
              {
                citations: probe.quotations.map((sourceClaim) => ({
                  sourceClaim,
                  sourceId: scopeFields.sourceId,
                })),
                claim: probe.claim,
                id: "concept:installed-citation",
                locator: "docs/citation-source.md",
                title: "Installed Citation",
              },
            ],
            disputes: [],
            edges: [
              {
                citations: [
                  {
                    sourceClaim: probe.quotations[1] as string,
                    sourceId: scopeFields.sourceId,
                  },
                ],
                context: probe.context,
                from: "anchor:root",
                id: "edge:root-covers-installed-citation",
                semantics: ["covers"],
                title: "Root Covers Installed Citation",
                to: "concept:installed-citation",
              },
            ],
            sources: [
              {
                authority: "official" as const,
                content: probe.sourceContent,
                id: scopeFields.sourceId,
                locator: "docs/citation-source.md",
                refreshWindowDays: 30,
                revisionTime,
                title: "Installed Citation Source",
              },
            ],
          },
          scope: {
            ...scopeFields,
            attestation: {
              "approval-attestation-schema": "1.0.0" as const,
              approvedAt: revisionTime,
              approver: "Fixture Maintainer",
              nonce,
              operation,
              payloadDigest: attestationPayloadDigest(
                operation,
                nonce,
                ingestScopeAttestationPayload(scopeFields),
              ),
            },
          },
        };
        const requestPath = join(workspace, "citation-ingest-request.json");
        writeFileSync(requestPath, JSON.stringify(request));
        const ingested = runInstalled(consumer, guard, [
          "ingest",
          "reconcile",
          "--machine",
          "--ingest-request",
          requestPath,
          "--atlas-host-directory",
          consumer,
        ]);
        assert.equal(ingested.status, ingestCommandExitCodes.success, ingested.stdout);
        assert.equal(ingested.stderr, "");
        const result = parseMachineOperationResult(
          ingested.stdout,
        ) as AtlasIngestResult;
        assert.equal(result.completion, "completed");
        const ingestBranch = result.payload.workflowState.proposalBranch;
        const conceptPath = ".atlas/concepts/installed-citation.md";
        const edgePath = ".atlas/edges/root-covers-installed-citation.md";
        const conceptText = consumerGit(consumer, [
          "show",
          `${ingestBranch}:${conceptPath}`,
        ]);
        const edgeText = consumerGit(consumer, ["show", `${ingestBranch}:${edgePath}`]);
        const semanticsPath = join(consumer, "citation-semantics.mjs");
        writeFileSync(
          semanticsPath,
          [
            'import assert from "node:assert/strict";',
            'import { readFileSync } from "node:fs";',
            'import { fromMarkdown } from "mdast-util-from-markdown";',
            'import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";',
            'import { toString } from "mdast-util-to-string";',
            'import { gfmFootnote } from "micromark-extension-gfm-footnote";',
            'import { parse } from "yaml";',
            "const input = JSON.parse(readFileSync(0, 'utf8'));",
            "const options = { extensions: [gfmFootnote()], mdastExtensions: [gfmFootnoteFromMarkdown()] };",
            "function pageParts(content) {",
            "  const closing = content.indexOf('\\n---\\n', 4);",
            "  assert.notEqual(closing, -1);",
            "  return { metadata: parse(content.slice(4, closing)), body: content.slice(closing + 5) };",
            "}",
            "function inspect(content, expectedFragments, expectedReferences, expectedCitations) {",
            "  const { metadata, body } = pageParts(content);",
            "  const tree = fromMarkdown(body, options);",
            "  const pending = [...tree.children].reverse();",
            "  const types = [];",
            "  const references = [];",
            "  const definitions = new Map();",
            "  while (pending.length > 0) {",
            "    const node = pending.pop();",
            "    types.push(node.type);",
            "    if (node.type === 'footnoteReference') references.push(node.identifier);",
            "    if (node.type === 'footnoteDefinition') {",
            "      const matches = definitions.get(node.identifier) ?? [];",
            "      matches.push(node);",
            "      definitions.set(node.identifier, matches);",
            "    }",
            "    if ('children' in node) for (let index = node.children.length - 1; index >= 0; index -= 1) pending.push(node.children[index]);",
            "  }",
            "  assert.equal(types.filter((type) => type === 'heading').length, 1);",
            "  for (const forbidden of ['blockquote', 'code', 'emphasis', 'html', 'inlineCode', 'link', 'list', 'strong']) assert.equal(types.includes(forbidden), false, forbidden);",
            "  assert.deepEqual(references, expectedReferences);",
            "  const visible = tree.children.filter((node) => node.type !== 'footnoteDefinition').map((node) => toString(node)).join('\\n');",
            "  for (const fragment of expectedFragments) assert.ok(visible.includes(fragment), fragment);",
            "  const counts = new Map();",
            "  const citations = references.map((identifier) => {",
            "    const matches = definitions.get(identifier);",
            "    assert.equal(matches?.length, 1);",
            "    const text = toString(matches[0]);",
            '    const match = /^\\[\\[([^\\]]+)\\]\\] Quoted span ("(?:[^"\\\\]|\\\\.)*")\\.$/u.exec(text);',
            "    assert.ok(match, text);",
            "    const target = `${match[1]}.md`;",
            "    const quotation = JSON.parse(match[2]);",
            "    const key = `${target}\\u0000${quotation}`;",
            "    const occurrence = (counts.get(key) ?? 0) + 1;",
            "    counts.set(key, occurrence);",
            "    return { occurrence, quotation, target };",
            "  });",
            "  assert.deepEqual(citations, expectedCitations);",
            "  assert.deepEqual(metadata.sdk['citation-correspondence'], expectedCitations);",
            "}",
            "inspect(input.conceptText, input.claimFragments, ['s1', 's2'], input.conceptCitations);",
            "inspect(input.edgeText, input.contextFragments, ['s1'], input.edgeCitations);",
          ].join("\n"),
        );
        const semanticProof = spawnSync(process.execPath, [semanticsPath], {
          cwd: consumer,
          encoding: "utf8",
          env: consumerEnvironment(guard),
          input: JSON.stringify({
            claimFragments: probe.expectedClaimFragments,
            conceptCitations: probe.quotations.map((quotation) => ({
              occurrence: 1,
              quotation,
              target: ".atlas/sources/installed-citation.md",
            })),
            conceptText,
            contextFragments: probe.expectedContextFragments,
            edgeCitations: [
              {
                occurrence: 1,
                quotation: probe.quotations[1],
                target: ".atlas/sources/installed-citation.md",
              },
            ],
            edgeText,
          }),
          killSignal: "SIGKILL",
          timeout: 30_000,
        });
        assert.equal(semanticProof.status, 0, semanticProof.stderr);
        assert.equal(semanticProof.stderr, "");
        const operationWorkspace = join(
          consumer,
          ".atlas-operation-workspaces",
          ingestBranch,
        );
        if (probe.freshness !== undefined) {
          const source = join(
            operationWorkspace,
            ".atlas/sources/installed-citation.md",
          );
          const original = readFileSync(source);
          const refs = consumerGit(consumer, ["show-ref"]);
          const status = consumerGit(operationWorkspace, ["status", "--porcelain"]);
          for (const sample of probe.freshness.cases) {
            const asOf = new Date(
              Date.parse(revisionTime) + sample.elapsedMilliseconds,
            ).toISOString();
            const args = [
              "lint",
              "--machine",
              "--atlas-host-directory",
              operationWorkspace,
              "--as-of",
              asOf,
            ];
            const lint = runInstalled(consumer, guard, args);
            assert.equal(lint.status, 0, lint.stdout);
            assert.equal(lint.stderr, "");
            const checked = parseMachineOperationResult(
              lint.stdout,
            ) as LintOperationResult;
            assert.equal(checked.disposition, "success");
            assert.equal(checked.payload.state, "completed");
            assert.equal(checked.payload.lint.outcome, "valid");
            assert.equal(checked.payload.lint.asOf, asOf);
            assert.deepEqual(
              checked.handoff.validationState.findings.map(
                ({ code, path, severity }) => ({ code, path, severity }),
              ),
              sample.expectedCode === null
                ? []
                : [
                    {
                      code: sample.expectedCode,
                      path: ".atlas/sources/installed-citation.md",
                      severity: sample.expectedSeverity,
                    },
                  ],
            );
            assert.equal(runInstalled(consumer, guard, args).stdout, lint.stdout);
            assert.deepEqual(readFileSync(source), original);
          }
          assert.equal(consumerGit(consumer, ["show-ref"]), refs);
          assert.equal(
            consumerGit(operationWorkspace, ["status", "--porcelain"]),
            status,
          );
        }
        const conceptFile = join(operationWorkspace, conceptPath);
        writeFileSync(
          conceptFile,
          readFileSync(conceptFile, "utf8").replace(
            JSON.stringify(probe.quotations[0]),
            JSON.stringify(probe.quotations[1]),
          ),
        );
        const rejected = runInstalled(consumer, guard, [
          "lint",
          "--machine",
          "--atlas-host-directory",
          operationWorkspace,
        ]);
        assert.equal(rejected.status, lintCommandExitCodes.atlasInvalid);
        const rejectedLint = parseMachineOperationResult(
          rejected.stdout,
        ) as LintOperationResult;
        assert.ok(
          rejectedLint.handoff.validationState.findings.some(
            ({ code }) => code === probe.expectedTamperCode,
          ),
        );
      }
    } finally {
      if (producerOutputProof !== undefined) {
        rmSync(producerOutputProof, { force: true });
      }
      rmSync(workspace, { force: true, recursive: true });
    }
  });
}
