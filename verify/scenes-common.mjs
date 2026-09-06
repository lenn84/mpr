// Shared scene floor: bring up a healthy two-member ceremony on the relay rig and
// emit the per-member findings both the L5 rehearsal and the L7 observer scene share
// (compose → countersign → seed → boot the real chat → converge lineage → chat by
// petname → no alarm). Callers add their own extras (L5: negatives + truncation;
// L7: the on-path capture + downgrade probe) and call cleanup() when done.
import { newGenesis, composeCeremony } from '../census/ceremony.mjs';
import { verifyChain } from '../runtime/lib/lineage.js';
import { countersign, appendSigned } from './harness.mjs';
import { installRelay, prepareMember, waitFor, clearAllTimers } from './net.mjs';

export async function bringUpPair(sec, { prefix, header = false, now = 1000 } = {}) {
  const A = await prepareMember({ name: 'captain', petname: 'captain' });
  const B = await prepareMember({ name: 'bobby', petname: 'bobby' });

  let genesis = await newGenesis();
  const composed = await composeCeremony({ genesis, members: [A, B], params: { invite_budget: 6 }, now });
  const entries = composed.entries;
  if (header) {
    sec.check(`${prefix}: kit composed 5 entries, budget 6/2/4`,
      entries.length === 5 && composed.budget.declared === 6 && composed.budget.spent === 2,
      entries.length + ' entries ' + JSON.stringify(composed.budget));
    genesis = null;
    sec.check(`${prefix}: genesis key wiped after compose (vault stand-in)`, genesis === null, '');
  }

  const vPre = await verifyChain(entries, { requireCountersign: false });
  for (const [tag, m] of [['a', A], ['b', B]]) {
    sec.check(`${prefix} [${tag}] returned entries verify pre-countersign`, vPre.ok, '');
    sec.check(`${prefix} [${tag}] own BIRTH present`, entries.some((e) => e.type === 'BIRTH' && e.body.ring === m.ring), '');
  }
  await countersign(entries, [A, B]);
  const vStrict = await verifyChain(entries);
  for (const [tag] of [['a'], ['b']]) {
    sec.check(`${prefix} [${tag}] replica verifies strict after countersign exchange`, vStrict.ok, vStrict.reason || '');
    sec.check(`${prefix} [${tag}] invite accounting 6/2/4`,
      vStrict.budget.declared === 6 && vStrict.budget.spent === 2 && vStrict.budget.remaining === 4, JSON.stringify(vStrict.budget));
  }

  const sixForA = entries.slice();
  await appendSigned(sixForA, 'WEIGHT-REVOKE', { issuer: A.ring, target_ring: B.ring }, A);
  const v6 = await verifyChain(sixForA);
  sec.check(`${prefix} [a] seeded WEIGHT-REVOKE entry chains`, v6.ok, v6.ok ? '' : v6.reason);
  const head6 = v6.head;

  A.seedStore({ 'lineage:replica': sixForA, petnames: { [B.ring]: 'bobby' } });
  B.seedStore({ 'lineage:replica': entries, petnames: { [A.ring]: 'captain' } });

  const relay = installRelay();
  relay.roster = new Set([A.ring, B.ring]);
  const apiA = await A.start();
  const apiB = await B.start();
  sec.check(`${prefix} [a] admitted by roster (chat booted)`, apiA !== null, '');
  sec.check(`${prefix} [b] admitted by roster (chat booted)`, apiB !== null, '');

  const converged = await waitFor(async () => {
    const ra = A.readStore('lineage:replica'), rb = B.readStore('lineage:replica');
    return ra && rb && ra.length === 6 && rb.length === 6;
  }, { timeout: 5000 });
  for (const [tag, m] of [['a', A], ['b', B]]) {
    const rep = m.readStore('lineage:replica') || [];
    const v = rep.length ? await verifyChain(rep) : { ok: false };
    sec.check(`${prefix} [${tag}] replica converged to 6 entries and verifies`, converged && v.ok && rep.length === 6, rep.length + ' entries');
  }
  for (const [tag, m, peer] of [['a', A, B], ['b', B, A]]) {
    const anchors = m.readStore('lineage:anchors') || {};
    sec.check(`${prefix} [${tag}] peer anchor sits at the converged head`, anchors[peer.ring] === head6, (anchors[peer.ring] || '(none)').slice(0, 12));
  }

  await apiA.sendText('hi from the captain');
  await apiB.sendText('hi from bobby');
  await waitFor(async () => A.ui.messages.some((x) => !x.mine) && B.ui.messages.some((x) => !x.mine), { timeout: 4000 });
  await waitFor(async () => A.ui.presences.some((p) => p.online) && B.ui.presences.some((p) => p.online), { timeout: 4000 });

  sec.check(`${prefix} [a] message received rendered by PETNAME, not wire name`, A.ui.messages.some((x) => !x.mine && x.name === 'bobby'), 'bobby');
  sec.check(`${prefix} [b] message received rendered by PETNAME, not wire name`, B.ui.messages.some((x) => !x.mine && x.name === 'captain'), 'captain');
  sec.check(`${prefix} [a] presence rendered by petname`, A.ui.presences.some((p) => p.online && p.name === 'bobby'), 'bobby');
  sec.check(`${prefix} [b] presence rendered by petname`, B.ui.presences.some((p) => p.online && p.name === 'captain'), 'captain');
  sec.check(`${prefix} [a] no alarm in the healthy run`, A.ui.alarms.length === 0, A.ui.alarms.join('; '));
  sec.check(`${prefix} [b] no alarm in the healthy run`, B.ui.alarms.length === 0, B.ui.alarms.join('; '));

  const cleanup = () => { relay._restore(); clearAllTimers(); };
  return { A, B, relay, apiA, apiB, entries, sixForA, head6, cleanup };
}
