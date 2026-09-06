// L5 — lineage machinery. Unit battery (21) reproduces raw/drive-headless-l5-lineage
// "unit:" findings against the real runtime/lib/lineage.js; the ceremony rehearsal
// scenes live in ./scenes-l5.mjs (relay-backed). This module is pure library — no
// relay, deterministic, fast — the bedrock regression floor.
import { verifyChain, makeRun, mayMint, addSig, chainHash } from '../runtime/lib/lineage.js';
import { throwawayCeremony, countersign, appendSigned } from './harness.mjs';
export { scenes } from './scenes-l5.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));

export async function unit(sec) {
  // --- the base ceremony: genesis + two BIRTHs, budget 6, 2 spent.
  const { genesis, actors, entries, roster } = await throwawayCeremony({ members: 2, budget: 6, now: 1000 });

  const vPre = await verifyChain(entries, { requireCountersign: false });
  sec.check('unit: composed chain verifies (countersigns pending)', vPre.ok, vPre.ok ? 'head ' + vPre.head.slice(0, 12) : vPre.reason);

  const vStrictPre = await verifyChain(entries);
  sec.check('unit: strict verify REFUSES before countersigns', !vStrictPre.ok, vStrictPre.reason || '');

  await countersign(entries, actors);
  const vStrict = await verifyChain(entries);
  sec.check('unit: strict verify passes after both countersigns', vStrict.ok, vStrict.reason || '');

  const b = vStrict.budget;
  sec.check('unit: budget conservation: 6 declared, 2 spent, 4 remaining',
    b.declared === 6 && b.spent === 2 && b.remaining === 4, JSON.stringify(b));

  sec.check('unit: roster written from the BIRTH entries', roster.length === 2, roster.length + ' rings');

  // --- tamper battery (each on a deep copy; the base chain stays intact).
  {
    const t = clone(entries); t[4].body.petname_hint = (t[4].body.petname_hint || '') + '!';
    const v = await verifyChain(t);
    sec.check('unit: tampered body rejected', !v.ok, v.reason || '');
  }
  {
    const t = clone(entries); t[4].type = 'REANCHOR'; // sig covers the type tag
    const v = await verifyChain(t);
    sec.check('unit: re-typed entry rejected (signature covers type)', !v.ok, '');
  }
  {
    const t = clone(entries); t[4].ts = t[4].ts + 5000; // sig covers ts
    const v = await verifyChain(t);
    sec.check('unit: re-timed entry rejected (signature covers ts)', !v.ok, '');
  }
  {
    const t = clone(entries); t[4].n = 9; // renumber
    const v = await verifyChain(t);
    sec.check('unit: renumbered entry rejected', !v.ok, '');
  }
  {
    const t = clone(entries); t[2].prev_hash = t[1].prev_hash; // break the link
    const v = await verifyChain(t);
    sec.check('unit: broken chain link rejected', !v.ok, '');
  }
  {
    const t = clone(entries); const tmp = t[2]; t[2] = t[3]; t[3] = tmp; // reorder
    const v = await verifyChain(t);
    sec.check('unit: reordered entries rejected', !v.ok, '');
  }
  {
    const t = clone(entries).slice(1); // drop genesis
    const v = await verifyChain(t);
    sec.check('unit: front-truncated replica rejected (no genesis declaration)', !v.ok, '');
  }
  {
    const t = clone(entries); t[4].sigs = t[4].sigs.filter((s) => s.ring === genesis.ring); // strip the countersign
    const v = await verifyChain(t);
    sec.check('unit: stripped countersign rejected strict', !v.ok, v.reason || '');
  }

  // --- conservation: a provisional-ring mint, a double-spend, and the mayMint clause.
  {
    // append an INVITE-MINT (entry 5) that claims genesis issuer but is signed by a member.
    const t = clone(entries);
    const prevHash = await chainHash(t[t.length - 1]);
    const badMint = { n: t.length, prev_hash: prevHash, ts: t[t.length - 1].ts + 1, type: 'INVITE-MINT', body: { issuer: genesis.ring, mint_seq: 3, remaining: 3 }, sigs: [] };
    // sign with a provisional member (not genesis) — the required genesis signature is absent.
    await addSig(badMint, actors[0].ring, actors[0].sign);
    t.push(badMint);
    const v = await verifyChain(t);
    sec.check('unit: INVITE-MINT by a provisional ring rejected', !v.ok, v.reason || '');
  }
  {
    // a bespoke chain where a second BIRTH re-spends mint_seq 1 (entry 4):
    // [0 genesis, 1 mint(seq1), 2 birth(ref1), 3 mint(seq2), 4 birth(reuses ref1)].
    const base = await throwawayCeremony({ members: 2, budget: 6, now: 3000 });
    await countersign(base.entries, base.actors);
    // craft: [0 genesis,1 mint1,2 birth1,3 mint2,4 birth-that-reuses-mint1]
    const t = base.entries.slice(0, 3); // genesis, mint1(seq1), birth1(ref1)
    const gen = base.genesis;
    const mint2 = { n: 3, prev_hash: await chainHash(t[2]), ts: t[2].ts + 1, type: 'INVITE-MINT', body: { issuer: gen.ring, mint_seq: 2, remaining: 4 }, sigs: [] };
    await addSig(mint2, gen.ring, gen.sign); t.push(mint2);
    const m0 = base.actors[0];
    const birthDup = { n: 4, prev_hash: await chainHash(mint2), ts: mint2.ts + 1, type: 'BIRTH', body: { ring: m0.ring, x_pub: m0.x_pub, bundle_epoch: m0.bundle_epoch, bundle_sig: m0.bundle_sig, petname_hint: 'dup', anchor: 'PROVISIONAL-SOFTWARE', invite_ref: { issuer_ring: gen.ring, mint_seq: 1 } }, sigs: [] };
    await addSig(birthDup, gen.ring, gen.sign); await addSig(birthDup, m0.ring, m0.sign); t.push(birthDup);
    const v = await verifyChain(t);
    sec.check('unit: double-spent invite rejected', !v.ok, v.reason || '');
  }

  sec.check('unit: mayMint refuses a provisional ring',
    mayMint(actors[0].ring, vStrict).ok === false, mayMint(actors[0].ring, vStrict).reason || '');
  sec.check('unit: mayMint allows genesis inside budget', mayMint(genesis.ring, vStrict).ok === true, '');
  {
    const tight = await throwawayCeremony({ members: 2, budget: 2, now: 4000 });
    await countersign(tight.entries, tight.actors);
    const v = await verifyChain(tight.entries);
    const mm = mayMint(tight.genesis.ring, v);
    sec.check('unit: third mint refused at exhausted budget (client-side, clause ii)', mm.ok === false, mm.reason || '');
  }

  // --- format-only governance types chain and verify (Q/S shapes ship now).
  {
    const t = clone(entries);
    // re-hydrate signer actors for the appended entries (clone lost the sign fns).
    const A = actors[0], B = actors[1];
    await appendSigned(t, 'STOP', { issuer: A.ring, target_ring: B.ring, seq: 1 }, A);
    await appendSigned(t, 'CONTEST-OPEN', { issuer: B.ring, target_ring: B.ring }, B);
    await appendSigned(t, 'CONTEST-CLOSE', { issuer: A.ring, target_ring: B.ring }, A);
    await appendSigned(t, 'WEIGHT-REVOKE', { issuer: A.ring, target_ring: B.ring }, A);
    const v = await verifyChain(t);
    sec.check('unit: STOP/CONTEST/WEIGHT-REVOKE formats chain and verify', v.ok, v.ok ? t.length + ' entries' : v.reason);
  }

  // --- sync runs.
  {
    const v = await verifyChain(entries);
    const known = makeRun(entries, v.hashes, v.hashes[2]);
    sec.check('unit: makeRun from a known head yields the suffix',
      known.found === true && known.entries.length === entries.length - 3, known.entries.length + ' entries');
    const unknown = makeRun(entries, v.hashes, 'not-a-real-head');
    sec.check('unit: makeRun from an unknown head yields the full replica',
      unknown.found === false && unknown.entries.length === entries.length, '');
  }
}
