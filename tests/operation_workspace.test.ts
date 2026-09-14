import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { after } from "node:test";
import {
  completeOperationWorkspace,
  OperationWorkspaceOwnershipConflict,
  type OperationWorkspaceGit,
} from "../src/platform/operation_workspace.ts";

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true });
});

function workspace(): string {
  const root = mkdtempSync(resolve(tmpdir(), "atlas-operation-workspace-"));
  roots.push(root);
  return root;
}

function treeEntry(
  mode: "100644" | "100755" | "120000" | "160000",
  type: "blob" | "commit",
  object: string,
  path: string,
): string {
  return `${mode} ${type} ${object}\t${path}\0`;
}

function gitAdapter(options: {
  readonly blobs?: Readonly<Record<string, Uint8Array>>;
  readonly bytesFailure?: boolean;
  readonly sizeFailure?: boolean;
  readonly sizeOverride?: string;
  readonly trees: Readonly<Record<string, string>>;
}): OperationWorkspaceGit {
  const blobs = options.blobs ?? {};
  return {
    run: (_repository, args) => {
      if (args[0] === "ls-tree") {
        const revision = args.at(-1);
        const stdout = revision === undefined ? undefined : options.trees[revision];
        return stdout === undefined
          ? { reason: "missing tree", state: "failed" }
          : { state: "succeeded", stdout };
      }
      const object = args.at(-1);
      if (options.sizeFailure === true || object === undefined) {
        return { reason: "missing size", state: "failed" };
      }
      const blob = blobs[object];
      return {
        state: "succeeded",
        stdout: options.sizeOverride ?? String(blob?.byteLength ?? 0),
      };
    },
    runBytesCommand: (command) => {
      const object = command.args.at(-1);
      if (options.bytesFailure === true || object === undefined) {
        return { reason: "missing bytes", state: "failed" };
      }
      return {
        state: "succeeded",
        stdout: options.blobs?.[object] ?? new Uint8Array(),
      };
    },
  };
}

test("Operation Workspace completion preserves committed bytes, modes, links, deletions, and gitlinks", () => {
  const root = workspace();
  const blobs = {
    duplicate: Buffer.from("same\n"),
    executable: Buffer.from("#!/bin/sh\nexit 0\n"),
    link: Buffer.from("README.md"),
    next: Buffer.from("next\n"),
    old: Buffer.from("old\n"),
  };
  const base = [
    treeEntry("100644", "blob", "duplicate", "README.md"),
    treeEntry("100755", "blob", "executable", "run.sh"),
    treeEntry("120000", "blob", "link", "README.link"),
    treeEntry("100644", "blob", "old", "replace.txt"),
    treeEntry("100644", "blob", "old", "remove.txt"),
    treeEntry("100644", "blob", "old", "already-absent.txt"),
    treeEntry("160000", "commit", "submodule", "vendor/module"),
    treeEntry("160000", "commit", "removed-submodule", "vendor/removed"),
  ].join("");
  const committed = [
    treeEntry("100644", "blob", "duplicate", "README.md"),
    treeEntry("100644", "blob", "duplicate", "nested/COPY.md"),
    treeEntry("100755", "blob", "executable", "run.sh"),
    treeEntry("120000", "blob", "link", "README.link"),
    treeEntry("120000", "blob", "link", "fresh.link"),
    treeEntry("100644", "blob", "next", "replace.txt"),
    treeEntry("160000", "commit", "submodule", "vendor/module"),
  ].join("");
  writeFileSync(resolve(root, "README.md"), blobs.duplicate, { mode: 0o755 });
  writeFileSync(resolve(root, "run.sh"), blobs.executable, { mode: 0o644 });
  symlinkSync("README.md", resolve(root, "README.link"));
  writeFileSync(resolve(root, "replace.txt"), blobs.old);
  writeFileSync(resolve(root, "remove.txt"), blobs.old);

  completeOperationWorkspace(
    root,
    "base",
    "committed",
    gitAdapter({ blobs, trees: { base, committed } }),
  );

  assert.equal(readFileSync(resolve(root, "nested", "COPY.md"), "utf8"), "same\n");
  assert.equal(readFileSync(resolve(root, "replace.txt"), "utf8"), "next\n");
  assert.equal(readlinkSync(resolve(root, "README.link")), "README.md");
  assert.equal(readlinkSync(resolve(root, "fresh.link")), "README.md");
  assert.equal(lstatSync(resolve(root, "README.md")).mode & 0o777, 0o644);
  assert.equal(lstatSync(resolve(root, "run.sh")).mode & 0o777, 0o755);
  assert.equal(
    lstatSync(resolve(root, "remove.txt"), { throwIfNoEntry: false }),
    undefined,
  );
  assert.deepEqual(readdirSync(resolve(root, "vendor", "module")), []);
});

test("Operation Workspace completion refuses malformed and unsupported trees", () => {
  const cases = [
    { name: "list failure", tree: undefined, message: /could not list/u },
    { name: "missing separator", tree: "bad\0", message: /malformed tree/u },
    {
      name: "extra metadata",
      tree: "100644 blob object extra\tfile\0",
      message: /unsupported tree/u,
    },
    {
      name: "missing object",
      tree: "100644 blob\tfile\0",
      message: /unsupported tree/u,
    },
    {
      name: "empty path",
      tree: "100644 blob object\t\0",
      message: /unsupported tree/u,
    },
    {
      name: "unsupported mode",
      tree: "100600 blob object\tfile\0",
      message: /unsupported tree/u,
    },
    {
      name: "unsupported type",
      tree: "160000 blob object\tfile\0",
      message: /unsupported tree/u,
    },
  ] as const;
  for (const entry of cases) {
    const root = workspace();
    const trees = entry.tree === undefined ? { committed: "" } : { base: entry.tree };
    assert.throws(
      () =>
        completeOperationWorkspace(root, "base", "committed", gitAdapter({ trees })),
      entry.message,
      entry.name,
    );
  }
});

test("Operation Workspace completion refuses escaped committed paths", () => {
  for (const path of ["/outside", "..", "../outside"]) {
    const root = workspace();
    assert.throws(
      () =>
        completeOperationWorkspace(
          root,
          "base",
          "committed",
          gitAdapter({
            blobs: { object: Buffer.from("outside") },
            trees: {
              base: "",
              committed: treeEntry("100644", "blob", "object", path),
            },
          }),
        ),
      /outside the workspace/u,
    );
  }
});

test("Operation Workspace completion surfaces committed blob failures", () => {
  const cases = [
    { name: "size failure", options: { sizeFailure: true } },
    { name: "invalid size", options: { sizeOverride: "invalid" } },
    { name: "negative size", options: { sizeOverride: "-1" } },
    { name: "bytes failure", options: { bytesFailure: true } },
    {
      name: "short bytes",
      options: { blobs: { object: Buffer.from("x") }, sizeOverride: "2" },
    },
  ] as const;
  for (const entry of cases) {
    const root = workspace();
    assert.throws(
      () =>
        completeOperationWorkspace(
          root,
          "base",
          "committed",
          gitAdapter({
            blobs: { object: Buffer.from("ok") },
            trees: {
              base: "",
              committed: treeEntry("100644", "blob", "object", "file"),
            },
            ...entry.options,
          }),
        ),
      /committed blob/u,
      entry.name,
    );
  }
});

test("Operation Workspace completion refuses unowned path changes", () => {
  const scenarios = [
    {
      base: treeEntry("100644", "blob", "base", "removed"),
      committed: "",
      path: "removed",
      expectedKind: "removed-path",
    },
    {
      base: "",
      committed: treeEntry("100644", "blob", "next", "added"),
      path: "added",
      expectedKind: "committed-path",
    },
    {
      base: treeEntry("100644", "blob", "base", "changed"),
      committed: treeEntry("100644", "blob", "next", "changed"),
      path: "changed",
      expectedKind: "committed-path",
    },
  ] as const;
  for (const scenario of scenarios) {
    const root = workspace();
    writeFileSync(resolve(root, scenario.path), "unowned\n");
    assert.throws(
      () =>
        completeOperationWorkspace(
          root,
          "base",
          "committed",
          gitAdapter({
            blobs: {
              base: Buffer.from("base\n"),
              next: Buffer.from("next\n"),
            },
            trees: { base: scenario.base, committed: scenario.committed },
          }),
        ),
      (error) =>
        error instanceof OperationWorkspaceOwnershipConflict &&
        error.kind === scenario.expectedKind &&
        error.path === scenario.path,
    );
    assert.equal(readFileSync(resolve(root, scenario.path), "utf8"), "unowned\n");
  }
});

test("Operation Workspace completion refuses non-directory parents", () => {
  for (const kind of ["file", "symlink"] as const) {
    const root = workspace();
    const parent = resolve(root, "blocked");
    if (kind === "file") writeFileSync(parent, "owned elsewhere\n");
    else symlinkSync(tmpdir(), parent);
    assert.throws(
      () =>
        completeOperationWorkspace(
          root,
          "base",
          "committed",
          gitAdapter({
            blobs: { object: Buffer.from("next\n") },
            trees: {
              base: "",
              committed: treeEntry("100644", "blob", "object", "blocked/file"),
            },
          }),
        ),
      (error) =>
        error instanceof OperationWorkspaceOwnershipConflict &&
        error.kind === "parent" &&
        error.path === "blocked/file",
    );
  }
});

test("Operation Workspace completion refuses competing gitlink paths", () => {
  for (const location of ["committed", "removed"] as const) {
    for (const kind of ["file", "directory"] as const) {
      const root = workspace();
      const path = resolve(root, "vendor", "module");
      mkdirSync(resolve(root, "vendor"), { recursive: true });
      if (kind === "file") writeFileSync(path, "competing\n");
      else {
        mkdirSync(path);
        writeFileSync(resolve(path, "README.md"), "competing\n");
      }
      const gitlink = treeEntry("160000", "commit", "submodule", "vendor/module");
      assert.throws(
        () =>
          completeOperationWorkspace(
            root,
            "base",
            "committed",
            gitAdapter({
              trees: {
                base: location === "removed" ? gitlink : "",
                committed: location === "committed" ? gitlink : "",
              },
            }),
          ),
        (error) =>
          error instanceof OperationWorkspaceOwnershipConflict &&
          error.kind === "gitlink" &&
          error.path === "vendor/module",
      );
      if (kind === "file") {
        assert.equal(readFileSync(path, "utf8"), "competing\n");
      } else {
        assert.equal(readFileSync(resolve(path, "README.md"), "utf8"), "competing\n");
      }
    }
  }
});

test("Operation Workspace completion distinguishes mismatched path types and link targets", () => {
  const scenarios = [
    {
      create(path: string) {
        mkdirSync(path);
      },
      mode: "100644" as const,
      object: "file",
    },
    {
      create(path: string) {
        symlinkSync("elsewhere", path);
      },
      mode: "120000" as const,
      object: "link",
    },
  ];
  for (const scenario of scenarios) {
    const root = workspace();
    const path = resolve(root, "entry");
    scenario.create(path);
    assert.throws(
      () =>
        completeOperationWorkspace(
          root,
          "base",
          "committed",
          gitAdapter({
            blobs: {
              file: Buffer.from("file\n"),
              link: Buffer.from("target"),
            },
            trees: {
              base: "",
              committed: treeEntry(scenario.mode, "blob", scenario.object, "entry"),
            },
          }),
        ),
      (error) =>
        error instanceof OperationWorkspaceOwnershipConflict &&
        error.kind === "committed-path" &&
        error.path === "entry",
    );
  }
});

test("Operation Workspace completion creates nested files beneath existing directories", () => {
  const root = workspace();
  const nested = resolve(root, "existing", "nested");
  mkdirSync(nested, { recursive: true });
  chmodSync(nested, 0o755);
  completeOperationWorkspace(
    root,
    "base",
    "committed",
    gitAdapter({
      blobs: { object: Buffer.from("value\n") },
      trees: {
        base: "",
        committed: treeEntry("100644", "blob", "object", "existing/nested/value"),
      },
    }),
  );
  assert.equal(readFileSync(resolve(nested, "value"), "utf8"), "value\n");
});
