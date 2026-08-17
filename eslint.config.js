import eslint from "@eslint/js";
import globals from "globals";
import { builtinModules } from "node:module";
import { dirname, relative, resolve } from "node:path";
import tseslint from "typescript-eslint";

const LAYERS = [
  "domain",
  "realm",
  "graph",
  "weave",
  "operations",
  "platform",
  "adapters",
  "framework",
  "interfaces",
];
const NODE_BUILTIN_NAMES = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);
const NODE_BUILTIN_IMPORTS = builtinModules.map((name) => ({
  name,
  message: "Inward layers must not import Node.js modules.",
}));
const ATLAS_PLUGIN = {
  rules: {
    "inward-dynamic-imports": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          invalid: "Dynamic import bypasses the Atlas inward dependency boundary.",
        },
      },
      create(context) {
        return {
          ImportExpression(node) {
            const filename = context.filename;
            const source =
              node.source.type === "Literal" && typeof node.source.value === "string"
                ? node.source.value
                : null;
            const sourcePath = relative(
              import.meta.dirname,
              resolve(dirname(filename), source ?? ""),
            );
            const currentLayer = LAYERS.findIndex((layer) =>
              relative(import.meta.dirname, filename).startsWith(`src/${layer}/`),
            );
            const targetLayer = LAYERS.findIndex((layer) =>
              sourcePath.startsWith(`src/${layer}/`),
            );
            if (
              source === null ||
              (currentLayer >= 0 &&
                currentLayer <= LAYERS.indexOf("operations") &&
                NODE_BUILTIN_NAMES.has(source)) ||
              (currentLayer >= 0 && targetLayer >= 0 && targetLayer > currentLayer)
            ) {
              context.report({ node, messageId: "invalid" });
            }
          },
        };
      },
    },
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
    plugins: { atlas: ATLAS_PLUGIN },
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
      "atlas/inward-dynamic-imports": "error",
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: NODE_BUILTIN_IMPORTS,
          patterns: [
            {
              group: [
                "node:*",
                "**/realm/**",
                "**/graph/**",
                "**/weave/**",
                "**/operations/**",
                "**/platform/**",
                "**/adapters/**",
                "**/framework/**",
                "**/interfaces/**",
              ],
              message: "Domain contracts must remain independent of outer modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/realm/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: NODE_BUILTIN_IMPORTS,
          patterns: [
            {
              group: [
                "node:*",
                "../graph/**",
                "../weave/**",
                "../operations/**",
                "../platform/**",
                "../adapters/**",
                "../framework/**",
                "../interfaces/**",
                "**/graph/**",
                "**/weave/**",
                "**/operations/**",
                "**/platform/**",
                "**/adapters/**",
                "**/framework/**",
                "**/interfaces/**",
              ],
              message: "Realm code may depend inward on domain contracts only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/weave/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: NODE_BUILTIN_IMPORTS,
          patterns: [
            {
              group: [
                "node:*",
                "../operations/**",
                "../platform/**",
                "../adapters/**",
                "../framework/**",
                "../interfaces/**",
                "**/operations/**",
                "**/platform/**",
                "**/adapters/**",
                "**/framework/**",
                "**/interfaces/**",
              ],
              message: "Weave code may not depend on interface or platform details.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/graph/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: NODE_BUILTIN_IMPORTS,
          patterns: [
            {
              group: [
                "node:*",
                "../weave/**",
                "../operations/**",
                "../platform/**",
                "../adapters/**",
                "../framework/**",
                "../interfaces/**",
                "**/weave/**",
                "**/operations/**",
                "**/platform/**",
                "**/adapters/**",
                "**/framework/**",
                "**/interfaces/**",
              ],
              message: "Graph code may depend only on domain and Realm contracts.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/operations/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: NODE_BUILTIN_IMPORTS,
          patterns: [
            {
              group: [
                "node:*",
                "../platform/**",
                "../adapters/**",
                "../framework/**",
                "../interfaces/**",
                "**/platform/**",
                "**/adapters/**",
                "**/framework/**",
                "**/interfaces/**",
              ],
              message: "Operations must use inward contracts and declared ports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/platform/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../adapters/**",
                "../framework/**",
                "../interfaces/**",
                "**/adapters/**",
                "**/framework/**",
                "**/interfaces/**",
              ],
              message: "Platform implementations may not depend on outer adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../framework/**",
                "../interfaces/**",
                "**/framework/**",
                "**/interfaces/**",
              ],
              message: "Adapters may not depend on framework assembly or interfaces.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/framework/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../interfaces/**", "**/interfaces/**"],
              message: "Framework assembly may not depend on public interfaces.",
            },
          ],
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
