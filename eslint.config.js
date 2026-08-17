import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

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
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
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
