# @plumas/ui

Tailwind CSS v4 preset + the shadcn/ui-style primitives Phase 0's screens need: `Button`,
`Input`, `Label`, `Card` (+ `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/
`CardFooter`), `Checkbox` (for the 18+ attestation).

- No bundler of its own — consumed as TS/TSX source directly by `apps/web`'s Vite build.
- `styles/globals.css` is CSS-first Tailwind v4 (`@import "tailwindcss"`, no
  `tailwind.config.js`); `apps/web` imports it once. It also has `@source ".."` — Tailwind v4's
  content detection scans from the CSS file's own project root and does not cross into other
  pnpm workspace packages, so without that directive every class used only inside this
  package's own components silently never makes it into the generated CSS in any app that
  imports this stylesheet. The class names still render fine in the HTML (React doesn't know
  any better), so this is invisible to anything that only checks text/HTML — it took a
  Playwright test actually measuring a checkbox's layout to catch it (`e2e/README.md`). If you
  add a new component here and its styling doesn't show up, check this directive still covers
  its path before anything else.
- Only the components Phase 0 actually uses are here. Add more with the shadcn CLI
  (`pnpm dlx shadcn@latest add <component>`) pointed at `src/components` as later phases need
  them, rather than pre-generating the full catalog.
- Default sizes (`h-11` buttons/inputs) meet the 44×44px touch target minimum (NFR-09); the
  checkbox's visual box is smaller, so pair it with a `<Label htmlFor>` for a large enough
  clickable area.
