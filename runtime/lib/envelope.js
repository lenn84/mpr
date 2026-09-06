// Signed message envelopes (authid R7 §4.4). Manager-level: the app stays blind;
// the transport wraps the app's message into a signed envelope on send and
// verifies it on receipt. Attribution is cryptographic (the signed sender/
// recipient), not inherited from the relay's stamp — the relay's authenticated
// `from` must merely AGREE. Storage keys on (sender, device, ctr): there is no
// attacker-choosable message id, so the H12 residual is closed by construction.
import { b64u, unb64u, concat, sha256, fields, CONTEXTS, verifySig } from './wire.js';

const enc = new TextEncoder();

// pair = b64u(SHA-256(sort(ringA, ringB) as raw bytes)). Order-independent.
export async function pairId(ringA, ringB) {
  const [x, y] = [ringA, ringB].sort();
  return b64u(await sha256(concat(unb64u(x), unb64u(y))));
}

// Build a signed envelope. `sign(context, payloadB64) -> {sig}` goes through the
// identity cell (the private key never leaves it).
export async function makeEnvelope({ selfRing, peerRing, kind, payload, ctr, ts, device, sign }) {
  const pair = await pairId(selfRing, peerRing);
  const payloadStr = JSON.stringify(payload);
  const ctHash = await sha256(enc.encode(payloadStr));
  const field = fields.msg(unb64u(pair), unb64u(selfRing), unb64u(peerRing), ctr, ts, ctHash);
  const s = await sign(CONTEXTS.msg, b64u(field));
  if (!s || s.op === 'fault' || !s.sig) throw new Error('sign failed');
  return { v: 1, pair, sender: selfRing, recipient: peerRing, ctr, ts, device: device || '', kind, payload: payloadStr, sig: s.sig };
}

// Verify against the relay-authenticated sender ring. The signed sender/recipient
// are load-bearing; the relay stamp must agree (belt-and-braces, crypto MED-2).
export async function verifyEnvelope(env, authedSenderRing, selfRing) {
  if (!env || env.v !== 1 || !env.sender || !env.recipient || !env.sig || typeof env.payload !== 'string') return { ok: false, reason: 'malformed' };
  if (env.sender !== authedSenderRing) return { ok: false, reason: 'sender mismatch' };
  if (env.recipient !== selfRing) return { ok: false, reason: 'not for me' };
  let pair; try { pair = await pairId(env.sender, env.recipient); } catch { return { ok: false, reason: 'bad ring' }; }
  if (env.pair !== pair) return { ok: false, reason: 'pair mismatch' };
  let ok = false;
  try {
    const ctHash = await sha256(enc.encode(env.payload));
    const field = fields.msg(unb64u(env.pair), unb64u(env.sender), unb64u(env.recipient), env.ctr, env.ts, ctHash);
    ok = await verifySig(unb64u(env.sender), CONTEXTS.msg, field, env.sig);
  } catch { ok = false; }
  if (!ok) return { ok: false, reason: 'bad signature' };
  return { ok: true, payload: JSON.parse(env.payload) };
}

// Per-(sender,device) sliding replay window + high-water. An in-window unseen ctr
// is accepted (reorder tolerated); a seen or below-window ctr is rejected; a jump
// past the high-water reports the gap (loud, never a silent drop).
export function makeWindow(size = 64) {
  const state = new Map();
  const keyOf = (sender, device) => sender + '|' + (device || '');
  return {
    check(sender, device, ctr) {
      if (!Number.isInteger(ctr) || ctr < 1) return { accept: false, reason: 'bad ctr' };
      const k = keyOf(sender, device);
      let s = state.get(k); if (!s) { s = { hw: 0, seen: new Set() }; state.set(k, s); }
      if (ctr <= s.hw - size) return { accept: false, reason: 'replay', replay: true };
      if (ctr <= s.hw) { if (s.seen.has(ctr)) return { accept: false, reason: 'replay', replay: true }; s.seen.add(ctr); return { accept: true }; }
      const gap = ctr - s.hw - 1;
      s.hw = ctr; s.seen.add(ctr);
      for (const c of s.seen) if (c <= s.hw - size) s.seen.delete(c);
      return { accept: true, gap };
    },
    seed(sender, device, hw) { state.set(keyOf(sender, device), { hw: hw | 0, seen: new Set() }); },
    highWater(sender, device) { const s = state.get(keyOf(sender, device)); return s ? s.hw : 0; },
  };
}
