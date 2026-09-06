// L7 scene — the on-path observer. The healthy pair runs over the fetch-shim relay,
// which is itself the observation point: every /relay/send envelope is captured. A
// deliberate downgrade probe (a validly-signed but PLAINTEXT envelope from a real
// key-holder) must be refused loudly and never rendered. Reproduces the "l7-scene:"
// findings of raw/drive-headless-l7-e2e.
import { makeEnvelope } from '../runtime/lib/envelope.js';
import { b64u, unb64u, fields, CONTEXTS } from './harness.mjs';
import { waitFor } from './net.mjs';
import { bringUpPair } from './scenes-common.mjs';

const nonce16 = () => { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return b; };

export async function scenes(sec) {
  const { A, B, relay, cleanup } = await bringUpPair(sec, { prefix: 'l7-scene:', now: 1000 });

  // A real key-holder posts a validly-signed PLAINTEXT envelope (a downgrade). Get a
  // token via a fresh hello as A, then inject the probe through /relay/send so the
  // observer captures it — the point is that it is refused, not that it is hidden.
  const cr = await (await fetch('/relay/challenge')).json();
  const nonce = nonce16();
  const field = fields.hello(unb64u(cr.relay_id), unb64u(A.ring), nonce, unb64u(cr.c));
  const hsig = await A.sign(CONTEXTS.hello, b64u(field));
  const hj = await (await fetch('/relay/hello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ring: A.ring, name: 'captain', client_nonce: b64u(nonce), challenge: cr.c, sig: hsig }) })).json();
  const token = hj.token;

  const probeMsg = { kind: 'msg', from: { name: 'captain', ring: A.ring, session: A.ring }, at: 999, text: 'PLAINTEXT-LEAK' };
  const probe = await makeEnvelope({ selfRing: A.ring, peerRing: B.ring, kind: 'msg', payload: probeMsg, ctr: 1, ts: 1_700_000_000_500, device: 'probe-dev', sign: async (ctx, p) => ({ sig: await A.sign(ctx, p) }) });
  const pr = await fetch('/relay/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, envelope: probe }) });
  sec.check('l7-scene: [a] downgrade probe posted (valid signature, plaintext payload)', pr.ok, '');

  const refused = await waitFor(async () => B.ui.statuses.some((s) => /plaintext payload refused|E2E is required/.test(s)), { timeout: 3000 });
  const refText = B.ui.statuses.find((s) => /plaintext payload refused|E2E is required/.test(s)) || '';
  sec.check('l7-scene: [b] plaintext downgrade REFUSED loudly (E2E required on this pair)', refused, refText);
  sec.check('l7-scene: [b] PLAINTEXT-LEAK never rendered', !B.ui.messages.some((m) => m.text === 'PLAINTEXT-LEAK'), '');

  // the on-path capture audit.
  const isSealed = (env) => { try { const p = JSON.parse(env.payload); return p && typeof p.e === 'string' && typeof p.c === 'string' && p.kind === undefined; } catch { return false; } };
  const captured = relay.captured;
  const sealed = captured.filter(isSealed).length;
  const plaintext = captured.length - sealed;
  const capStr = JSON.stringify(captured);
  sec.check('l7-scene: observer saw the traffic (sends captured)', captured.length >= 2, captured.length + ' sends');
  sec.check('l7-scene: every send on the wire is SEALED except the one deliberate probe',
    plaintext === 1 && sealed === captured.length - 1, sealed + ' sealed, ' + plaintext + ' plaintext');
  sec.check('l7-scene: no chat plaintext anywhere in the capture',
    !capStr.includes('hi from the captain') && !capStr.includes('hi from bobby'), '');
  sec.check('l7-scene: the deliberate downgrade probe IS visible in the capture (why it must be refused)',
    capStr.includes('PLAINTEXT-LEAK'), '');

  cleanup();
}
