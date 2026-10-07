# 0006 — MLS library choice for direct messages

**Status:** Accepted

## Context

`docs/adr/0005-messaging-encryption-deferred.md` gated all DM build work behind a crypto spike
evaluating OpenMLS (WebAssembly) vs. ts-mls against the PRD's pass criteria: a 1:1 chat, a
50-member group, device linking by QR code, and backup/restore, all with send-to-receive under
2 seconds, across iOS Safari, Chrome Android, desktop Chrome, Firefox and Safari.

This spike built a working prototype against each PRD scenario (`packages/crypto/src/spike/`,
with Vitest coverage) plus a manual browser harness (`packages/crypto/harness/`) for the parts
that only a real browser can exercise (actual QR image rendering/scanning, actual
`crypto.subtle`). It is a time-boxed spike, not the real DM client - that gets built in its own
later task on top of this decision.

## Library comparison

|                                   | ts-mls                                                                                                           | OpenMLS                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Language                          | Pure TypeScript                                                                                                  | Rust, compiled to WASM for the browser                                                                                    |
| License                           | MIT                                                                                                              | MIT (but see below)                                                                                                       |
| RFC 9420 coverage                 | Broad, including external joins/commits and modern + post-quantum ciphersuites                                   | Broad, reference-quality                                                                                                  |
| Browser integration risk          | None - no WASM toolchain, no `.wasm` MIME/CORS/instantiation concerns across browsers                            | Real - no official npm/WASM-bindings package exists for it                                                                |
| Closest usable WASM wrapper       | n/a                                                                                                              | `@wireapp/core-crypto` (Wire's production library) - **GPL-3.0**, bundles Proteus + a full keystore this app doesn't need |
| Maturity signal                   | 109 stars, 624 commits, active - but already 16 release candidates into a breaking v2.0.0 API redesign on `main` | Phoenix R&D/CE Labs maintained, 2,000+ commits, used as the basis for a shipping product (Wire)                           |
| Formal third-party security audit | **None found** (explicitly disclaimed in their own README)                                                       | **None found** (checked the repo directly; no audit badge, report link, or mention)                                       |

Building bespoke WASM bindings directly against OpenMLS was considered and rejected for this
spike - it's a multi-day undertaking on its own, not something a time-boxed spike should
absorb, and the only ready-made wrapper (core-crypto) brings a GPL-3.0 license and far more
surface area (Proteus, a full cross-platform keystore) than this app needs.

**The prototype was built with ts-mls**, pinned to its last stable release (`v1.6.4` - `main`
has already moved to an incompompatible v2.0.0-rc API that this spike does not track).

## Critical finding: the audit requirement

ADR 0005 says: _"No custom cryptographic primitives will be written when this phase starts -
an audited, maintained MLS implementation only, per the PRD's explicit requirement."_

**Neither candidate has a documented, public, formal third-party security audit as of this
research.** This isn't a reason to reject both outright - audits get commissioned, and an
unaudited-but-well-reviewed implementation is a normal state for a library at this stage - but
it means this spike cannot report "ts-mls clears the PRD's bar today." That's a product-owner
decision (commission an audit before launch, accept the residual risk for a 25-person private
beta, or re-evaluate against whichever library has completed an audit by the time DM build
work actually starts), not an engineering one, and it should be made explicitly rather than
by default.

## Results against the PRD's pass criteria

All four scenarios passed functionally, in both the automated test suite (Node, via Vitest)
and a real browser (desktop Chrome, via the manual harness). Per-message latency is the
number that maps to the PRD's "under 2 seconds" budget; one-time group _formation_ is a
separate, much slower cost addressed below.

| Scenario                                                                                                  | Node (Vitest)      | Desktop Chrome (harness)                                      |
| --------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| 1:1 send-to-decrypt                                                                                       | 3.8ms              | 0.9ms                                                         |
| 50-member group: **formation** (50 sequential single-add commits)                                         | ~28.2s             | ~8.8s                                                         |
| 50-member group: **single-message fan-out** (send + 49 decrypts) - the number that maps to the PRD budget | 41.8ms             | 7.7ms                                                         |
| Device linking: MLS-level (byte round trip, new device decrypts immediately)                              | 16.5ms             | pass                                                          |
| Device linking: **real QR image round-trip** (render → pixels → scan via `jsqr` → decode)                 | n/a (browser-only) | 74.6ms, byte-exact, 320-byte KeyPackage → 444-char QR payload |
| Backup/restore: brand-new client decrypts post-backup + resumes sending/receiving                         | pass               | 77.3ms, pass                                                  |

All well under the PRD's 2-second budget for actual message latency. **Group formation is the
one real performance finding**: forming a 50-member group by committing one Add proposal at a
time is slow (~9-28s depending on runtime) because each commit has to be processed by every
existing member. This is a one-time setup cost, not a per-message cost, but 9+ seconds is still
a UX problem for, say, a 50-person family group created all at once. The fix is straightforward
and doesn't require a different library: `createCommit`'s `extraProposals` already accepts an
array, so a bulk-invite flow should batch multiple Add proposals into **one** commit instead of
committing them one at a time - this is an implementation note for the real DM build task, not
a ts-mls limitation.

## Cross-browser matrix

The PRD's pass criteria span iOS Safari, Chrome Android, desktop Chrome, Firefox and Safari.
This environment has only desktop Chrome and desktop Safari installed, and only Chrome is
automatable here:

| Browser           | Status                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop Chrome    | **Tested** - all four scenarios run via the browser automation tool, including the real QR pixel round-trip, see table above                                                                                                                                                                                       |
| Desktop Safari    | **Not verified.** The harness page was launched in Safari; full interactive verification requires either the user driving it by hand, or granting this environment's Automation/Apple-Events permission for Safari (a one-time macOS permission only the user can grant - not something this spike forced through) |
| Firefox (desktop) | **Not available in this environment** - not installed                                                                                                                                                                                                                                                              |
| iOS Safari        | **Not available in this environment** - no device/simulator                                                                                                                                                                                                                                                        |
| Chrome Android    | **Not available in this environment** - no device/emulator                                                                                                                                                                                                                                                         |

Three of the five required targets are explicitly untested gaps, not silently-assumed passes.
Given ts-mls has zero WASM/native dependencies (no `crypto.subtle` feature beyond what
`@hpke/core` itself needs, which is standard Web Crypto available in every current browser),
the engineering risk on the untested targets is low relative to a WASM-based alternative, but
"low risk" is not the same as "verified" - closing this gap needs real devices or a service
like BrowserStack, in a follow-up pass before DM work ships.

## Decision

**Proceed with ts-mls for the real DM client**, pinned to a specific stable release the same
way this spike was (not tracking `main`'s in-progress v2.0.0 redesign until it ships and gets
re-evaluated). Before DM build work ships to the beta:

1. **Resolve the audit question explicitly** with the product owner - this is the one item
   this spike cannot close on its own.
2. **Verify the three untested browser targets** (Firefox desktop, iOS Safari, Chrome Android)
   on real devices or BrowserStack.
3. **Batch bulk-invite commits** (multiple Add proposals per commit) rather than one-at-a-time,
   per the group-formation timing finding above.

## Consequences

- `packages/crypto`'s real DM client implementation (device keys, the client state machine,
  the encrypted backup flow) is a separate, later task building on `ts-mls` directly, informed
  by the exact API shapes this spike already validated in `packages/crypto/src/spike/`.
- `packages/crypto/src/spike/` and `packages/crypto/harness/` stay in the repo as working,
  tested reference code for that task, not as the client itself - `src/index.ts`'s placeholder
  export is unchanged.
- If a formal audit becomes a hard requirement before launch and neither library has one by
  then, OpenMLS (via a dedicated WASM-bindings effort, or Wire's core-crypto despite its
  GPL-3.0 license) remains the fallback path, given it's the more battle-tested implementation
  underlying a shipping product.
