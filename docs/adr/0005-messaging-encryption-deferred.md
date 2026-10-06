# 0005 — End-to-end encrypted messaging deferred

**Status:** Accepted

## Context

The PRD's direct-messages feature (FR-DM) requires end-to-end encryption via MLS (IETF RFC
9420), gated by a two-week crypto spike evaluating OpenMLS (WebAssembly) vs. ts-mls before any
DM UI is built. That entire feature area, including its UI, server functions, and the MLS
client itself, is out of scope for Phase 0 (Foundations).

## Decision

- **`packages/crypto` exists now, empty** (`export {}`), so the workspace, Turborepo
  pipeline, and CI already account for it — wiring it up later is additive, not a new
  workspace member needing its own tsconfig/eslint/CI plumbing.
- **The database schema for messaging exists now too** (`messages`, `conversations`,
  `conversation_participants`, `devices`, `key_packages`, `dm_backups`), even though no
  application code reads or writes to it yet, to avoid schema churn when that phase starts.
  `messages.ciphertext` is `bytea` with no plaintext column, enforced by code review and this
  ADR, not a database constraint — Postgres can't type-check "never decryptable."

## Consequences

- No custom cryptographic primitives will be written when this phase starts — an audited,
  maintained MLS implementation only, per the PRD's explicit requirement.
- The crypto spike (library choice, device linking, multi-device backup/restore) is a
  prerequisite for any DM build work in that later phase, not something this phase attempted
  or de-risked.
