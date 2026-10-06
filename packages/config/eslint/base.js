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
    // Config files (eslint.config.js, vite.config.ts, ...) aren't part of any tsconfig
    // "include", so they can't be type-checked by the project service; drop the typed
    // rules for them instead of making every package's tsconfig include its own configs.
    files: ["**/*.config.{js,cjs,mjs,ts,mts}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    languageOptions: {
      parserOptions: {
        // Resolves the nearest tsconfig.json from each linted file's directory;
        // turbo/pnpm always run lint with cwd = the package root, so this just works.
        // Config files themselves (eslint.config.js, vite.config.ts, ...) live outside
        // every tsconfig's "include", so fall back to an inferred single-file project
        // for them rather than erroring.
        projectService: {
          allowDefaultProject: ["*.config.{js,cjs,mjs,ts,mts}"],
        },
        tsconfigRootDir: process.cwd(),
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
