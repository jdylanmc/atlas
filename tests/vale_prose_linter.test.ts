import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AtlasTextFile } from "../src/atlas/load_atlas_text.ts";
import { atlasSdkProseStyleFiles } from "../src/lint/atlas_sdk_prose_style.ts";
import type { ProseLintRequest } from "../src/lint/prose_lint.ts";
import {
  createValeProseLinter,
  resolveValeBinary,
  valeEnvironment,
  type ValeRunner,
} from "../src/platform/vale_prose_linter.ts";
import {
  valePlatformRelease,
  valePlatformReleases,
  valeReleaseUrl,
  valeVersion,
} from "../src/platform/vale_release.ts";

function at<T>(items: readonly T[] | undefined, index: number): T {
  const item = items?.[index];
  assert.ok(item !== undefined);
  return item;
}

const versionOutput = `vale version ${valeVersion}\n`;

function page(path: string, body: string): AtlasTextFile {
  return Object.freeze({ content: `---\nsdk: {}\n---\n# Page\n\n${body}\n`, path });
}

function request(files: readonly AtlasTextFile[]): ProseLintRequest {
  return Object.freeze({
    files: Object.freeze([...atlasSdkProseStyleFiles, ...files]),
    pagePaths: Object.freeze(files.map((file) => file.path)),
  });
}

const installed = {
  platform: "linux",
  arch: "x64",
  resolveModule: (specifier: string) => {
    assert.equal(specifier, "@jdylanmc/atlas-vale-linux-x64/package.json");
    return "/pkg/package.json";
  },
};

test("Atlas SDK pins one Vale release for six platforms", () => {
  assert.equal(valePlatformReleases.length, 6);
  for (const release of valePlatformReleases) {
    assert.match(release.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(
      release.packageName,
      `@jdylanmc/atlas-vale-${release.os}-${release.cpu}`,
    );
    assert.equal(release.binary, release.os === "win32" ? "vale.exe" : "vale");
    assert.equal(valePlatformRelease(release.os, release.cpu), release);
  }
  assert.equal(valePlatformRelease("freebsd", "x64"), undefined);
  assert.equal(
    valeReleaseUrl(
      valePlatformRelease("darwin", "arm64") as NonNullable<
        ReturnType<typeof valePlatformRelease>
      >,
    ),
    `https://github.com/vale-cli/vale/releases/download/v${valeVersion}/vale_${valeVersion}_macOS_arm64.tar.gz`,
  );
});

test("Vale runs with an empty environment apart from the Windows loader's SystemRoot", () => {
  assert.deepEqual(
    valeEnvironment("darwin", { HOME: "/h", VALE_CONFIG_PATH: "/x" }),
    {},
  );
  assert.deepEqual(valeEnvironment("win32", { SystemRoot: "C:\\Windows", PATH: "x" }), {
    SystemRoot: "C:\\Windows",
  });
  assert.deepEqual(valeEnvironment("win32", {}), {});
});

test("an unsupported platform cannot resolve Vale", () => {
  const resolution = resolveValeBinary({ arch: "riscv64", platform: "linux" });
  assert.equal(resolution.state, "unavailable");
  assert.match(
    (resolution as { reason: string }).reason,
    /^Atlas SDK bundles Vale 3\.24\.0 for darwin-arm64, .*win32-x64; linux-riscv64 is not supported\.$/u,
  );
});

test("a missing platform package cannot resolve Vale", () => {
  const resolution = resolveValeBinary({
    arch: "x64",
    platform: "linux",
    resolveModule: () => {
      throw new Error("MODULE_NOT_FOUND");
    },
  });
  assert.deepEqual(resolution, {
    reason:
      "The bundled Vale package @jdylanmc/atlas-vale-linux-x64@3.24.0 is not installed.",
    state: "unavailable",
  });
});

test("a Vale binary that cannot run or reports another version is refused", () => {
  const runs: readonly ReturnType<ValeRunner>[] = [
    { error: new Error("EACCES"), status: null, stdout: "" },
    { status: 1, stdout: versionOutput },
    { status: 0, stdout: "vale version 3.0.0\n" },
  ];
  const reasons = runs.map((result) => {
    const resolution = resolveValeBinary({ ...installed, run: () => result });
    assert.equal(resolution.state, "unavailable");
    return (resolution as { reason: string }).reason;
  });
  assert.deepEqual(reasons, [
    "The bundled Vale binary in @jdylanmc/atlas-vale-linux-x64 could not run.",
    "The bundled Vale binary in @jdylanmc/atlas-vale-linux-x64 could not run.",
    "The bundled Vale binary in @jdylanmc/atlas-vale-linux-x64 is not Vale 3.24.0.",
  ]);
});

test("a Vale binary missing from its installed package cannot run", () => {
  const resolution = resolveValeBinary({
    arch: process.arch,
    platform: process.platform,
    resolveModule: () => join(tmpdir(), "atlas-vale-absent-package", "package.json"),
  });
  assert.equal(resolution.state, "unavailable");
  assert.match((resolution as { reason: string }).reason, /could not run\.$/u);
});

test("the pinned Vale binary resolves beside its platform package manifest", () => {
  const calls: string[][] = [];
  const resolution = resolveValeBinary({
    ...installed,
    run: (binary, args, cwd) => {
      calls.push([binary, ...args, cwd]);
      return { status: 0, stdout: versionOutput };
    },
  });
  assert.deepEqual(resolution, {
    path: join("/pkg", "bin", "vale"),
    state: "resolved",
  });
  assert.deepEqual(calls, [[join("/pkg", "bin", "vale"), "--version", "/pkg"]]);
});

test("the prose linter reports an unavailable Vale and resolves it once", () => {
  let resolves = 0;
  const linter = createValeProseLinter({
    ...installed,
    resolveModule: () => {
      resolves += 1;
      throw new Error("missing");
    },
  });
  for (let index = 0; index < 2; index += 1) {
    assert.equal(
      linter.lint(request([page(".atlas/index.md", "Hi.")])).state,
      "unavailable",
    );
  }
  assert.equal(resolves, 1);
});

test("the prose linter runs Vale over a private copy of exactly the loaded text", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-vale-test-"));
  const seen: {
    args: readonly string[];
    cwd: string;
    files: Record<string, string>;
  }[] = [];
  const pages = [page(".atlas/index.md", "Root."), page(".atlas/concepts/a.md", "A.")];
  const linter = createValeProseLinter({
    ...installed,
    run: (binary, args, cwd) => {
      if (args[0] === "--version") return { status: 0, stdout: versionOutput };
      assert.equal(binary, join("/pkg", "bin", "vale"));
      const files: Record<string, string> = {};
      for (const file of request(pages).files) {
        files[file.path] = readFileSync(join(cwd, ...file.path.split("/")), "utf8");
      }
      seen.push({ args, cwd, files });
      return {
        status: 1,
        stdout: JSON.stringify({
          ".atlas/index.md": [
            {
              Check: "AtlasSDK.PageLength",
              Line: 6,
              Message: "too long",
              Severity: "error",
              Span: [1, 4],
            },
          ],
        }),
      };
    },
    temporaryRoot: () => root,
  });
  const outcome = linter.lint(request(pages));
  assert.equal(outcome.state, "completed");
  assert.equal(at(outcome.findings, 0).code, "VALE_ATLASSDK_PAGELENGTH");
  assert.equal(seen.length, 1);
  assert.equal(at(seen, 0).cwd, root);
  assert.deepEqual(at(seen, 0).args, [
    "--no-global",
    "--config=.atlas/.vale.ini",
    "--output=JSON",
    ".atlas/index.md",
    ".atlas/concepts/a.md",
  ]);
  assert.deepEqual(
    at(seen, 0).files,
    Object.fromEntries(request(pages).files.map((file) => [file.path, file.content])),
  );
  assert.equal(existsSync(root), false, "the private workspace is removed");
});

test("the prose linter skips Vale when the Atlas has no pages", () => {
  const runs: string[] = [];
  const linter = createValeProseLinter({
    ...installed,
    run: (_binary, args) => {
      runs.push(args[0] as string);
      return { status: 0, stdout: versionOutput };
    },
  });
  assert.deepEqual(linter.lint(Object.freeze({ files: [], pagePaths: [] })), {
    findings: [],
    state: "completed",
  });
  assert.deepEqual(runs, ["--version"]);
});

test("the prose linter reports workspace and process failures as unavailable", () => {
  const working: ValeRunner = () => ({ status: 0, stdout: versionOutput });
  const noWorkspace = createValeProseLinter({
    ...installed,
    run: working,
    temporaryRoot: () => {
      throw new Error("ENOSPC");
    },
  });
  assert.deepEqual(noWorkspace.lint(request([page(".atlas/index.md", "Hi.")])), {
    reason: "A private workspace for Vale could not be created.",
    state: "unavailable",
  });

  const blocked = mkdtempSync(join(tmpdir(), "atlas-vale-test-"));
  writeFileSync(join(blocked, ".atlas"), "a file where a directory must go");
  const unwritable = createValeProseLinter({
    ...installed,
    run: working,
    temporaryRoot: () => blocked,
  });
  assert.deepEqual(unwritable.lint(request([page(".atlas/index.md", "Hi.")])), {
    reason: "The Atlas could not be prepared for Vale.",
    state: "unavailable",
  });
  assert.equal(existsSync(blocked), false);

  const crashing = createValeProseLinter({
    ...installed,
    run: (_binary, args) =>
      args[0] === "--version"
        ? { status: 0, stdout: versionOutput }
        : { error: new Error("killed"), status: null, stdout: "" },
  });
  assert.deepEqual(crashing.lint(request([page(".atlas/index.md", "Hi.")])), {
    reason: "The bundled Vale binary could not run.",
    state: "unavailable",
  });
});

test("the prose linter re-raises process limits instead of reporting them", () => {
  const working: ValeRunner = () => ({ status: 0, stdout: versionOutput });
  assert.throws(
    () =>
      createValeProseLinter({
        ...installed,
        run: working,
        temporaryRoot: () => {
          throw new RangeError("stack");
        },
      }).lint(request([page(".atlas/index.md", "Hi.")])),
    RangeError,
  );
  assert.throws(
    () =>
      createValeProseLinter({
        ...installed,
        run: (_binary, args) => {
          if (args[0] === "--version") return working("", [], "");
          throw new RangeError("stack");
        },
      }).lint(request([page(".atlas/index.md", "Hi.")])),
    RangeError,
  );
});

test("the bundled Vale binary enforces the default page-length rule", () => {
  const linter = createValeProseLinter();
  const words = Array.from({ length: 1001 }, (_, index) => `word${String(index)}`).join(
    " ",
  );
  const outcome = linter.lint(
    request([
      page(".atlas/concepts/long.md", `${words}.`),
      page(".atlas/index.md", "A short root page."),
    ]),
  );
  assert.equal(outcome.state, "completed");
  assert.deepEqual(
    outcome.findings.map((finding) => [finding.path, finding.code, finding.severity]),
    [[".atlas/concepts/long.md", "VALE_ATLASSDK_PAGELENGTH", "error"]],
  );
  assert.match(at(outcome.findings, 0).message, /^Page prose runs to 1001 words\./u);
});

test("the bundled Vale binary reports an Atlas configuration error", () => {
  const outcome = createValeProseLinter().lint(
    Object.freeze({
      files: Object.freeze([
        Object.freeze({
          content: "StylesPath = vale/styles\n[*.md]\nBasedOnStyles = Missing\n",
          path: ".atlas/.vale.ini",
        }),
        Object.freeze({ content: "x\n", path: ".atlas/vale/styles/keep.txt" }),
        page(".atlas/index.md", "Root."),
      ]),
      pagePaths: Object.freeze([".atlas/index.md"]),
    }),
  );
  assert.equal(outcome.state, "completed");
  assert.equal(at(outcome.findings, 0).code, "ATLAS_VALE_CONFIG_INVALID");
  assert.equal(at(outcome.findings, 0).path, ".atlas/.vale.ini");
  assert.doesNotMatch(at(outcome.findings, 0).message, /atlas-vale-/u);
});
