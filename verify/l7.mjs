// L7 — E2E baseline. Unit battery (10) reproduces the "l7-unit:" findings of
// raw/drive-headless-l7-e2e against the real runtime/lib/e2e.js + envelope.js. The
// on-path-observer SCENE (relay-backed, capture + downgrade probe) lives in
// ./scenes-l7.mjs.
import { seal, open as e2eOpen, sealedShape } from '../runtime/lib/e2e.js';
import { makeEnvelope, verifyEnvelope, pairId } from '../runtime/lib/envelope.js';
import { makeActor } from './harness.mjs';
export { scenes } from './scenes-l7.mjs';

export async function unit(sec) {
  const A = await makeActor('captain'); // sender
  const B = await makeActor('bobby');   // recipient (holds the static X25519 key)
  const other = await makeActor('eve');
  const pair = await pairId(A.ring, B.ring);

  const s1 = await seal(B.x_pub, pair, 'the letter');
  const back = await e2eOpen(B.xPriv, pair, s1.e, s1.c);
  sec.check('l7-unit: seal/open roundtrip', back === 'the letter', back);
  sec.check('l7-unit: sealed shape recognized', sealedShape(s1) === true, '');

  const s2 = await seal(B.x_pub, pair, 'the letter');
  sec.check('l7-unit: fresh ephemeral per message (e differs, c differs)', s1.e !== s2.e && s1.c !== s2.c, '');

  sec.check('l7-unit: sealed blob carries no plaintext', !JSON.stringify(s1).includes('the letter'), '');

  await sec.guard('l7-unit: wrong static key cannot decrypt', async () => {
    try { await e2eOpen(other.xPriv, pair, s1.e, s1.c); return false; } catch { return true; }
  });

  await sec.guard('l7-unit: tampered ciphertext fails AEAD', async () => {
    const bad = { ...s1, c: flip(s1.c) };
    try { await e2eOpen(B.xPriv, pair, bad.e, bad.c); return false; } catch { return true; }
  });

  await sec.guard('l7-unit: sealed payload is bound to its pair id', async () => {
    const wrongPair = await pairId(A.ring, other.ring);
    try { await e2eOpen(B.xPriv, wrongPair, s1.e, s1.c); return false; } catch { return true; }
  });

  // A sealed payload inside a signed envelope: the outer mpr-msg-v1 signature covers
  // the ciphertext, so tamper fails the signature before AEAD ever runs.
  const sign = (actor) => async (ctx, p) => ({ sig: await actor.sign(ctx, p) });
  const env = await makeEnvelope({ selfRing: A.ring, peerRing: B.ring, kind: 'm', payload: s1, ctr: 1, ts: 1000, device: 'dev', sign: sign(A) });
  const v = await verifyEnvelope(env, A.ring, B.ring);
  sec.check('l7-unit: sealed envelope verifies and yields the sealed payload', v.ok && sealedShape(v.payload), v.ok ? '' : v.reason);
  {
    const tampered = { ...env, payload: JSON.stringify({ e: s1.e, c: flip(s1.c) }) };
    const vt = await verifyEnvelope(tampered, A.ring, B.ring);
    sec.check('l7-unit: tampered ciphertext fails the OUTER signature before AEAD ever runs', !vt.ok, vt.reason || '');
  }

  // The honest NO: a compromised recipient STATIC key decrypts past traffic. The
  // shipped key is non-extractable — this drill uses B's own static key to show the
  // property, not to weaken the claim.
  {
    const past = await seal(B.x_pub, pair, 'yesterday');
    const dec = await e2eOpen(B.xPriv, pair, past.e, past.c);
    sec.check('l7-unit: COMPROMISE DRILL: recipient-static key decrypts past traffic (the honest NO, demonstrated)', dec === 'yesterday', '');
  }
}

// Flip one base64url char so the decoded ciphertext changes by at least one byte.
function flip(b64) {
  const i = Math.floor(b64.length / 2);
  const ch = b64[i];
  const rep = ch === 'A' ? 'B' : 'A';
  return b64.slice(0, i) + rep + b64.slice(i + 1);
}
