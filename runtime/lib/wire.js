// Shared wire crypto + canonicalization for the identity plane (authid R7 §4.1).
// Manager-level (not app): may touch crypto.subtle; the app stays blind and never
// imports this. Runs identically in the browser and in Node (both expose
// crypto.subtle Ed25519/X25519, btoa/atob).

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

// --- base64url, unpadded, everywhere on the wire (§4.1).
export function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- fixed-width fields (§4.1: no variable-width field in any signed concat).
export function be64(n) {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}
export function concat(...parts) {
  const arrs = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : (p instanceof Uint8Array ? p : new Uint8Array(p))));
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
export async function sha256(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Uint8Array(await subtle.digest('SHA-256', b));
}

// --- Domain-separation registry (§4.1): all seven, none a prefix of another.
export const CONTEXTS = {
  hello: 'mpr-hello-v1', msg: 'mpr-msg-v1', fresh: 'mpr-fresh-v1', stop: 'mpr-stop-v1',
  bundle: 'mpr-bundle-v1', lineage: 'mpr-lineage-v1', chal: 'mpr-chal-v1',
};
export const CONTEXT_SET = new Set(Object.values(CONTEXTS));

// The exact bytes an Ed25519 signature covers = context ‖ fields. The identity
// cell prepends the (allowlisted) context so a signature always carries a
// registry domain; callers build the fixed-width field concat below.
export function signedBytes(context, fieldBytes) {
  return concat(context, fieldBytes instanceof Uint8Array ? fieldBytes : unb64u(fieldBytes));
}

// Field-concat builders (no context prefix — the cell adds it). Inputs are raw
// Uint8Arrays for the 32/16-byte fields and JS numbers for the *_be64 fields.
export const fields = {
  hello: (relayId, ring, clientNonce, challengeBytes) => concat(relayId, ring, clientNonce, challengeBytes),
  msg: (pair, sender, recipient, ctr, ts, ctHash) => concat(pair, sender, recipient, be64(ctr), be64(ts), ctHash),
  fresh: (verifierRing, nonce, ts) => concat(verifierRing, nonce, be64(ts)),
  stop: (issuer, targetRing, seq, ts) => concat(issuer, targetRing, be64(seq), be64(ts)),
  bundle: (epoch, ring, xPub) => concat(be64(epoch), ring, xPub),
  lineage: (typeTag, n, ts, prevHash, bodyHash) => concat(be64(typeTag), be64(n), be64(ts), prevHash, bodyHash),
};

// --- verify (public): callers check others' signatures against ceremony-recorded
// rings (never a wire-supplied key). ringRaw32 is the raw Ed25519 public key.
export async function verifySig(ringRaw32, context, fieldBytes, sig) {
  if (!CONTEXT_SET.has(context)) return false;
  const key = await subtle.importKey('raw', ringRaw32, { name: 'Ed25519' }, false, ['verify']);
  const s = sig instanceof Uint8Array ? sig : unb64u(sig);
  return subtle.verify({ name: 'Ed25519' }, key, s, signedBytes(context, fieldBytes));
}

export const ringId = (pubRaw32) => b64u(pubRaw32);

// --- RFC 8785 JCS (used by the lineage log, L5). Adequate for pilot data: ASCII
// keys, integer numbers, base64url string fields. (Full 8785 UTF-16 key ordering
// and float formatting are unneeded here; keys are ASCII, numbers are integers.)
export function jcs(value) { return canon(value); }
function canon(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite in JCS'); return JSON.stringify(v); }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  throw new Error('uncanonicalizable ' + typeof v);
}
