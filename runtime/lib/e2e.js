// E2E baseline (authid R7 §4.8, L7). Per message: a FRESH ephemeral X25519 pair
// (reuse forbidden — one ephemeral per message) → ECDH against the peer's STATIC
// bundle key → HKDF-SHA256 with info = "mpr-e2e-v1" ‖ pair ‖ eph_pub → AES-256-GCM.
// The 96-bit GCM nonce is fixed all-zero, and that is SAFE ONLY because the key is
// unique per message (eph_pub is unique and bound into the KDF info); no key is
// ever used under two nonces. The ephemeral private key is non-extractable and
// dropped after the single derive — the sender holds no static decryption key, so
// sender-key compromise does not expose past SENT messages.
//
// Split of duties: seal() is sender-side and touches no custody (the ephemeral is
// born and dies here). open() needs the recipient's STATIC private key, so it is
// called ONLY by the identity cell (op 'open') — the static key never crosses the
// cell boundary. The peer's static x_pub comes from the LINEAGE replica at the
// highest epoch (§4.1), never from the wire.
//
// Honest claims (verbatim scope, §4.8): confidentiality against third LAN devices
// and non-participant relays — YES. Forward secrecy against RECIPIENT-static
// compromise — NO: a compromised recipient static key decrypts all past traffic
// to it. KCI resistance / double-ratchet / Signal-grade E2E — NO, future work.
import { b64u, unb64u, concat } from './wire.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const INFO = 'mpr-e2e-v1'; // KDF info label, not a signature context — not in the §4.1 registry
const ZERO_IV = new Uint8Array(12);

async function kdf(sharedBits, pairRaw32, ephPubRaw32) {
  const km = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: concat(INFO, pairRaw32, ephPubRaw32) },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// -> { e: eph_pub b64u, c: ciphertext b64u }. Both travel INSIDE the envelope's
// payload string, so the outer mpr-msg-v1 signature covers them: a tampered e or
// c fails the signature before AEAD ever runs.
export async function seal(peerXPubB64u, pairB64u, plaintext) {
  const peerPub = await subtle.importKey('raw', unb64u(peerXPubB64u), { name: 'X25519' }, false, []);
  const eph = await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']); // fresh per message, dropped after use
  const ephPubRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: peerPub }, eph.privateKey, 256));
  const key = await kdf(bits, unb64u(pairB64u), ephPubRaw);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: ZERO_IV }, key, enc.encode(plaintext)));
  return { e: b64u(ephPubRaw), c: b64u(ct) };
}

// xPriv is the custodied static X25519 CryptoKey (identity cell only). Throws on
// tamper or wrong key (AEAD failure) — the caller converts that to a fault.
export async function open(xPriv, pairB64u, e, c) {
  const ephPub = await subtle.importKey('raw', unb64u(e), { name: 'X25519' }, false, []);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: ephPub }, xPriv, 256));
  const key = await kdf(bits, unb64u(pairB64u), unb64u(e));
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: ZERO_IV }, key, unb64u(c));
  return new TextDecoder().decode(pt);
}

export const sealedShape = (p) => !!p && typeof p === 'object' && typeof p.e === 'string' && typeof p.c === 'string' && p.kind === undefined;
