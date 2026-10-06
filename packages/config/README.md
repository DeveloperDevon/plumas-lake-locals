# @plumas/config

Shared TypeScript, ESLint and Prettier presets for every app/package in the monorepo.

- `tsconfig.base.json` — strict TS compiler options shared by everything
- `tsconfig.app.json` — adds DOM libs + `react-jsx` for browser code (`apps/web`, `packages/ui`)
- `tsconfig.node.json` — adds Node types for server-only packages (`db`, `auth`, `email`, `validators`)
- `eslint` / `eslint/react` — flat ESLint configs (base for Node packages, react layers React rules on top)
- `prettier.config.js` — shared formatting rules

Consume from a package's own config files, e.g.:

```jsonc
// tsconfig.json
{ "extends": "@plumas/config/tsconfig.node.json", "include": ["src"] }
```

```js
// eslint.config.js
import { base } from "@plumas/config/eslint";
export default base;
```
