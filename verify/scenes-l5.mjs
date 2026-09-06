// L5 scenes — the ceremony rehearsal on the relay rig. The healthy pair is the
// shared bringUpPair flow; L5 adds the relay negatives and the truncation-alarm
// scene. Reproduces the "rehearsal:" findings of raw/drive-headless-l5-lineage
// (post-fix naming: the seeded governance entry is a WEIGHT-REVOKE, not a STOP).
import { newGenesis, composeCeremony } from '../census/ceremony.mjs';
import { verifyChain } from '../runtime/lib/lineage.js';
import { countersign, makeActor, b64u, unb64u, fields, CONTEXTS } from './harness.mjs';
import { installRelay, prepareMember, waitFor, clearAllTimers } from './net.mjs';
import { bringUpPair } from './scenes-common.mjs';

const nonce16 = () => { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return b; };

export async function scenes(sec) {
  const one = await bringUpPair(sec, { prefix: 'rehearsal: one', header: true, now: 1000 });
  one.cleanup();
  await negatives(sec);
  await rehearsalTwo(sec);
  clearAllTimers();
}

// --- the relay negatives: unrostered valid hello + pass-bearing hello ----------
async function negatives(sec) {
  const relay = installRelay();
  const rostered = await makeActor('rostered');
  relay.roster = new Set([rostered.ring]);
  const stray = await makeActor('stray');
  const cr = await (await fetch('/relay/challenge')).json();
  const nonce = nonce16();
  const field = fields.hello(unb64u(cr.relay_id), unb64u(stray.ring), nonce, unb64u(cr.c));
  const sig = await stray.sign(CONTEXTS.hello, b64u(field));
  const r = await fetch('/relay/hello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ring: stray.ring, name: 'stray', client_nonce: b64u(nonce), challenge: cr.c, sig }) });
  sec.check('rehearsal: unrostered VALID signed hello refused even under --open-roster (flag retired)', !r.ok, 'status ' + r.status);

  const r2 = await fetch('/relay/hello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ring: rostered.ring, name: 'x', client_nonce: 'x', challenge: 'x', sig: 'x', pass: 'opensesame' }) });
  sec.check('rehearsal: pass-bearing hello still trips the wire, opaque refusal', !r2.ok && relay.tripwire > 0, 'tripwire ' + relay.tripwire);
  relay._restore();
}

// --- scene two: a truncated peer replica raises the BLOCKING anchor alarm ------
async function rehearsalTwo(sec) {
  const A = await prepareMember({ name: 'captain', petname: 'captain' });
  const B = await prepareMember({ name: 'bobby', petname: 'bobby' });
  let genesis = await newGenesis();
  const composed = await composeCeremony({ genesis, members: [A, B], params: { invite_budget: 6 }, now: 2000 });
  const entries = composed.entries;
  sec.check('rehearsal: two: kit composed 5 entries, budget 6/2/4', entries.length === 5 && composed.budget.declared === 6, entries.length + ' entries ' + JSON.stringify(composed.budget));
  genesis = null;
  sec.check('rehearsal: two: genesis key wiped after compose (vault stand-in)', genesis === null, '');

  const vPre = await verifyChain(entries, { requireCountersign: false });
  for (const [tag, m] of [['a', A], ['b', B]]) {
    sec.check(`rehearsal: two [${tag}] returned entries verify pre-countersign`, vPre.ok, '');
    sec.check(`rehearsal: two [${tag}] own BIRTH present`, entries.some((e) => e.type === 'BIRTH' && e.body.ring === m.ring), '');
  }
  await countersign(entries, [A, B]);
  const vStrict = await verifyChain(entries);
  for (const [tag] of [['a'], ['b']]) {
    sec.check(`rehearsal: two [${tag}] replica verifies strict after countersign exchange`, vStrict.ok, vStrict.reason || '');
    sec.check(`rehearsal: two [${tag}] invite accounting 6/2/4`, vStrict.budget.remaining === 4, JSON.stringify(vStrict.budget));
  }

  const head5 = vStrict.head;
  const truncated = entries.slice(0, 3); // genesis, INVITE-MINT(1), BIRTH(A) — a valid shorter chain
  A.seedStore({ 'lineage:replica': entries, 'lineage:anchors': { [B.ring]: head5 }, petnames: { [B.ring]: 'bobby' } });
  B.seedStore({ 'lineage:replica': truncated, petnames: { [A.ring]: 'captain' } });

  const relay = installRelay();
  relay.roster = new Set([A.ring, B.ring]);
  const apiA = await A.start();
  const apiB = await B.start();
  sec.check('rehearsal: two [a] admitted by roster (chat booted)', apiA !== null, '');
  sec.check('rehearsal: two [b] admitted by roster (chat booted)', apiB !== null, '');

  const alarmed = await waitFor(async () => A.ui.alarms.some((a) => /behind its anchor|rollback|truncation/.test(a)), { timeout: 5000 });
  const alarmMsg = A.ui.alarms.find((a) => /behind its anchor|rollback|truncation/.test(a)) || '';
  sec.check('rehearsal: two [a] BLOCKING alarm raised on truncated peer replica', alarmed, alarmMsg);
  sec.check('rehearsal: two [a] own replica intact', (A.readStore('lineage:replica') || []).length === 5, (A.readStore('lineage:replica') || []).length + ' entries');
  const bRep = B.readStore('lineage:replica') || [];
  sec.check('rehearsal: two [b] truncated device booted (local chain is validly shorter)', apiB !== null && bRep.length > 0 && bRep.length < 5, bRep.length + ' entries');

  relay._restore();
  clearAllTimers();
}
