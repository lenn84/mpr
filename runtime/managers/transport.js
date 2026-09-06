// Transport manager: duplex channel behind a plan (A1.5). Loopback for G1; the
// paired channel reaches the other device. v2 (authid R7 L2): the relay hello is
// a fresh challenge SIGNED by the ring — no passphrase. v3 (L3): the events stream
// authenticates by Authorization header. v4 (L4): every message is a SIGNED
// envelope (mpr-msg-v1) — attribution is cryptographic, replay is caught by a
// per-(sender,device) sliding window, and history keys on (sender,device,ctr).
// The realization holds its own binds to the identity cell (to sign) and the
// storage cell (to persist the send counter + device id across reloads), because
// it re-hellos and re-signs autonomously (Seat B F1). v5 (L5): the lineage
// replica syncs over the same signed envelopes; anchor violations raise the
// BLOCKING alarm (op 'alarm', rendered with no click-through). v6 (L6):
// per-peer verifier-side freshness with decay (soft TTL = stale badge, hard
// TTL = inbound gate until a challenge round-trips; nothing dropped silently),
// and stop-orders (issue, receive, refuse-from-stopped, stale-replay guard) —
// the stamping desk stays dissolved: the live counterparty checks freshness.
// v7 (L7): payloads are SEALED end-to-end when the lineage provides the peer's
// encryption bundle — fresh ephemeral per message, opened only by the identity
// cell; plaintext survives solely on pre-ceremony devices (no replica) or behind
// the rehearsal flag, which is deleted before the real ceremony.
import { makeFault } from '../kernel/faults.js';
import { b64u, unb64u, fields, CONTEXTS, verifySig } from '../lib/wire.js';
import { makeEnvelope, verifyEnvelope, makeWindow, pairId } from '../lib/envelope.js';
import { verifyChain, makeEntry, stoppedRings, latestContestCloseTs, bundleFor } from '../lib/lineage.js';
import { seal, sealedShape } from '../lib/e2e.js';

export const DESCRIPTOR = {
  id: 'cell://system/transport@1', provides: ['channel:duplex'], requires: [], gates: [], cost: 'low',
  mailbox: { bound: 256, drop: 'oldest' }, controlOps: [], faults: ['dead', 'bad-envelope'],
  resolutions: [{ key: 'loopback', gates: [], cost: 'low' }],
};

// The paired channel requires the identity cell (signs hellos + envelopes) and
// storage (persists the counter so replay windows survive a page reload).
export const PAIR_DESCRIPTOR = {
  id: 'cell://system/transport-pair@2', provides: ['channel:paired'], requires: ['identity:pair', 'store:kv'], gates: [], cost: 'medium',
  // A2.2 descriptor truth: the ACTUAL outbox/pending bound is 64 and a full queue
  // refuses loudly (overflow fault) — the descriptor states what the code does.
  mailbox: { bound: 64, drop: 'reject' }, controlOps: ['stop'], faults: ['dead', 'refused', 'overflow', 'bad-envelope'],
  // A2.4 (G2b witness): TWO resolutions of ONE cell. 'local' is the same
  // realization over a BroadcastChannel carrier (same-origin tabs in a browser,
  // same process headless) — one code path, two carriers, so the semantic surface
  // is identical by construction. Its cost 'high' is PREFERENCE, not compute:
  // resolve() ranks by cost, so the relay stays the default and 'local' is chosen
  // only by an explicit plan (or when a consumer deliberately prefers it).
  resolutions: [{ key: 'relay', gates: [], cost: 'medium' }, { key: 'local', gates: [], cost: 'high' }],
};

function relayRealization(emit, kernel, key) {
  // The 'local' resolution (A2.4): identical realization, different carrier — a
  // BroadcastChannel replaces the relay's HTTP+SSE. Attribution stays anchored in
  // the SIGNED envelope either way: the local carrier's `from` stamp is
  // self-asserted, and verifyEnvelope requires the signed sender to match it, so
  // a spoofed stamp still needs a forged signature and fails there.
  const isLocal = key === 'local';
  let bc = null;                 // the local carrier's channel
  const localPeers = new Map();  // ring -> name (learned from local announces)
  let cfg = null;      // durable requirement: { name } — the ring comes from the cell
  let ring = null, xPub = null;
  let token = null;
  let stream = null;
  let open = true;
  let retry = null;
  let peerRing = null, peerName = '';
  let deviceId = null;
  let ctrVal = null;
  let lin = null;      // lineage replica state: {absent} | {entries, hashes, head, anchors, births, ttl}
  const blocked = new Set();      // rings refused by stop-order (derived from lineage + session fast-path)
  const stopSeen = new Map();     // issuer ring -> highest stop seq seen (replay guard, persisted)
  const lastFresh = new Map();    // ring -> LOCAL receipt time of last verified activity (never wire ts)
  const outstanding = new Map();  // single-use freshness nonces: nonce -> {ring, at}
  const held = [];                // inbound emissions held by the hard freshness gate (bounded, flushed on restore)
  let freshTimer = null, staleEmitted = false, hardGated = false, lastChallengeAt = 0;
  // Decay clocks may be FORCED forward for the clock drills (a test seam only);
  // envelope timestamps never use this.
  const nowF = () => Date.now() + (globalThis.__cellClockForce || 0);
  const window = makeWindow(64);
  const outbox = [];   // signed envelopes awaiting the wire (store-and-forward, FIFO)
  const pending = [];  // app bodies awaiting peer discovery (cannot address yet)
  const OUTBOX_BOUND = 64;
  const base = () => globalThis.CELL_RELAY_BASE || '';

  // --- identity bind (sign hellos and envelopes)
  let idh = null; const idWaiters = new Map(); let idSeq = 0;
  function ensureIdentity() {
    if (!idh) idh = kernel.bind(kernel.resolve({ need: ['identity:pair'] }), { onEnvelope: (env) => { if (env.correlation && idWaiters.has(env.correlation)) { const w = idWaiters.get(env.correlation); idWaiters.delete(env.correlation); w(env); } } });
    return idh;
  }
  async function askId(op, body) {
    ensureIdentity();
    if (!idh || !idh.ref) return makeFault('dead', 'no identity handle', 0);
    const c = 'tid-' + (++idSeq);
    const reply = new Promise((res) => idWaiters.set(c, res)); // register before transmit (A2.1)
    const ack = await kernel.transmit(idh, { op, body, correlation: c });
    if (ack && ack.op === 'fault') { idWaiters.delete(c); return ack; }
    return reply;
  }

  // --- storage bind (persist the send counter + device id)
  let sh = null; const stWaiters = new Map(); let stSeq = 0;
  function ensureStore() {
    if (!sh) sh = kernel.bind(kernel.resolve({ need: ['store:kv'] }), { onEnvelope: (env) => { if (env.correlation && stWaiters.has(env.correlation)) { const w = stWaiters.get(env.correlation); stWaiters.delete(env.correlation); w(env); } } });
    return sh;
  }
  async function askStore(op, body) {
    ensureStore();
    if (!sh || !sh.ref) return { body: {} };
    const c = 'tst-' + (++stSeq);
    const reply = new Promise((res) => stWaiters.set(c, res));
    const ack = await kernel.transmit(sh, { op, body, correlation: c });
    if (ack && ack.op === 'fault') { stWaiters.delete(c); return { body: {} }; }
    return reply;
  }

  function nonce16() { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return b; }
  const signFn = async (context, payloadB64) => { const s = await askId('sign', { context, payload: payloadB64 }); if (s.op === 'fault') return s; return { sig: s.body.sig }; };

  // Init reads are memoized: concurrent first sends must not each run the read
  // and race the assignment (two nextCtr first-calls could otherwise both read 0
  // and both return 1 — a duplicate counter the receiver's replay window drops as
  // a replay, losing the message; two ensureDevice calls could mint two device
  // ids). One promise, guarded, then the increment is atomic (no await between
  // `+= 1` and return).
  let deviceInit = null, ctrInit = null;
  async function ensureDevice() {
    if (deviceId) return deviceId;
    if (!deviceInit) deviceInit = askStore('get', { key: 'tp:device' }).then((g) => {
      if (deviceId) return;
      if (g.body && g.body.value) deviceId = g.body.value;
      else { deviceId = b64u(nonce16()).slice(0, 12); askStore('put', { key: 'tp:device', value: deviceId }).catch(() => {}); }
    });
    await deviceInit;
    return deviceId;
  }
  async function nextCtr() {
    if (ctrVal === null) {
      if (!ctrInit) ctrInit = askStore('get', { key: 'tp:ctr:' + ring }).then((g) => { if (ctrVal === null) ctrVal = (g.body && typeof g.body.value === 'number') ? g.body.value : 0; });
      await ctrInit;
    }
    ctrVal += 1;
    askStore('put', { key: 'tp:ctr:' + ring, value: ctrVal }).catch(() => {});
    return ctrVal;
  }
  // L7: the payload is SEALED to the peer's highest-epoch lineage bundle (never a
  // wire-supplied key). A device with no replica cannot do E2E and stays plaintext
  // (pre-ceremony dev mode); a device WITH a bundle for the peer must seal — the
  // rehearsal flag is the only escape and it is deleted before the real ceremony.
  async function protect(payload) {
    const l = await ensureLineage();
    const b = l.absent ? null : bundleFor(l.bundles, peerRing);
    if (b) return seal(b.x_pub, await pairId(ring, peerRing), JSON.stringify(payload));
    if (l.absent || globalThis.CELL_REHEARSAL_PLAINTEXT) return payload;
    const e = new Error('no encryption bundle for the peer; E2E is required'); e.code = 'refused'; throw e;
  }
  async function buildEnvelope(payload) {
    await ensureDevice();
    const ctr = await nextCtr();
    const body = await protect(payload);
    return makeEnvelope({ selfRing: ring, peerRing, kind: payload.kind || 'm', payload: body, ctr, ts: Date.now(), device: deviceId, sign: signFn });
  }

  function setPeer(pr, pn) { if (!pr || pr === ring) return; const changed = peerRing !== pr; peerRing = pr; if (pn) peerName = pn; if (changed) { flushPending(); syncReq().catch(() => {}); } }
  async function flushPending() {
    while (pending.length && peerRing) { const body = pending.shift(); try { outbox.push(await buildEnvelope(body)); } catch {} }
    flushOutbox().catch(() => scheduleRebind());
  }

  async function post(envelope) {
    if (isLocal) {
      if (!bc) return { ok: false, status: 503 };
      bc.postMessage({ from: { ring, name: cfg ? cfg.name : '' }, envelope });
      return { ok: true, status: 200 };
    }
    return fetch(base() + '/relay/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, envelope }) });
  }

  // --- Lineage replica + sync (L5, §4.7). The replica is layer-1 truth persisted
  // through the storage cell; sync rides the same signed envelopes as everything
  // else, so it inherits signature verification and the replay window. The
  // per-verifier anchor is the last verified head of the peer's replica; a head
  // BEHIND the anchor is rollback/truncation and raises the BLOCKING alarm.
  // Stated scope (crypto HIGH-4): the descent check does not catch equivocation
  // or freeze/withhold — at N=2 those are the in-person head comparison's job.
  function alarm(detail) { emit({ op: 'alarm', correlation: 0, body: { code: 'lineage', detail } }); }
  function persistLineage() {
    askStore('put', { key: 'lineage:replica', value: lin.entries }).catch(() => {});
    askStore('put', { key: 'lineage:anchors', value: lin.anchors }).catch(() => {});
  }
  async function ensureLineage() {
    if (lin) return lin;
    const g = await askStore('get', { key: 'lineage:replica' });
    const entries = g.body && g.body.value;
    if (!entries || !entries.length) { lin = { absent: true }; return lin; } // pre-ceremony device: no replica, no sync
    const v = await verifyChain(entries);
    if (!v.ok) { lin = { absent: true }; alarm('local lineage replica does not verify: ' + v.reason); return lin; }
    const a = await askStore('get', { key: 'lineage:anchors' });
    lin = { entries, hashes: v.hashes, head: v.head, anchors: (a.body && a.body.value) || {},
      births: v.births, bundles: v.bundles, ttl: (entries[0].body && entries[0].body.ttl) || { soft_h: 24, hard_h: 72 } };
    refreshBlocked();
    const ss = await askStore('get', { key: 'stop:seen' });
    if (ss.body && ss.body.value) for (const [k, s] of Object.entries(ss.body.value)) stopSeen.set(k, Math.max(stopSeen.get(k) || 0, s));
    return lin;
  }
  // The stop state derives from the log (plus any stop received this session whose
  // lineage entry has not synced in yet — that entry arrives by the issuer's push).
  const fastStops = new Set();
  function memberRings() { return (lin && lin.births) ? lin.births.map((b) => b.ring) : []; }
  function refreshBlocked() {
    if (!lin || lin.absent) return;
    blocked.clear();
    for (const r of stoppedRings(lin.entries, memberRings())) blocked.add(r);
    for (const r of fastStops) blocked.add(r);
  }
  // Lineage MUTATIONS are read-modify-write on the shared `lin` across async
  // awaits (verifyChain, seal), so they must not interleave or one stale-base
  // write clobbers another (same discipline storage.js uses for its backend).
  // Serialize onSyncReq / onSync / appendLocal through one chain; syncReq is a
  // pure reader and stays off it.
  let linChain = Promise.resolve();
  const linSerial = (fn) => { const r = linChain.then(fn); linChain = r.catch(() => {}); return r; };

  async function syncReq() {
    const l = await ensureLineage();
    if (l.absent || !peerRing) return;
    internalSend({ kind: 'lineage-sync-req', head: l.head });
  }
  function onSyncReq(p, sender) { return linSerial(async () => {
    const l = await ensureLineage(); if (l.absent) return;
    const pos = l.hashes.indexOf(p.head);
    const aPos = l.anchors[sender] ? l.hashes.indexOf(l.anchors[sender]) : -1;
    if (pos >= 0 && aPos >= 0 && pos < aPos) { alarm('peer lineage head is BEHIND its anchor: rollback or truncation'); return; }
    // Unknown head: the peer is ahead of me or divergent — send the full replica
    // and let the peer's own descent check judge it.
    if (pos < 0) { internalSend({ kind: 'lineage-sync', from_anchor: null, entries: l.entries }); return; }
    internalSend({ kind: 'lineage-sync', from_anchor: p.head, entries: l.entries.slice(pos + 1) });
    if (pos >= aPos) { l.anchors[sender] = p.head; persistLineage(); }
  }); }
  function onSync(p, sender) { return linSerial(async () => {
    const l = await ensureLineage(); if (l.absent) return;
    const run = Array.isArray(p.entries) ? p.entries : [];
    if (p.from_anchor === null) {
      // The peer sent its full replica: it must be my chain byte for byte, as a
      // prefix, an extension, or an equal — anything else is divergence.
      const v = await verifyChain(run);
      if (!v.ok) { alarm('peer lineage does not verify: ' + v.reason); return; }
      const m = Math.min(v.hashes.length, l.hashes.length);
      for (let i = 0; i < m; i++) if (v.hashes[i] !== l.hashes[i]) { alarm('lineage DIVERGENCE at entry ' + i); return; }
      const aPos = l.anchors[sender] ? l.hashes.indexOf(l.anchors[sender]) : -1;
      if (v.hashes.length > l.hashes.length) { lin = { ...l, entries: run, hashes: v.hashes, head: v.head, births: v.births, bundles: v.bundles }; lin.anchors[sender] = v.head; refreshBlocked(); persistLineage(); syncReq().catch(() => {}); return; }
      if (v.hashes.length - 1 < aPos) { alarm('peer lineage head is BEHIND its anchor: rollback or truncation'); return; }
      l.anchors[sender] = v.head; persistLineage(); return;
    }
    // A run computed from a head that is no longer mine is stale; if the anchor it
    // grew from is unknown to me entirely, re-announce my head instead.
    if (p.from_anchor !== l.head) { if (l.hashes.indexOf(p.from_anchor) < 0) syncReq().catch(() => {}); return; }
    if (!run.length) { l.anchors[sender] = l.head; persistLineage(); return; } // peer agrees with my head
    const v = await verifyChain(l.entries.concat(run));
    if (!v.ok) { alarm('lineage sync run does not descend from my head: ' + v.reason); return; }
    lin = { ...l, entries: l.entries.concat(run), hashes: v.hashes, head: v.head, births: v.births, bundles: v.bundles };
    lin.anchors[sender] = v.head; refreshBlocked(); persistLineage();
    syncReq().catch(() => {}); // confirm convergence so the peer anchors my new head
  }); }
  // A local append (a stop-order at L6): verify, persist, and PUSH the run to the
  // peer — gossip on next contact must not wait for the peer to ask (§4.6).
  function appendLocal(entry) { return linSerial(async () => {
    const l = await ensureLineage(); if (l.absent) return false;
    const v = await verifyChain(l.entries.concat([entry]));
    if (!v.ok) return false;
    const prevHead = l.head;
    lin = { ...l, entries: l.entries.concat([entry]), hashes: v.hashes, head: v.head, births: v.births, bundles: v.bundles };
    refreshBlocked(); persistLineage();
    internalSend({ kind: 'lineage-sync', from_anchor: prevHead, entries: [entry] });
    return true;
  }); }

  // --- Freshness and decay (L6, §4.5). Verifier-side, per-peer, keyed on LOCAL
  // receipt time only — a wire-supplied ts never touches last_fresh (crypto
  // HIGH-3). Soft TTL surfaces a stale badge; hard TTL gates NEW inbound trust
  // until a single-use verifier-bound challenge round-trips; gated messages are
  // HELD and flushed in order, never dropped silently (W1). TTLs come from the
  // ceremony constitution (GENESIS-DECL); the check cadence is an execution
  // parameter (5s). Honest limit, stated: decay bites an INACTIVE thief only —
  // a thief holding the unlocked device answers challenges silently.
  const FRESH_CHECK_MS = 5000, CHALLENGE_MIN_GAP_MS = 8000, HELD_BOUND = 64;
  function ttlMs() { const t = (lin && lin.ttl) || { soft_h: 24, hard_h: 72 }; return { soft: t.soft_h * 3600 * 1000, hard: t.hard_h * 3600 * 1000 }; }
  function markFresh(r) {
    if (hardGated && peerRing === r) return; // while gated, only a challenge round-trip restores
    lastFresh.set(r, nowF());
    if (staleEmitted && peerRing === r) { staleEmitted = false; emit({ op: 'fresh', correlation: 0, body: { ring: r, name: peerName } }); }
  }
  function restoreFresh(r) {
    lastFresh.set(r, nowF());
    const wasGated = hardGated; hardGated = false; staleEmitted = false;
    emit({ op: 'fresh', correlation: 0, body: { ring: r, name: peerName } });
    if (wasGated) { const q = held.splice(0); for (const h of q) emit(h); }
  }
  function issueChallenge() {
    if (!peerRing || nowF() - lastChallengeAt < CHALLENGE_MIN_GAP_MS) return;
    lastChallengeAt = nowF();
    const nonce = b64u(nonce16());
    outstanding.set(nonce, { ring: peerRing, at: nowF() });
    setTimeout(() => outstanding.delete(nonce), 30000);
    internalSend({ kind: 'fresh-challenge', nonce });
  }
  function checkFresh() {
    if (!peerRing || !lastFresh.has(peerRing)) return;
    const age = nowF() - lastFresh.get(peerRing);
    const t = ttlMs();
    if (age > t.hard) {
      if (!hardGated) { hardGated = true; emit(makeFault('refused', 'peer freshness hard-expired (' + Math.round(age / 3600000) + 'h): new inbound held until a challenge round-trips', 0)); }
      issueChallenge();
    } else if (age > t.soft) {
      if (!staleEmitted) { staleEmitted = true; emit({ op: 'stale', correlation: 0, body: { ring: peerRing, name: peerName, last: lastFresh.get(peerRing) } }); issueChallenge(); }
    }
  }
  function startFreshness() { if (!freshTimer) freshTimer = setInterval(checkFresh, FRESH_CHECK_MS); }
  async function onFreshChallenge(p, sender) {
    // No-prompt heartbeat: sign verifier_ring ‖ nonce ‖ ts — the verifier's ring
    // scopes the response to THAT verifier (no cross-verifier replay).
    const ts = Date.now();
    const s = await askId('sign', { context: CONTEXTS.fresh, payload: b64u(fields.fresh(unb64u(sender), unb64u(p.nonce), ts)) });
    if (s.op === 'fault') return;
    internalSend({ kind: 'fresh-response', nonce: p.nonce, ts, fsig: s.body.sig });
  }
  async function onFreshResponse(p, sender) {
    const o = outstanding.get(p.nonce);
    if (!o || o.ring !== sender) return; // unknown or replayed nonce: not news
    outstanding.delete(p.nonce);         // single-use: retire before anything else
    let ok = false;
    try { ok = await verifySig(unb64u(sender), CONTEXTS.fresh, fields.fresh(unb64u(ring), unb64u(p.nonce), p.ts), p.fsig); } catch { ok = false; }
    if (ok) restoreFresh(sender);
  }

  // --- Stop-orders (L6, §4.6). At N=2 the only issuer is the counterpart; the
  // per-issuer seq lives in the issuer's own lineage; the receive path guards
  // seq monotonicity and the latest cross-signed CONTEST-CLOSE so a replayed
  // stale stop cannot re-block a cleared victim.
  const cellSign = async (c, p) => { const r = await askId('sign', { context: c, payload: p }); if (r.op === 'fault') throw new Error('sign refused'); return r.body.sig; };
  async function issueStop(correlation) {
    const l = await ensureLineage();
    if (l.absent) return makeFault('refused', 'no verifiable lineage replica: a stop-order is a ceremony-plane act', correlation);
    if (!peerRing) return makeFault('refused', 'no peer to stop', correlation);
    const seq = 1 + l.entries.reduce((m, e) => (e.type === 'STOP' && e.body.issuer === ring ? Math.max(m, e.body.seq) : m), 0);
    const ts = Date.now();
    let sig;
    try { sig = await cellSign(CONTEXTS.stop, b64u(fields.stop(unb64u(ring), unb64u(peerRing), seq, ts))); }
    catch { return makeFault('refused', 'sign refused', correlation); }
    const entry = await makeEntry({ n: l.entries.length, prevHash: l.head, ts, type: 'STOP', body: { issuer: ring, target_ring: peerRing, seq } }, [{ ring, sign: cellSign }]);
    if (!(await appendLocal(entry))) return makeFault('refused', 'stop entry does not chain', correlation);
    await internalSend({ kind: 'stop', issuer: ring, target_ring: peerRing, seq, ts, sig });
    emit({ op: 'stopped', correlation, body: { target: peerRing, seq } });
    return { accepted: true, correlation };
  }
  async function onStop(p, sender) {
    const l = await ensureLineage();
    if (p.issuer !== sender) { emit(makeFault('refused', 'stop-order issuer does not match its sender', 0)); return; }
    if (!l.absent && !memberRings().includes(p.issuer)) { emit(makeFault('refused', 'stop-order from a ring outside the ceremony', 0)); return; }
    if (!(p.seq > (stopSeen.get(p.issuer) || 0))) { emit(makeFault('refused', 'stale stop-order replay refused', 0)); return; }
    if (!l.absent && latestContestCloseTs(l.entries, p.target_ring, memberRings()) >= p.ts) { emit(makeFault('refused', 'stop-order predates the contest close for its target', 0)); return; }
    let ok = false;
    try { ok = await verifySig(unb64u(p.issuer), CONTEXTS.stop, fields.stop(unb64u(p.issuer), unb64u(p.target_ring), p.seq, p.ts), p.sig); } catch { ok = false; }
    if (!ok) { emit(makeFault('refused', 'stop-order signature does not verify', 0)); return; }
    stopSeen.set(p.issuer, p.seq);
    askStore('put', { key: 'stop:seen', value: Object.fromEntries(stopSeen) }).catch(() => {});
    fastStops.add(p.target_ring); refreshBlocked(); if (lin && lin.absent) blocked.add(p.target_ring);
    alarm('STOP ORDER from the counterpart: ring ' + String(p.target_ring).slice(0, 8) + '… is stopped' + (p.target_ring === ring ? ' — THIS device is the target' : ''));
  }

  // Receive: verify the signed envelope (attribution is the SIGNED sender, which
  // the relay's authenticated stamp must merely agree with), apply the replay
  // window, then deliver the payload. A gap is announced loudly, never dropped
  // silently; a replay is dropped silently (a duplicate is not news).
  async function onFrame(m) {
    if (!m) return;
    // A2.3: the relay announces frames it dropped from this session's offline
    // queue; surfaced as a loud overflow (the receiver-side ctr-gap alarm remains
    // the end-to-end backstop for the same loss).
    if (m.relay_notice && m.relay_notice.dropped) { emit(makeFault('overflow', 'relay dropped ' + m.relay_notice.dropped + ' queued frame(s) while this device was offline', 0)); return; }
    if (!m.envelope) return;
    if (m.envelope.__peer) { setPeer(m.from && m.from.ring, m.from && m.from.name); return; }
    const authed = m.from && m.from.ring;
    const v = await verifyEnvelope(m.envelope, authed, ring);
    if (!v.ok) { emit(makeFault('refused', 'unverified message (' + v.reason + ')', 0)); return; }
    // Stop gate (§4.6): a stopped ring's envelopes are refused whole — loudly,
    // before they touch the window, freshness, or the app.
    if (blocked.has(m.envelope.sender)) { emit(makeFault('refused', 'envelope from a STOPPED ring refused', 0)); return; }
    const r = window.check(m.envelope.sender, m.envelope.device, m.envelope.ctr);
    if (!r.accept) { if (r.replay) return; emit(makeFault('refused', 'message rejected (' + r.reason + ')', 0)); return; }
    if (r.gap) emit(makeFault('refused', 'message gap: ' + r.gap + ' missing before this one', 0));
    setPeer(m.from.ring, m.from.name);
    markFresh(m.envelope.sender); // verified activity refreshes decay (no-op while hard-gated)
    // L7: a sealed payload is opened by the IDENTITY CELL (the static key never
    // leaves it). The outer signature was verified above, over the ciphertext —
    // tamper fails there, before AEAD ever runs. A PLAINTEXT payload from a ring
    // we hold a bundle for is a downgrade and is refused (rehearsal flag aside).
    let payload = v.payload;
    if (sealedShape(payload)) {
      const o = await askId('open', { pair: m.envelope.pair, e: payload.e, c: payload.c });
      if (o.op === 'fault') { emit(makeFault('refused', 'sealed payload does not decrypt', 0)); return; }
      try { payload = JSON.parse(o.body.plaintext); } catch { emit(makeFault('refused', 'sealed payload malformed', 0)); return; }
    } else {
      const l = await ensureLineage();
      if (!l.absent && bundleFor(l.bundles, m.envelope.sender) && !globalThis.CELL_REHEARSAL_PLAINTEXT) { emit(makeFault('refused', 'plaintext payload refused: E2E is required on this pair', 0)); return; }
    }
    // Transport-internal kinds: they ride verified envelopes and the replay window
    // like everything else, but never reach the app. Freshness traffic must run
    // even under the hard gate, or the gate could never re-open.
    if (payload && payload.kind === 'lineage-sync-req') { onSyncReq(payload, m.envelope.sender).catch(() => {}); return; }
    if (payload && payload.kind === 'lineage-sync') { onSync(payload, m.envelope.sender).catch(() => {}); return; }
    if (payload && payload.kind === 'fresh-challenge') { onFreshChallenge(payload, m.envelope.sender).catch(() => {}); return; }
    if (payload && payload.kind === 'fresh-response') { onFreshResponse(payload, m.envelope.sender).catch(() => {}); return; }
    if (payload && payload.kind === 'stop') { onStop(payload, m.envelope.sender).catch(() => {}); return; }
    // Hard freshness gate (§4.5): NEW inbound from a hard-stale ring is HELD, not
    // rendered and not dropped, until a challenge round-trips (W1, fail-closed).
    const emission = { op: 'recv', correlation: 0, body: payload, from: { ring: m.envelope.sender, name: (m.from && m.from.name) || peerName }, ctr: m.envelope.ctr };
    if (hardGated && m.envelope.sender === peerRing) {
      if (held.length < HELD_BOUND) held.push(emission);
      else emit(makeFault('overflow', 'freshness hold queue full, message dropped', 0));
      issueChallenge();
      return;
    }
    emit(emission);
  }

  // L3: the events stream is read via fetch with the token in the Authorization
  // header. A fetch stream does not auto-reconnect, so the read loop drives rebind.
  async function readStream(myToken, ac) {
    let res;
    try { res = await fetch(base() + '/relay/events', { headers: { Authorization: 'Bearer ' + myToken }, signal: ac.signal }); }
    catch (e) { if (open && token === myToken) scheduleRebind(); return; }
    if (!res.ok || !res.body) { if (open && token === myToken) scheduleRebind(); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (open) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const dl = frame.split('\n').find((l) => l.startsWith('data:'));
          if (dl) { let m; try { m = JSON.parse(dl.slice(5).trim()); } catch { continue; } await onFrame(m); }
        }
      }
    } catch (e) { /* aborted or dropped */ }
    if (open && token === myToken) scheduleRebind();
  }

  // Single-flight drain, SHARED: concurrent callers await the same in-flight
  // promise (not a fast-returned 0), so a sender learns the true fate of its item
  // (A2.3 ack honesty). The while condition re-reads outbox.length, so items
  // pushed mid-drain are drained in order by the same flight; the finally re-kick
  // closes the push-after-exit window (the L8 strand fix, kept in this shape).
  let flushPromise = null;
  async function drainOutbox() {
    let n = 0;
    while (outbox.length) {
      const r = await post(outbox[0]);
      if (!r.ok) throw new Error('flush refused ' + r.status);
      outbox.shift(); n++;
    }
    return n;
  }
  function flushOutbox() {
    if (!flushPromise) {
      // Re-kick ONLY after a successful drain (the push-after-exit strand window);
      // a FAILED drain must not re-kick here — that would retry at microtask speed
      // and starve the loop while the link is down. Failure paths schedule the
      // 800ms rebind instead.
      flushPromise = drainOutbox()
        .then((n) => { flushPromise = null; return outbox.length ? flushOutbox().then((m) => n + m) : n; })
        .catch((e) => { flushPromise = null; throw e; });
    }
    return flushPromise;
  }

  // Send core shared by the app path and the transport's own lineage traffic.
  // A2.3 FIFO obligation: EVERY send goes through the outbox and the single-flight
  // drain — two concurrent sends can no longer race each other onto the wire
  // (the old empty-outbox fast path posted in parallel and wire order was arrival
  // order). The ack derives from whether the drain moved the item: gone => handed
  // to the relay; still queued => buffered for the link (store-and-forward).
  async function sendCore(signed) {
    if (outbox.length >= OUTBOX_BOUND) return 'dropped';
    outbox.push(signed);
    try { await flushOutbox(); } catch (e) { scheduleRebind(); }
    return outbox.includes(signed) ? 'queued' : 'sent';
  }
  async function internalSend(body) {
    if (!ring || !peerRing) { if (pending.length < OUTBOX_BOUND) pending.push(body); return; }
    let signed; try { signed = await buildEnvelope(body); } catch { return; }
    await sendCore(signed);
  }

  // The local carrier's join: open the channel, announce, give existing peers a
  // beat to answer, and report them — the same joined surface the relay returns.
  async function helloLocal() {
    if (!bc) {
      bc = new BroadcastChannel('cell-local-pair');
      bc.onmessage = (ev) => {
        const m = ev.data;
        if (!m || !open) return;
        if (m.__hello && m.from && m.from.ring !== ring) {
          localPeers.set(m.from.ring, m.from.name || '');
          try { bc.postMessage({ from: { ring, name: cfg ? cfg.name : '' }, envelope: { __peer: true } }); } catch {}
          onFrame({ from: m.from, envelope: { __peer: true } }).catch(() => {});
          return;
        }
        if (m.from && m.from.ring === ring) return; // own announce echoed by a sibling context
        if (m.envelope && m.envelope.__peer) localPeers.set(m.from.ring, m.from.name || '');
        onFrame(m).catch(() => {});
      };
    }
    bc.postMessage({ __hello: true, from: { ring, name: cfg.name } });
    await new Promise((r) => setTimeout(r, 150)); // collect announces
    const peers = [...localPeers.entries()].map(([r, name]) => ({ ring: r, name }));
    if (peers[0]) setPeer(peers[0].ring, peers[0].name);
    return { peers };
  }

  async function hello() {
    if (!ring) { const m = await askId('mint', { name: cfg.name }); if (m.op === 'fault') { const e = new Error('identity unavailable'); e.code = 'refused'; throw e; } ring = m.body.ring; xPub = m.body.x_pub; }
    if (isLocal) return helloLocal();
    const cr = await fetch(base() + '/relay/challenge');
    const cj = await cr.json();
    if (!cj.c || !cj.relay_id) { const e = new Error('no challenge'); e.code = 'refused'; throw e; }
    const nonce = nonce16();
    const field = fields.hello(unb64u(cj.relay_id), unb64u(ring), nonce, unb64u(cj.c));
    const s = await askId('sign', { context: CONTEXTS.hello, payload: b64u(field) });
    if (s.op === 'fault') { const e = new Error('sign refused'); e.code = 'refused'; throw e; }
    const r = await fetch(base() + '/relay/hello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ring, name: cfg.name, client_nonce: b64u(nonce), challenge: cj.c, sig: s.body.sig }) });
    const j = await r.json();
    if (!r.ok || !j.ok) { const e = new Error((j.body && j.body.detail) || 'refused'); e.code = (j.body && j.body.code) || 'refused'; throw e; }
    token = j.token;
    if (j.peers && j.peers[0] && j.peers[0].ring) setPeer(j.peers[0].ring, j.peers[0].name);
    openStream();
    return j;
  }

  function openStream() { if (isLocal) return; if (stream) { try { stream.abort(); } catch {} } stream = new AbortController(); readStream(token, stream); }
  function scheduleRebind() {
    if (retry || !open || !cfg) return;
    retry = setTimeout(async () => {
      retry = null; if (!open) return;
      try { const j = await hello(); const flushed = await flushOutbox(); emit({ op: 'rebound', correlation: 0, body: { peers: (j.peers || []).map((p) => p.name), flushed } }); syncReq().catch(() => {}); }
      catch (e) { scheduleRebind(); }
    }, 800);
  }

  return {
    async accept(env) {
      if (!open) return makeFault('dead', 'channel closed', env.correlation);
      if (env.op === 'join' && env.body) {
        cfg = { name: env.body.name || '' };
        try {
          const j = await hello();
          ensureLineage().catch(() => {}); // load the replica + derived stop state up front
          startFreshness();
          emit({ op: 'joined', correlation: env.correlation, body: { peers: (j.peers || []).map((p) => p.name), ring } });
          return { accepted: true, correlation: env.correlation };
        }
        catch (e) { return makeFault(e.code === 'refused' ? 'refused' : 'dead', e.message, env.correlation); }
      }
      // The stop-order verb (L6): the human's act of cutting a compromised key off.
      if (env.op === 'stop') return issueStop(env.correlation);
      if (env.op === 'send' && env.body) {
        // Can't sign an addressed envelope until the peer ring is known — hold it.
        if (!ring || !peerRing) { if (pending.length >= OUTBOX_BOUND) return makeFault('overflow', 'send buffer full', env.correlation); pending.push(env.body); return { accepted: true, correlation: env.correlation, queued: true }; }
        let signed; try { signed = await buildEnvelope(env.body); } catch (e) { return makeFault(e.code === 'refused' ? 'refused' : 'dead', e.code === 'refused' ? e.message : 'sign failed', env.correlation); }
        const r = await sendCore(signed);
        if (r === 'sent') return { accepted: true, correlation: env.correlation };
        if (r === 'queued') return { accepted: true, correlation: env.correlation, queued: true };
        return makeFault('overflow', 'outbox full, message dropped', env.correlation);
      }
      return makeFault('bad-envelope', env.op, env.correlation);
    },
    async close() {
      open = false;
      if (retry) clearTimeout(retry);
      if (freshTimer) { clearInterval(freshTimer); freshTimer = null; }
      if (stream) { try { stream.abort(); } catch {} }
      if (bc) { try { bc.close(); } catch {} bc = null; }
      try { if (token) await fetch(base() + '/relay/session', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }); } catch {}
    },
  };
}

export function register(kernel) {
  kernel.registerFactory(DESCRIPTOR.id, (key, emit) => {
    let open = true;
    return {
      accept(env) {
        if (!open) return makeFault('dead', 'channel closed', env.correlation);
        if (env.op === 'send' && env.body) {
          queueMicrotask(() => { if (open) emit({ op: 'recv', correlation: env.correlation, body: env.body }); });
          return { accepted: true, correlation: env.correlation };
        }
        return makeFault('bad-envelope', env.op, env.correlation);
      },
      close() { open = false; },
    };
  });
  kernel.registerFactory(PAIR_DESCRIPTOR.id, (key, emit) => relayRealization(emit, kernel, key));
  return [DESCRIPTOR, PAIR_DESCRIPTOR];
}
