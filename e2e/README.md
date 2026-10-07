# @plumas/e2e

Playwright tests that drive the real app in a real browser: the invite → signup → sign-in
loop, the rejection paths, and existing-member sign-in.

```bash
pnpm exec playwright install --with-deps chromium  # once
pnpm test:e2e
```

Needs `DATABASE_URL` etc. sourced (same `.env` as the rest of the repo) and the local Postgres
up - tests seed data directly via `@plumas/db`.

## How a test "receives email"

The dev server's stdout is redirected to `.tmp/web.log` (configured in `playwright.config.ts`);
`helpers/mail.ts` polls that file for the invite/magic-link URLs the console-fallback email
transport logs there (no Resend account needed), the same way a person would click a link in
their real inbox. Tests run serially (`workers: 1`) because they share that one log file.

## Why invites are created through the UI, not a direct function call

`helpers/seed.ts` only ever inserts a `users` row directly - it deliberately does not call
`@plumas/auth`'s `createInvite` in-process. That function sends a real email, which renders a
React Email template (`.tsx`), and Playwright's own JSX handling for test files produced
elements `react-dom/server` couldn't render ("Objects are not valid as a React child (found:
object with keys `{__pw_type, type, props, key}`)") when that rendering happened inside the
_test_ process. Routing invite creation through the real `/settings/invites` UI (see `helpers/ui.ts`'s
`signInAsExisting`, and `invite-signup.spec.ts`) sidesteps the conflict entirely and is more
representative of what actually happens anyway.

## `waitForHydration`

Needed before filling/clicking a form: without it, Playwright can interact before TanStack
Start's client JS attaches event handlers, so the browser's native (uncontrolled) form submit
fires instead - a real GET to the current URL - rather than the intended POST. The obvious fix,
`page.waitForLoadState("networkidle")`, doesn't work here: Vite's dev server keeps an HMR
WebSocket open indefinitely, so network never actually goes idle, and the wait hung for
minutes in practice. `helpers/wait-for-hydration.ts` uses a short bounded delay instead.

## A real bug this suite caught

The first real run of the invite-accept form failed on `.check()`-ing the 18+ checkbox:
Playwright reported it as present but with a `0x0` bounding box. The cause had nothing to do
with the checkbox specifically - Tailwind v4's automatic content detection scans from the CSS
file's own project root and does not cross into other pnpm workspace packages, so every
utility class used only inside `packages/ui`'s own components (`h-5`, `w-5`, the
`data-[state=checked]:...` variants, and more) was silently missing from the generated CSS in
`apps/web`. The class names still rendered fine in the HTML - React doesn't know any
better - so this was invisible to every curl/text-based check done while building the app, and
only surfaced once something actually measured layout in a real browser. Fixed with a
`@source ".."` directive in `packages/ui/src/styles/globals.css`.
