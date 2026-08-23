import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import test from "node:test";

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
