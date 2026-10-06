// @ts-check
import js from "@eslint/js";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

/** Shared flat ESLint config for non-React packages (Node/server code). */
export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Resolves the nearest tsconfig.json from each linted file's directory;
        // turbo/pnpm always run lint with cwd = the package root, so this just works.
        projectService: true,
      },
    },
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/.output/**",
      "**/.vinxi/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/*.gen.ts",
    ],
  },
);
