# @plumas/crypto

Placeholder for now. This package will hold the MLS (RFC 9420) end-to-end encryption client for
direct messages: device key management, a Web Worker running the MLS implementation, and
encrypted history backup/restore. `src/index.ts` stays an empty placeholder export until that
real client is built, in its own later task.

**The crypto spike gating that work is done** — see `docs/adr/0006-mls-library-choice.md` for
the full write-up. Library choice: **ts-mls** (pinned to `v1.6.4`), pure TypeScript, no WASM
toolchain. `src/spike/` has working, Vitest-covered prototypes of all four PRD pass criteria
(1:1 chat, 50-member group, device linking by QR code, encrypted backup/restore) — reference
code for the real implementation, not the implementation itself. `harness/` is a small Vite app
for manually exercising the same scenarios in a real browser (`pnpm --filter @plumas/crypto
harness`), including a real QR-code image render/scan round-trip that Vitest can't cover.
