# @plumas/ui

Tailwind CSS v4 preset + the shadcn/ui-style primitives Phase 0's screens need: `Button`,
`Input`, `Label`, `Card` (+ `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/
`CardFooter`), `Checkbox` (for the 18+ attestation).

- No bundler of its own — consumed as TS/TSX source directly by `apps/web`'s Vite build.
- `styles/globals.css` is CSS-first Tailwind v4 (`@import "tailwindcss"`, no
  `tailwind.config.js`); `apps/web` imports it once.
- Only the components Phase 0 actually uses are here. Add more with the shadcn CLI
  (`pnpm dlx shadcn@latest add <component>`) pointed at `src/components` as later phases need
  them, rather than pre-generating the full catalog.
- Default sizes (`h-11` buttons/inputs) meet the 44×44px touch target minimum (NFR-09); the
  checkbox's visual box is smaller, so pair it with a `<Label htmlFor>` for a large enough
  clickable area.
