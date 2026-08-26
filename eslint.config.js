import eslint from "@eslint/js";
import globals from "globals";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import tseslint from "typescript-eslint";

const sourceLayers = [
  "domain",
  "atlas",
  "graph",
  "lint",
  "operations",
  "platform",
  "adapters",
  "interfaces",
];

const sourceRoot = resolve(import.meta.dirname, "src");
const nodeBuiltins = new Set(
  builtinModules.map((specifier) => specifier.replace(/^node:/u, "")),
);

function sourceLayer(filename) {
  const sourcePath = relative(sourceRoot, filename);
  if (
    isAbsolute(sourcePath) ||
    sourcePath === ".." ||
    sourcePath.startsWith(`..${sep}`)
  ) {
    return undefined;
  }
  const [layer] = sourcePath.split(sep);
  return sourceLayers.includes(layer) ? layer : undefined;
}

const inwardImportsRule = {
  meta: {
    type: "problem",
    schema: [],
  },
  create(context) {
    function checkImport(node) {
      const specifier = node.source?.value;
      if (typeof specifier !== "string") {
        return;
      }

      const importingLayer = sourceLayer(context.filename);
      if (importingLayer === undefined) {
        return;
      }

      const builtin = specifier.startsWith("node:")
        ? specifier.slice("node:".length)
        : specifier;
      if (nodeBuiltins.has(builtin)) {
        if (
          sourceLayers.indexOf(importingLayer) <= sourceLayers.indexOf("operations")
        ) {
          context.report({
            node: node.source,
            message: `${importingLayer} code may not import Node.js built-ins.`,
          });
        }
        return;
      }

      if (!specifier.startsWith(".")) {
        return;
      }
      const targetLayer = sourceLayer(resolve(dirname(context.filename), specifier));
      if (
        targetLayer !== undefined &&
        sourceLayers.indexOf(targetLayer) > sourceLayers.indexOf(importingLayer)
      ) {
        context.report({
          node: node.source,
          message: `${importingLayer} code may not import outward layer ${targetLayer}.`,
        });
      }
    }

    return {
      ExportAllDeclaration: checkImport,
      ExportNamedDeclaration: checkImport,
      ImportDeclaration: checkImport,
    };
  },
};

export default tseslint.config(
  {
    ignores: [".test-workspaces/**", "coverage/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: {
      atlas: {
        rules: {
          "inward-imports": inwardImportsRule,
        },
      },
    },
    rules: {
      "atlas/inward-imports": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Product code may not use dynamic imports.",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
