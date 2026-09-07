import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import test from "node:test";
import { ESLint } from "eslint";

const ROOT = resolve(import.meta.dirname, "..");

const fixtures = [
  ...(
    [
      ["domain", "../atlas/example.ts"],
      ["atlas", "../graph/example.ts"],
      ["graph", "../lint/example.ts"],
      ["lint", "../operations/example.ts"],
      ["operations", "../platform/example.ts"],
      ["platform", "../adapters/example.ts"],
      ["adapters", "../interfaces/example.ts"],
    ] as const
  ).map(([layer, specifier]) => ({
    name: `outward-${layer}.ts`,
    layer,
    source: `import "${specifier}";\n`,
    ruleId: "atlas/inward-imports",
  })),
  {
    name: "nested-outward-domain.ts",
    layer: "domain/nested",
    source: 'import "../../atlas/example.ts";\n',
    ruleId: "atlas/inward-imports",
  },
  {
    name: "normalized-parent-domain.ts",
    layer: "domain",
    source: 'import "./../atlas/x.ts";\n',
    ruleId: "atlas/inward-imports",
  },
  {
    name: "normalized-dot-parent-domain.ts",
    layer: "domain",
    source: 'import "././../atlas/x.ts";\n',
    ruleId: "atlas/inward-imports",
  },
  {
    name: "normalized-double-slash-parent-domain.ts",
    layer: "domain",
    source: 'import ".//../atlas/x.ts";\n',
    ruleId: "atlas/inward-imports",
  },
  {
    name: "normalized-nested-parent-domain.ts",
    layer: "domain/nested",
    source: 'import "./../../atlas/x.ts";\n',
    ruleId: "atlas/inward-imports",
  },
  {
    name: "normalized-interior-parent-domain.ts",
    layer: "domain",
    source: 'import "../foo/../atlas/x.ts";\n',
    ruleId: "atlas/inward-imports",
  },
  {
    name: "same-layer-domain.ts",
    layer: "domain",
    source: 'import "../domain/example.ts";\n',
    ruleId: null,
  },
  {
    name: "inward-lint.ts",
    layer: "lint",
    source: 'import "../domain/example.ts";\n',
    ruleId: null,
  },
  {
    name: "external-atlas-packages.ts",
    layer: "domain",
    source: 'import "@vendor/atlas/x";\nimport "vendor/atlas/x";\n',
    ruleId: null,
  },
  {
    name: "prefixed-node-core.ts",
    layer: "domain",
    source: 'import "node:fs";\n',
    ruleId: "atlas/inward-imports",
  },
  {
    name: "bare-node-core.ts",
    layer: "atlas",
    source: 'import "child_process";\n',
    ruleId: "atlas/inward-imports",
  },
  {
    name: "node-platform.ts",
    layer: "platform",
    source: 'import "node:fs";\nimport "fs";\n',
    ruleId: null,
  },
  {
    name: "dynamic-outward.ts",
    layer: "domain",
    source: 'void import("../atlas/example.ts");\n',
    ruleId: "no-restricted-syntax",
  },
  {
    name: "dynamic-node.ts",
    layer: "domain",
    source: 'void import("node:fs");\n',
    ruleId: "no-restricted-syntax",
  },
] as const;

test("ESLint enforces product import boundaries without source fixtures", async () => {
  const virtualFixtures = fixtures.map((fixture) => ({
    ...fixture,
    path: resolve(ROOT, "src", fixture.layer, fixture.name),
    projectPath: `src/${fixture.layer}/${fixture.name}`,
  }));
  for (const fixture of virtualFixtures) {
    assert.equal(
      existsSync(fixture.path),
      false,
      `${fixture.path} must not be created in product source`,
    );
  }

  test("Atlas CLI script reaches product code only through the interface layer", () => {
    const source = readFileSync(resolve(ROOT, "scripts", "atlas.ts"), "utf8");
    for (const forbidden of [
      "../src/atlas/",
      "../src/domain/",
      "../src/lint/",
      "../src/operations/",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.match(source, /\.\.\/src\/interfaces\/lint_command\.ts/u);
  });

  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: {
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: virtualFixtures.map((fixture) => fixture.projectPath),
            maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING:
              virtualFixtures.length,
          },
        },
      },
    },
  });
  const results = (
    await Promise.all(
      virtualFixtures.map((fixture) =>
        eslint.lintText(fixture.source, { filePath: fixture.path }),
      ),
    )
  ).flat();
  for (const fixture of virtualFixtures) {
    assert.equal(
      existsSync(fixture.path),
      false,
      `${fixture.path} must not be created in product source`,
    );
  }

  const resultsByName = new Map(
    results.map((result) => [basename(result.filePath), result]),
  );
  for (const fixture of fixtures) {
    const result = resultsByName.get(fixture.name);
    assert.ok(result, fixture.name);
    if (fixture.ruleId === null) {
      assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
    } else {
      assert.ok(
        result.messages.some((message) => message.ruleId === fixture.ruleId),
        `${fixture.name}: ${JSON.stringify(result.messages)}`,
      );
    }
  }
});
