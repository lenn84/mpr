// Relay crypto (authid R7 §4.1/§4.2/§4.3). CommonJS, Node crypto only, no deps
// (house rule: the relay verifies Ed25519 natively). Shared by serve.js and the
// L2 conformance drive so the exact bytes are tested, not a paraphrase.
const crypto = require('crypto');

// Raw-32 Ed25519 public key -> a KeyObject, via the fixed SPKI prefix.
const ED_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const CHAL_WINDOW_MS = 120000; // a challenge is valid for 120s after issue
const SKEW_MS = 5000;          // two-sided: a future ts beyond this does not verify

// A constant, valid key so a malformed/absent ring still costs one Ed25519 verify
// (no roster-membership or ring-validity timing oracle; crypto MED-1).
const DUMMY = crypto.generateKeyPairSync('ed25519');

function be64(n) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; }
function pubFromRaw(raw32) {
  return crypto.createPublicKey({ key: Buffer.concat([ED_SPKI_PREFIX, raw32]), format: 'der', type: 'spki' });
}

// c = b64u( ts_be64 || HMAC(K, "mpr-chal-v1" || ts_be64) ). No per-challenge state.
function makeChallenge(K, now) {
  const tsb = be64(now);
  const mac = crypto.createHmac('sha256', K).update(Buffer.concat([Buffer.from('mpr-chal-v1'), tsb])).digest();
  return Buffer.concat([tsb, mac]).toString('base64url');
}
function verifyChallenge(K, c, now) {
  let buf; try { buf = Buffer.from(String(c), 'base64url'); } catch { return false; }
  if (buf.length !== 40) return false;
  const tsb = buf.subarray(0, 8), mac = buf.subarray(8);
  const expect = crypto.createHmac('sha256', K).update(Buffer.concat([Buffer.from('mpr-chal-v1'), tsb])).digest();
  if (mac.length !== expect.length || !crypto.timingSafeEqual(mac, expect)) return false;
  const ts = Number(tsb.readBigUInt64BE());
  if (ts > now + SKEW_MS) return false;          // no future ts (two-sided window)
  if (now - ts > CHAL_WINDOW_MS) return false;   // expired
  return true;
}

// Idempotent token: a deterministic function of the client's own nonce, so a
// replayed hello re-derives the SAME token and cannot evict a live session
// (crypto HIGH-1). A genuinely new session uses a fresh nonce.
function relayToken(K, ringBuf, nonceBuf) {
  return crypto.createHmac('sha256', K).update(Buffer.concat([ringBuf, nonceBuf])).digest().toString('base64url');
}

// sig over "mpr-hello-v1" || relay_id || ring || client_nonce || decode(challenge).
// Always costs one verify (dummy on a malformed ring) — no early-out oracle.
function verifyHelloSig(relayIdBuf, ringBuf, nonceBuf, chalBuf, sigBuf) {
  const signed = Buffer.concat([Buffer.from('mpr-hello-v1'), relayIdBuf, ringBuf, nonceBuf, chalBuf]);
  if (!ringBuf || ringBuf.length !== 32) { try { crypto.verify(null, signed, DUMMY.publicKey, sigBuf); } catch {} return false; }
  try { return crypto.verify(null, signed, pubFromRaw(ringBuf), sigBuf); } catch { return false; }
}

module.exports = { be64, makeChallenge, verifyChallenge, relayToken, verifyHelloSig, CHAL_WINDOW_MS, SKEW_MS };
