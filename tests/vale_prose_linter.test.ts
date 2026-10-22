import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import type { AtlasTextFile } from "../src/atlas/load_atlas_text.ts";
import { atlasSdkProseStyleFiles } from "../src/lint/atlas_sdk_prose_style.ts";
import type { ProseLintRequest } from "../src/lint/prose_lint.ts";
import {
  createValeProseLinter,
  downloadValeAsset,
  resolveValeBinary,
  valeCacheDirectory,
  valeEnvironment,
  type ValeProseLinterOptions,
  type ValeRunner,
} from "../src/platform/vale_prose_linter.ts";
import {
  valePlatformRelease,
  valePlatformReleases,
  valeReleaseUrl,
  valeVersion,
} from "../src/platform/vale_release.ts";
import { fakeRelease, tar } from "./vale_archive_fixtures.ts";

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

function emptyCache(): string {
  return join(mkdtempSync(join(tmpdir(), "atlas-vale-cache-")), "vale", "linux-x64");
}

/** A machine cache already holding a binary; `run` decides what it reports. */
function installed(): ValeProseLinterOptions {
  const cacheDirectory = emptyCache();
  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(join(cacheDirectory, "vale"), "cached");
  return {
    arch: "x64",
    cacheDirectory,
    download: () => {
      throw new Error("a cached binary needs no download");
    },
    platform: "linux",
  };
}

const releaseArchive = gzipSync(
  tar([
    { content: "fresh binary", name: "vale_3/vale" },
    { content: "MIT", name: "vale_3/LICENSE" },
  ]),
);
const testRelease = fakeRelease("vale_test_Linux_64-bit.tar.gz", releaseArchive);
const pinned: ValeRunner = () => ({ status: 0, stdout: versionOutput });

test("Atlas SDK pins one official Vale release for six platforms", () => {
  assert.equal(valePlatformReleases.length, 6);
  for (const release of valePlatformReleases) {
    assert.match(release.sha256, /^[0-9a-f]{64}$/u);
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

test("Vale is cached once per machine beside the other Atlas SDK tool runtimes", () => {
  assert.equal(
    valeCacheDirectory("linux", "x64", { XDG_CACHE_HOME: "/xdg" }),
    join("/xdg", "atlas", "tool-runtimes", "vale", valeVersion, "linux-x64"),
  );
  assert.match(
    valeCacheDirectory("darwin", "arm64", {}),
    /[\\/]\.cache[\\/]atlas[\\/]tool-runtimes[\\/]vale[\\/]3\.24\.0[\\/]darwin-arm64$/u,
  );
});

test("an unsupported platform cannot resolve Vale", () => {
  const resolution = resolveValeBinary({ arch: "riscv64", platform: "linux" });
  assert.equal(resolution.state, "unavailable");
  assert.match(
    (resolution as { reason: string }).reason,
    /^Atlas SDK runs Vale 3\.24\.0 on darwin-arm64, .*win32-x64; linux-riscv64 is not supported\.$/u,
  );
});

test("a cached pinned Vale binary resolves without downloading", () => {
  const options = installed();
  const calls: string[][] = [];
  const resolution = resolveValeBinary({
    ...options,
    run: (binary, args, cwd) => {
      calls.push([binary, ...args, cwd]);
      return { status: 0, stdout: versionOutput };
    },
  });
  const binary = join(options.cacheDirectory as string, "vale");
  assert.deepEqual(resolution, { path: binary, state: "resolved" });
  assert.deepEqual(calls, [[binary, "--version", options.cacheDirectory]]);
});

test("the first use downloads, verifies, and atomically installs the pinned release", () => {
  const cacheDirectory = emptyCache();
  const urls: string[] = [];
  const resolution = resolveValeBinary({
    cacheDirectory,
    download: (url) => {
      urls.push(url);
      return releaseArchive;
    },
    release: testRelease,
    run: pinned,
  });
  const binary = join(cacheDirectory, "vale");
  assert.deepEqual(resolution, { path: binary, state: "resolved" });
  assert.deepEqual(urls, [valeReleaseUrl(testRelease)]);
  assert.equal(readFileSync(binary, "utf8"), "fresh binary");
  assert.deepEqual(readdirSync(cacheDirectory), ["vale"]);
  if (process.platform !== "win32") {
    assert.equal(statSync(binary).mode & 0o111, 0o111);
  }
});

test("a cached binary reporting another version is replaced", () => {
  const options = installed();
  let checks = 0;
  const resolution = resolveValeBinary({
    ...options,
    download: () => releaseArchive,
    release: testRelease,
    run: () => {
      checks += 1;
      return checks === 1
        ? { status: 0, stdout: "vale version 3.0.0\n" }
        : pinned("", [], "");
    },
  });
  assert.equal(resolution.state, "resolved");
  assert.equal(
    readFileSync(join(options.cacheDirectory as string, "vale"), "utf8"),
    "fresh binary",
  );
});

test("a failed download, digest, or install leaves Vale unavailable", () => {
  const offline = resolveValeBinary({
    cacheDirectory: emptyCache(),
    download: () => {
      throw new Error("ENOTFOUND");
    },
    release: testRelease,
    run: pinned,
  });
  assert.deepEqual(offline, {
    reason: `Vale ${valeVersion} could not be downloaded from ${valeReleaseUrl(testRelease)}; connect to the network and run Lint again.`,
    state: "unavailable",
  });

  const tampered = resolveValeBinary({
    cacheDirectory: emptyCache(),
    download: () => releaseArchive,
    release: { ...testRelease, sha256: "0".repeat(64) },
    run: pinned,
  });
  assert.equal(tampered.state, "unavailable");
  assert.match(
    (tampered as { reason: string }).reason,
    /^The downloaded Vale 3\.24\.0 release failed verification: .* has SHA-256 [0-9a-f]{64}; Atlas SDK pins 0{64}\.$/u,
  );

  const blocked = mkdtempSync(join(tmpdir(), "atlas-vale-cache-"));
  writeFileSync(join(blocked, "file"), "not a directory");
  const unwritable = resolveValeBinary({
    cacheDirectory: join(blocked, "file", "vale"),
    download: () => releaseArchive,
    release: testRelease,
    run: pinned,
  });
  assert.deepEqual(unwritable, {
    reason: `Vale ${valeVersion} could not be installed in ${join(blocked, "file", "vale")}.`,
    state: "unavailable",
  });
  assert.deepEqual(readdirSync(blocked), ["file"]);
});

test("an installed binary that cannot run or reports another version is refused", () => {
  const runs: readonly ReturnType<ValeRunner>[] = [
    { error: new Error("EACCES"), status: null, stdout: "" },
    { status: 1, stdout: versionOutput },
    { status: 0, stdout: "vale version 3.0.0\n" },
  ];
  const reasons = runs.map((result) => {
    const resolution = resolveValeBinary({
      cacheDirectory: emptyCache(),
      download: () => releaseArchive,
      release: testRelease,
      run: () => result,
    });
    assert.equal(resolution.state, "unavailable");
    return (resolution as { reason: string }).reason;
  });
  assert.deepEqual(reasons, [
    `The installed Vale ${valeVersion} binary could not run.`,
    `The installed Vale ${valeVersion} binary could not run.`,
    `The installed Vale binary is not Vale ${valeVersion}.`,
  ]);
});

test("the default runner reports a binary that cannot start", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX executable semantics");
    return;
  }
  const resolution = resolveValeBinary({
    cacheDirectory: emptyCache(),
    download: () => releaseArchive,
    release: testRelease,
  });
  assert.deepEqual(resolution, {
    reason: `The installed Vale ${valeVersion} binary could not run.`,
    state: "unavailable",
  });
});

test("resolving Vale re-raises process limits instead of reporting them", () => {
  assert.throws(
    () =>
      resolveValeBinary({
        cacheDirectory: emptyCache(),
        download: () => {
          throw new RangeError("stack");
        },
        release: testRelease,
        run: pinned,
      }),
    RangeError,
  );
});

test("the default downloader fetches over HTTP and fails on HTTP errors", async () => {
  const server = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createServer } from "node:http";
const server = createServer((request, response) => {
  if (request.url === "/asset") response.end("asset bytes");
  else { response.statusCode = 404; response.end(); }
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  try {
    const port = await new Promise<string>((resolvePort) => {
      server.stdout.once("data", (data: Buffer) => {
        resolvePort(data.toString("utf8").trim());
      });
    });
    assert.equal(
      new TextDecoder().decode(downloadValeAsset(`http://127.0.0.1:${port}/asset`)),
      "asset bytes",
    );
    assert.throws(
      () => downloadValeAsset(`http://127.0.0.1:${port}/missing`),
      /^Error: Downloading http:\/\/127\.0\.0\.1:\d+\/missing failed\.$/u,
    );
  } finally {
    server.kill();
  }
});

test("the prose linter reports an unavailable Vale and resolves it once", () => {
  let downloads = 0;
  const linter = createValeProseLinter({
    cacheDirectory: emptyCache(),
    download: () => {
      downloads += 1;
      throw new Error("offline");
    },
    release: testRelease,
    run: pinned,
  });
  for (let index = 0; index < 2; index += 1) {
    assert.equal(
      linter.lint(request([page(".atlas/index.md", "Hi.")])).state,
      "unavailable",
    );
  }
  assert.equal(downloads, 1);
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
    ...installed(),
    run: (binary, args, cwd) => {
      if (args[0] === "--version") return { status: 0, stdout: versionOutput };
      assert.ok(binary.endsWith(join("linux-x64", "vale")));
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
    ...installed(),
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
    ...installed(),
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
    ...installed(),
    run: working,
    temporaryRoot: () => blocked,
  });
  assert.deepEqual(unwritable.lint(request([page(".atlas/index.md", "Hi.")])), {
    reason: "The Atlas could not be prepared for Vale.",
    state: "unavailable",
  });
  assert.equal(existsSync(blocked), false);

  const crashing = createValeProseLinter({
    ...installed(),
    run: (_binary, args) =>
      args[0] === "--version"
        ? { status: 0, stdout: versionOutput }
        : { error: new Error("killed"), status: null, stdout: "" },
  });
  assert.deepEqual(crashing.lint(request([page(".atlas/index.md", "Hi.")])), {
    reason: "The pinned Vale binary could not run.",
    state: "unavailable",
  });
});

test("the prose linter re-raises process limits instead of reporting them", () => {
  const working: ValeRunner = () => ({ status: 0, stdout: versionOutput });
  assert.throws(
    () =>
      createValeProseLinter({
        ...installed(),
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
        ...installed(),
        run: (_binary, args) => {
          if (args[0] === "--version") return working("", [], "");
          throw new RangeError("stack");
        },
      }).lint(request([page(".atlas/index.md", "Hi.")])),
    RangeError,
  );
});

test("the pinned Vale binary enforces the default page-length rule", () => {
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

test("the pinned Vale binary reports an Atlas configuration error", () => {
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
