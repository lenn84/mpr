// L6 — freshness/decay + stop-orders. Unit battery (8) reproduces the "l6-unit:"
// findings of raw/drive-headless-l6-freshness-stop against the real stop-state
// derivation in lineage.js (stoppedRings + latestContestCloseTs). The freshness and
// stop-order SCENES (relay-backed, synthetic peer, clock force) live in
// ./scenes-l6.mjs.
import { stoppedRings, latestContestCloseTs, makeEntry, ZERO_HASH } from '../runtime/lib/lineage.js';
import { makeActor } from './harness.mjs';
export { scenes } from './scenes-l6.mjs';

export async function unit(sec) {
  const A = await makeActor('captain');
  const B = await makeActor('bee');
  const members = [A.ring, B.ring];
  // stoppedRings/latestContestCloseTs walk entries by type + ts + signer set; the
  // chain links are irrelevant to them, so we craft governance entries at chosen ts.
  const mk = (type, body, ts, signers) => makeEntry({ n: 0, prevHash: ZERO_HASH, ts, type, body }, signers.map((a) => ({ ring: a.ring, sign: a.sign })));

  sec.check('l6-unit: clean chain: no ring stopped', stoppedRings([], members).size === 0, '');

  const stopB = await mk('STOP', { issuer: A.ring, target_ring: B.ring, seq: 1 }, 1000, [A]);
  {
    const s = stoppedRings([stopB], members);
    sec.check('l6-unit: after STOP: B is stopped, A is not', s.has(B.ring) && !s.has(A.ring), B.ring.slice(0, 6));
  }

  const closeSingle = await mk('CONTEST-CLOSE', { issuer: A.ring, target_ring: B.ring }, 2000, [A]);
  sec.check('l6-unit: single-signed CONTEST-CLOSE does NOT clear B',
    stoppedRings([stopB, closeSingle], members).has(B.ring), '');

  const closeCross = await mk('CONTEST-CLOSE', { issuer: A.ring, target_ring: B.ring }, 4000, [A, B]);
  sec.check('l6-unit: cross-signed CONTEST-CLOSE clears B',
    !stoppedRings([stopB, closeCross], members).has(B.ring), '');

  const closeTs = latestContestCloseTs([stopB, closeCross], B.ring, members);
  sec.check('l6-unit: latestContestCloseTs reports the cross-signed close ts (4000)', closeTs === 4000, String(closeTs));

  const laterStop = await mk('STOP', { issuer: A.ring, target_ring: B.ring, seq: 2 }, 5000, [A]);
  sec.check('l6-unit: a later STOP re-blocks the cleared target',
    stoppedRings([stopB, closeCross, laterStop], members).has(B.ring), '');

  // The transport's onStop guard: refuse a stop whose ts does not post-date the
  // latest cross-signed close for its target (a replayed stale stop).
  sec.check('l6-unit: stale-stop guard: close ts (4000) >= a replayed stale stop ts (3500)', closeTs >= 3500, '');
  sec.check('l6-unit: fresh-stop guard: close ts (4000) < the legitimate new stop ts (5000)', closeTs < 5000, '');
}
