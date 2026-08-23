# Atlas SDK

Atlas SDK is a deterministic TypeScript package for working with an Atlas: a bounded knowledge domain rooted in an Atlas Host Directory with its records under `.atlas/`.

Today the package has two reachable command-line workflows:

- `atlas lint --machine [--atlas-host-directory PATH]` validates a Home Atlas and prints an Operation Result as JSON.
- `atlas initialize --machine [--atlas-host-directory PATH] [--resume-proposal-branch NAME]` creates or resumes an Atlas Initialization proposal in a Git-backed host directory.

Explore, Ingest, and governance workflows are available as deterministic library APIs. Their command-line seams are still being wired up.

Atlas SDK does not invoke a model, call a network service, or require an API key at runtime. Agentic judgment belongs to the calling agent workflow; Atlas SDK validates inputs, writes deterministic proposals, and returns Operation Results.

## Install

Atlas SDK is intended to be consumed as the public scoped npm package `@jdylanmc/atlas` once a release is published. Until then, consumers can install a packed tarball or Git dependency built from this repository.

```sh
npm install @jdylanmc/atlas
```

Atlas SDK currently supports Node.js 24.x and npm 11.6.2.

## Command-line usage

```sh
atlas lint --machine --atlas-host-directory /path/to/home-atlas
atlas initialize --machine --atlas-host-directory /path/to/home-atlas
```

`--machine` is required. Command output is newline-terminated JSON so agents and scripts can parse it directly.

## Library usage

The supported public API is the package root:

```js
import { lintCommandUsage, runLintCommandOperation } from "@jdylanmc/atlas";
```

Internal source paths are not exported. Treat anything outside the package root as private implementation detail unless a future release adds it to the `exports` map.

## Package contents

The npm artifact ships only the compiled runtime, declaration files, `package.json`, and this README. Development fixtures, tests, local workspaces, and source-tree automation are not part of the package artifact.

## Framework Bundle note

Framework Bundle assembly remains a repository maintainer workflow. The installed package is the supported package-consumption path for Home Atlas repositories; Framework Releases still use their manifest and integrity checks when assembled by this repository.
