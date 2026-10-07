import { react } from "@plumas/config/eslint/react";

export default [
  ...react,
  {
    ignores: ["src/routeTree.gen.ts", "worker-configuration.d.ts"],
  },
];
