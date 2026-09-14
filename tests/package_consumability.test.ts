import assert from "node:assert/strict";
import type {
  AtlasQmdOptions,
  AtlasQmdPreparation,
} from "../src/extensions/atlas_qmd.ts";
import type { InputContractResult } from "../src/interfaces/input_contract_command.ts";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { readInstalledConsumerCorpus } from "./installed_consumer_corpus.ts";
import { exerciseInitializationArtifactConflicts } from "./initialization_artifact_probes.ts";
import { exerciseGovernanceRetirement } from "./governance_retirement_probe.ts";
import { parseMachineOperationResult } from "./machine_operation_result.ts";
import type { AtlasInitializationResult } from "../src/operations/initialize_operation.ts";
import type { LintOperationResult } from "../src/operations/lint_operation.ts";
import type { ExploreOperationResult } from "../src/operations/explore_operation.ts";
import { initializeCommandExitCodes } from "../src/interfaces/initialize_command.ts";
import { lintCommandExitCodes } from "../src/interfaces/lint_command.ts";
import { exploreCommandExitCodes } from "../src/interfaces/explore_command.ts";
import { governCommandExitCodes } from "../src/interfaces/governance_command.ts";
import {
  governanceAttestationOperation,
  governanceAttestationPayload,
  type AtlasGovernanceResult,
} from "../src/operations/governance_operation.ts";
import { attestationPayloadDigest } from "../src/operations/operation_support.ts";

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

function packDryRun(): PackDryRun {
  const output = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--silent", "--ignore-scripts=false"],
    {
      cwd: ROOT,
      encoding: "utf8",
      killSignal: "SIGKILL",
      timeout: 180_000,
    },
  );
  const [pack] = JSON.parse(output) as readonly PackDryRun[];
  assert.ok(pack);
  return pack;
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
  const pack = packDryRun();
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
  const injectedPath = join(ROOT, "dist", "proof-unreviewed.js");
  writeFileSync(injectedPath, 'console.error("unreviewed");\n');
  assert.equal(existsSync(injectedPath), true);

  const pack = packDryRun();
  const actual = pack.files.map((file) => file.path).toSorted();

  assert.equal(existsSync(injectedPath), false);
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
// It lives in this file rather than its own so that it cannot run concurrently
// with the packing tests above. Every `npm pack` here rebuilds `dist/` through
// `prepack`, whose first act is to delete it; two such tests in separate files
// race, and the loser installs a truncated tarball.

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
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts=false", "--pack-destination", destination, "--silent"],
    { cwd: ROOT, killSignal: "SIGKILL", stdio: "ignore", timeout: 180_000 },
  );
  const [tarball] = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
  assert.ok(tarball !== undefined, "npm pack produced no tarball");
  return join(destination, tarball);
}

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
      packArtifact(join(workspace, "artifact")),
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
  }).trim();
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
    try {
      const consumer = createConsumer(workspace);
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
        const proposedPage = consumerGit(consumer, [
          "show",
          `${proposedBranch}:${principleExample.path}`,
        ]);
        assert.match(proposedPage, /id: principle:quality/u);
        assert.match(proposedPage, /## Amendments/u);
        assert.equal(consumerGit(consumer, ["rev-parse", "HEAD"]), proposal);
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
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
}
