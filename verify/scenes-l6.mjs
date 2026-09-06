// L6 scenes — freshness/decay against a SYNTHETIC signed peer (whose challenge
// responses we control, so we can watch a peer go stale → hard-gated → restored),
// and the stop-order race between two real members. Reproduces the "l6-fresh:" and
// "l6-stop:" findings of raw/drive-headless-l6-freshness-stop. The clock is forced
// forward only through the transport's declared test seam (__cellClockForce); no
// envelope timestamp ever uses it.
import { newGenesis, composeCeremony } from '../census/ceremony.mjs';
import { verifyChain } from '../runtime/lib/lineage.js';
import { seal, open as e2eOpen } from '../runtime/lib/e2e.js';
import { makeEnvelope, pairId } from '../runtime/lib/envelope.js';
import { countersign, makeActor, b64u, unb64u, fields, CONTEXTS } from './harness.mjs';
import { installRelay, prepareMember, waitFor, sleep, clearAllTimers } from './net.mjs';

const HOUR = 3600 * 1000;

export async function scenes(sec) {
  await freshness(sec);
  await stopOrder(sec);
  globalThis.__cellClockForce = 0;
  clearAllTimers();
}

// --- a synthetic signed peer: a real ring + bundle in the ceremony, but hand-driven
// so we choose exactly when it answers a freshness challenge.
class SyntheticPeer {
  constructor(actor, self) { this.actor = actor; this.self = self; this.ctr = 0; this.device = 'bee-dev'; this.token = null; this.lastNonce = null; this.frames = []; this._open = false; }
  async pair() { return pairId(this.actor.ring, this.self.ring); }
  async hello(relay) {
    const cr = await (await fetch('/relay/challenge')).json();
    const nonce = rand16();
    const field = fields.hello(unb64u(cr.relay_id), unb64u(this.actor.ring), nonce, unb64u(cr.c));
    const sig = await this.actor.sign(CONTEXTS.hello, b64u(field));
    const hj = await (await fetch('/relay/hello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ring: this.actor.ring, name: this.actor.petname, client_nonce: b64u(nonce), challenge: cr.c, sig }) })).json();
    this.token = hj.token;
  }
  async openStream() {
    this._open = true;
    const res = await fetch('/relay/events', { headers: { Authorization: 'Bearer ' + this.token } });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => {
      while (this._open) {
        let r; try { r = await reader.read(); } catch { break; }
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const dl = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dl) continue;
          let m; try { m = JSON.parse(dl.slice(5).trim()); } catch { continue; }
          if (!m.envelope || m.envelope.__peer) continue;
          await this._decode(m.envelope);
        }
      }
    })();
  }
  async _decode(env) {
    try {
      const payloadStr = env.payload;
      const p = JSON.parse(payloadStr);
      let plain = p;
      if (p && typeof p.e === 'string' && typeof p.c === 'string') {
        plain = JSON.parse(await e2eOpen(this.actor.xPriv, env.pair, p.e, p.c));
      }
      this.frames.push(plain);
      if (plain && plain.kind === 'fresh-challenge') this.lastNonce = plain.nonce;
    } catch { /* not ours to read */ }
  }
  async _send(payload) {
    const pair = await this.pair();
    const sealed = await seal(this.self.x_pub, pair, JSON.stringify(payload));
    const env = await makeEnvelope({ selfRing: this.actor.ring, peerRing: this.self.ring, kind: payload.kind || 'm', payload: sealed, ctr: ++this.ctr, ts: 1_700_000_000_000 + this.ctr, device: this.device, sign: async (ctx, x) => ({ sig: await this.actor.sign(ctx, x) }) });
    await fetch('/relay/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: this.token, envelope: env }) });
  }
  sendMsg(text) { return this._send({ kind: 'msg', from: { name: this.actor.petname, ring: this.actor.ring }, at: 1, text }); }
  async respondChallenge() {
    if (!this.lastNonce) return false;
    const ts = Date.now();
    const fsig = await this.actor.sign(CONTEXTS.fresh, b64u(fields.fresh(unb64u(this.self.ring), unb64u(this.lastNonce), ts)));
    await this._send({ kind: 'fresh-response', nonce: this.lastNonce, ts, fsig });
    return true;
  }
  stop() { this._open = false; }
}

async function freshness(sec) {
  globalThis.__cellClockForce = 0;
  const A = await prepareMember({ name: 'captain', petname: 'captain' });
  const bee = await makeActor('bee'); bee.petname = 'bee';

  let genesis = await newGenesis();
  const composed = await composeCeremony({ genesis, members: [A, bee], params: { invite_budget: 6 }, now: 1000 });
  const entries = composed.entries;
  await countersign(entries, [A, bee]);
  const ttl = entries[0].body.ttl; // { soft_h, hard_h }
  A.seedStore({ 'lineage:replica': entries, petnames: { [bee.ring]: 'bee' } });

  const relay = installRelay();
  relay.roster = new Set([A.ring, bee.ring]);
  const apiA = await A.start();
  sec.check('l6-fresh: A booted on the real stack', apiA !== null, '');

  const peer = new SyntheticPeer(bee, A);
  await peer.hello(relay);
  await peer.openStream();
  await sleep(50);

  await peer.sendMsg('hi from bee');
  await waitFor(async () => A.ui.messages.some((m) => !m.mine && m.name === 'bee'), { timeout: 3000 });
  sec.check('l6-fresh: B message rendered by petname (bee), freshness established', A.ui.messages.some((m) => !m.mine && m.name === 'bee'), 'bee');
  sec.check('l6-fresh: no stale badge while fresh', A.ui.stales.length === 0, '');

  // cross the soft TTL: the freshness check (5s cadence) surfaces a stale badge.
  globalThis.__cellClockForce = (ttl.soft_h + 1) * HOUR;
  const staled = await waitFor(async () => A.ui.stales.some((s) => s.name === 'bee'), { timeout: 8000 });
  sec.check('l6-fresh: soft TTL crossed: stale badge on the peer, by petname', staled, 'bee');
  sec.check('l6-fresh: stale badge did not falsely restore (peer still silent)', A.ui.freshes.length === 0, '');

  // cross the hard TTL: NEW inbound is gated (fail-closed fault), held not dropped.
  globalThis.__cellClockForce = (ttl.hard_h + 1) * HOUR;
  const gated = await waitFor(async () => A.ui.statuses.some((s) => /hard-expired/.test(s)), { timeout: 8000 });
  const gateMsg = A.ui.statuses.find((s) => /hard-expired/.test(s)) || '';
  sec.check('l6-fresh: hard TTL crossed: inbound gate engaged (fail-closed fault)', gated, gateMsg.slice(0, 58));

  const renderedBefore = A.ui.messages.length;
  await peer.sendMsg('held while gated');
  await sleep(400);
  const renderedAfter = A.ui.messages.length;
  sec.check('l6-fresh: message from a hard-stale peer is HELD, not rendered', renderedAfter === renderedBefore, 'rendered ' + renderedBefore + ' vs ' + renderedAfter);
  sec.check('l6-fresh: §9 no-cover: TTL not extended by the arrival of held traffic (still gated)', A.ui.freshes.length === 0, '');

  // a challenge round-trip RESTORES freshness and flushes the held message.
  await waitFor(async () => peer.lastNonce !== null, { timeout: 8000 });
  await peer.respondChallenge();
  const restored = await waitFor(async () => A.ui.freshes.some((n) => n === 'bee'), { timeout: 8000 });
  sec.check('l6-fresh: challenge round-trip RESTORES freshness (badge cleared, by petname)', restored, 'bee');
  const flushed = await waitFor(async () => A.ui.messages.some((m) => !m.mine && m.text === 'held while gated'), { timeout: 4000 });
  sec.check('l6-fresh: the HELD message flushes and renders after restore (never dropped)', flushed, 'rendered');

  // §9 relay outage: an A send queues (store-and-forward), fail-closed not fail-open.
  globalThis.__cellClockForce = 0;
  relay.down = true;
  await apiA.sendText('into the void');
  const queued = await waitFor(async () => A.ui.statuses.some((s) => /queued for delivery/.test(s)), { timeout: 4000 });
  sec.check('l6-fresh: §9 relay down: A send QUEUES (store-and-forward), fail-closed not fail-open', queued, 'link is down, message queued for delivery');

  peer.stop(); relay.down = false; relay._restore(); clearAllTimers();
  globalThis.__cellClockForce = 0;
}

// --- the stop-order race: A stops B; the issuing verifier blocks instantly, the
// target gets the blocking alarm and the STOP entry by gossip.
async function stopOrder(sec) {
  const A = await prepareMember({ name: 'captain', petname: 'captain' });
  const B = await prepareMember({ name: 'bobby', petname: 'bobby' });
  let genesis = await newGenesis();
  const composed = await composeCeremony({ genesis, members: [A, B], params: { invite_budget: 6 }, now: 2000 });
  const entries = composed.entries;

  const vPre = await verifyChain(entries, { requireCountersign: false });
  for (const [tag, m] of [['a', A], ['b', B]]) {
    sec.check(`l6-stop: [${tag}] returned entries verify pre-countersign`, vPre.ok, '');
    sec.check(`l6-stop: [${tag}] own BIRTH present`, entries.some((e) => e.type === 'BIRTH' && e.body.ring === m.ring), '');
  }
  await countersign(entries, [A, B]);
  const vStrict = await verifyChain(entries);
  for (const [tag] of [['a'], ['b']]) {
    sec.check(`l6-stop: [${tag}] replica verifies strict after countersign exchange`, vStrict.ok, vStrict.reason || '');
    sec.check(`l6-stop: [${tag}] invite accounting 6/2/4`, vStrict.budget.remaining === 4, JSON.stringify(vStrict.budget));
  }
  A.seedStore({ 'lineage:replica': entries, petnames: { [B.ring]: 'bobby' } });
  B.seedStore({ 'lineage:replica': entries, petnames: { [A.ring]: 'captain' } });

  const relay = installRelay();
  relay.roster = new Set([A.ring, B.ring]);
  const apiA = await A.start();
  const apiB = await B.start();
  sec.check('l6-stop: [a] admitted by roster (chat booted)', apiA !== null, '');
  sec.check('l6-stop: [b] admitted by roster (chat booted)', apiB !== null, '');

  // flow established: B's message renders at A.
  await apiB.sendText('b-pre');
  await waitFor(async () => A.ui.messages.some((m) => !m.mine && m.text === 'b-pre'), { timeout: 4000 });
  sec.check('l6-stop: [a] pre-stop: the counterpart\'s messages were rendered (flow established)', A.ui.messages.some((m) => !m.mine && m.text === 'b-pre'), 'b-pre');

  // A (the counterpart) issues the stop against B.
  const issued = await apiA.issueStop();
  sec.check('l6-stop: [a] stop order issued by the counterpart', issued === true, '');
  const aReplica6 = await waitFor(async () => (A.readStore('lineage:replica') || []).length === 6, { timeout: 3000 });
  sec.check('l6-stop: [a] issuer replica gained the STOP entry immediately (local append)', aReplica6, (A.readStore('lineage:replica') || []).length + ' entries');

  // the stopped peer's envelopes are refused whole at the issuer.
  await apiB.sendText('b-post');
  const refused = await waitFor(async () => A.ui.statuses.some((s) => /STOPPED ring refused/.test(s)), { timeout: 4000 });
  sec.check('l6-stop: [a] post-stop: envelopes from the stopped peer are REFUSED at the issuer', refused, 'fault: refused (envelope from a STOPPED ring refused)');
  sec.check('l6-stop: [a] post-stop: no message from the stopped peer rendered (race window closed at the verifier)', !A.ui.messages.some((m) => m.text === 'b-post'), '');

  // the target gets the blocking alarm and the STOP entry by gossip.
  const alarmed = await waitFor(async () => B.ui.alarms.some((a) => /THIS device is the target/.test(a)), { timeout: 4000 });
  const alarmMsg = B.ui.alarms.find((a) => /THIS device is the target/.test(a)) || '';
  sec.check('l6-stop: [b] stop-target shows the BLOCKING alarm (THIS device is the target)', alarmed, alarmMsg);
  const bReplica6 = await waitFor(async () => (B.readStore('lineage:replica') || []).length === 6, { timeout: 4000 });
  sec.check('l6-stop: [b] stop-target replica gained the STOP entry by gossip', bReplica6, (B.readStore('lineage:replica') || []).length + ' entries');
  const bRep = B.readStore('lineage:replica') || [];
  const bv = bRep.length ? await verifyChain(bRep) : { ok: false };
  sec.check('l6-stop: [b] stop-target replica still verifies end-to-end after the gossiped STOP', bv.ok, bv.ok ? bv.head.slice(0, 12) : (bv.reason || ''));

  relay._restore(); clearAllTimers();
}

function rand16() { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return b; }
