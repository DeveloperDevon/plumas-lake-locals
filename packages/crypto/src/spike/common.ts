/**
 * Task #21 crypto spike - evaluating ts-mls against the PRD's MLS pass criteria
 * (docs/adr/0006-mls-library-choice.md). Not production code: the real DM client gets built
 * in its own later task once this spike concludes. Pinned to ts-mls v1.6.4's actual API
 * (verified against the installed package's compiled .d.ts files and that exact tag's own
 * test suite) - the library's `main` branch has already moved on to a breaking v2.0.0-rc
 * redesign, which this spike deliberately does not track.
 */
import type {
  Ciphersuite,
  CiphersuiteImpl,
  CiphersuiteName,
  Credential,
  KeyPackage,
  PrivateKeyPackage,
} from "ts-mls";
import {
  ciphersuites,
  defaultCapabilities,
  defaultLifetime,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
} from "ts-mls";

// MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 - the MTI (mandatory-to-implement) ciphersuite
// per RFC 9420, and the one every MLS client is guaranteed to support.
export const SPIKE_CIPHERSUITE: CiphersuiteName = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";

export function allCiphersuiteNames(): CiphersuiteName[] {
  return Object.keys(ciphersuites) as CiphersuiteName[];
}

export async function getImpl(name: CiphersuiteName = SPIKE_CIPHERSUITE): Promise<CiphersuiteImpl> {
  const cs: Ciphersuite = getCiphersuiteFromName(name);
  return getCiphersuiteImpl(cs);
}

export interface Member {
  name: string;
  publicPackage: KeyPackage;
  privatePackage: PrivateKeyPackage;
}

export async function createMember(name: string, impl: CiphersuiteImpl): Promise<Member> {
  const credential: Credential = {
    credentialType: "basic",
    identity: new TextEncoder().encode(name),
  };
  const { publicPackage, privatePackage } = await generateKeyPackage(
    credential,
    defaultCapabilities(),
    defaultLifetime,
    [],
    impl,
  );
  return { name, publicPackage, privatePackage };
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
