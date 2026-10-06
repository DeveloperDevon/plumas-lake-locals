// @ts-check
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

import { base } from "./base.js";

/** Shared flat ESLint config for React apps/packages, layered on top of {@link base}. */
export const react = [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
    },
    settings: {
      react: { version: "detect" },
    },
  },
];
