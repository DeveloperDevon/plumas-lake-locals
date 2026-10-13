import { base } from "@plumas/config/eslint";

export default [
  // k6 load test scripts run in k6's own bundled JS runtime, not Node - they're not part of
  // this package's TypeScript project and import from "k6"/"k6/http", which don't resolve here.
  { ignores: ["load/**"] },
  ...base,
];
