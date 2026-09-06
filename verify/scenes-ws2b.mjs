// WS2 pass B — the A2.4 / G2b two-resolution witness. ONE script drives the
// paired-channel cell over BOTH resolutions ('relay' and 'local'), with real
// members (real identity/storage/lineage, sealed envelopes), traces every
// app-visible emission, and DIFFS the semantic surfaces: message vocabulary,
// correlation behavior (recv carries correlation 0 + an authenticated from),
// per-sender ordering, and the fault set. G2b's "indistinguishable across
// resolutions" stops being asserted and becomes a measured equality.
import { PAIR_DESCRIPTOR } from '../runtime/managers/transport.js';
import { installRelay, prepareMember, waitFor, clearAllTimers } from './net.mjs';

// Bind the paired channel on a member's kernel with an EXPLICIT resolution (plans
// are data — a consumer may carry one; resolve() would default to the relay).
function bindPair(member, resolution, trace) {
  const setG = () => { globalThis.__cellIdentityMem = member.idMem; globalThis.__cellStoreMem = member.storeMem; globalThis.isSecureContext = true; };
  setG();
  const plan = { plan: [{ id: PAIR_DESCRIPTOR.id, resolution }], requirement: { need: ['channel:paired'] } };
  return member.kernel.bind(plan, { onEnvelope: (env) => trace.push(env) });
}

async function drivePair(resolution, sec, label) {
  const A = await prepareMember({ name: 'captain', petname: 'captain' });
  const B = await prepareMember({ name: 'bobby', petname: 'bobby' });
  // The witness isolates the CHANNEL surface: no lineage replica is seeded, so the
  // members run pre-ceremony plaintext mode and no lineage-sync traffic rides the
  // counter space. That keeps the surface a pure function of the resolution — the
  // sealed/lineage layer is identical code BELOW the carrier split (proven by the
  // L5–L7 scenes) and riding it here would inject scheduling-dependent sync/gap
  // notices that are a layer above channel:paired, not part of its contract.
  let relay = null;
  if (resolution === 'relay') { relay = installRelay(); relay.roster = new Set([A.ring, B.ring]); }

  const traceA = [], traceB = [];
  const chanA = bindPair(A, resolution, traceA);
  const chanB = bindPair(B, resolution, traceB);
  sec.check(`${label} both members bind the '${resolution}' resolution`, !!chanA.ref && !!chanB.ref, '');

  // the identical script: A joins, B joins, A sends m1, B sends m2, A sends m3.
  globalThis.__cellIdentityMem = A.idMem; globalThis.__cellStoreMem = A.storeMem;
  const jA = await A.kernel.transmit(chanA, { op: 'join', body: { name: 'captain' }, correlation: 'wA' });
  globalThis.__cellIdentityMem = B.idMem; globalThis.__cellStoreMem = B.storeMem;
  const jB = await B.kernel.transmit(chanB, { op: 'join', body: { name: 'bobby' }, correlation: 'wB' });
  sec.check(`${label} joins accepted on both sides`, jA.op !== 'fault' && jB.op !== 'fault', (jA.body && jA.body.detail) || '');
  await waitFor(async () => traceA.some((e) => e.op === 'joined') && traceB.some((e) => e.op === 'joined'), { timeout: 4000 });

  const send = async (member, chan, text) => member.kernel.transmit(chan, { op: 'send', body: { kind: 'msg', text }, correlation: 'w-' + text });
  await send(A, chanA, 'm1');
  await send(B, chanB, 'm2');
  await send(A, chanA, 'm3');
  await waitFor(async () => {
    const gotB = traceB.filter((e) => e.op === 'recv' && e.body && e.body.kind === 'msg').length;
    const gotA = traceA.filter((e) => e.op === 'recv' && e.body && e.body.kind === 'msg').length;
    return gotB >= 2 && gotA >= 1;
  }, { timeout: 5000 });

  // one deliberate bad op: the fault surface must match across resolutions.
  const bad = await A.kernel.transmit(chanA, { op: 'bogus', correlation: 'w-bad' });

  const surface = {
    ops: [...new Set([...traceA, ...traceB].map((e) => e.op))].sort(),
    joinedHasPeersArray: [traceA, traceB].every((t) => t.filter((e) => e.op === 'joined').every((e) => Array.isArray(e.body.peers))),
    recvCorrelationZero: [...traceA, ...traceB].filter((e) => e.op === 'recv').every((e) => e.correlation === 0),
    recvCarriesFrom: [...traceA, ...traceB].filter((e) => e.op === 'recv').every((e) => e.from && typeof e.from.ring === 'string'),
    orderAtB: traceB.filter((e) => e.op === 'recv' && e.body.kind === 'msg').map((e) => e.body.text),
    textAtA: traceA.filter((e) => e.op === 'recv' && e.body.kind === 'msg').map((e) => e.body.text),
    badOpFault: bad.op === 'fault' ? bad.body.code : 'no-fault',
    faultCodes: [...new Set([...traceA, ...traceB].filter((e) => e.op === 'fault').map((e) => e.body.code))].sort(),
    faultDetails: [...new Set([...traceA, ...traceB].filter((e) => e.op === 'fault').map((e) => e.body.code + ': ' + e.body.detail))].sort(),
  };

  await A.kernel.transmit(A.kernel.bind(A.kernel.resolve({ need: ['bind-control'] }), { onEnvelope() {} }), { op: 'release', body: { ref: chanA.ref } });
  await B.kernel.transmit(B.kernel.bind(B.kernel.resolve({ need: ['bind-control'] }), { onEnvelope() {} }), { op: 'release', body: { ref: chanB.ref } });
  if (relay) relay._restore();
  clearAllTimers();
  return surface;
}

export async function scenes(sec) {
  const relayS = await drivePair('relay', sec, 'ws2b[relay]');
  const localS = await drivePair('local', sec, 'ws2b[local]');

  // the per-resolution surface obligations…
  for (const [label, s] of [['relay', relayS], ['local', localS]]) {
    sec.check(`ws2b[${label}] recv surface: correlation 0 + authenticated from`, s.recvCorrelationZero && s.recvCarriesFrom, '');
    sec.check(`ws2b[${label}] per-sender FIFO held (B saw m1 before m3)`, s.orderAtB.indexOf('m1') > -1 && s.orderAtB.indexOf('m1') < s.orderAtB.indexOf('m3'), s.orderAtB.join(','));
    sec.check(`ws2b[${label}] counter-direction delivery (A saw m2)`, s.textAtA.includes('m2'), s.textAtA.join(','));
    sec.check(`ws2b[${label}] undeclared op refused as bad-envelope`, s.badOpFault === 'bad-envelope', s.badOpFault);
    sec.check(`ws2b[${label}] emitted fault codes within the declared set`, s.faultCodes.every((c) => PAIR_DESCRIPTOR.faults.includes(c)), s.faultCodes.join(',') || '(none)');
  }
  // …and the EQUALITY between them (the G2b sentence itself).
  sec.check('ws2b WITNESS: op vocabulary identical across resolutions', JSON.stringify(relayS.ops) === JSON.stringify(localS.ops), relayS.ops.join(',') + ' == ' + localS.ops.join(','));
  sec.check('ws2b WITNESS: joined surface identical (peers array both)', relayS.joinedHasPeersArray && localS.joinedHasPeersArray, '');
  sec.check('ws2b WITNESS: message order identical across resolutions', JSON.stringify(relayS.orderAtB) === JSON.stringify(localS.orderAtB) && JSON.stringify(relayS.textAtA) === JSON.stringify(localS.textAtA), '');
  sec.check('ws2b WITNESS: fault surface identical across resolutions', relayS.badOpFault === localS.badOpFault && JSON.stringify(relayS.faultCodes) === JSON.stringify(localS.faultCodes),
    'relay[' + relayS.faultDetails.join(' | ') + '] local[' + localS.faultDetails.join(' | ') + ']');
}
