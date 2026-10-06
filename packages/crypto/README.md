# @plumas/crypto

Placeholder. This package will hold the MLS (RFC 9420) end-to-end encryption client for direct
messages: device key management, a Web Worker running the MLS implementation (OpenMLS or
ts-mls — the crypto spike picks one), and encrypted history backup/restore.

That work is scoped to the DMs/encryption phase, gated by a two-week crypto spike (see
docs/adr/0005). This package exists now, empty, so the workspace, Turborepo pipeline and CI
already account for it — wiring it up later is additive, not a new workspace member needing
plumbing.
