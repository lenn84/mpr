// The relay + member rig the scenes run on. Faithful, in-process, inspectable.
//
// The relay is a fetch shim that speaks serve.js's /relay/* contract (challenge →
// signed hello → roster ACL → token → SSE events → send delivery), so the REAL
// transport talks to it unchanged. The shim is also the on-path observation point
// (every /relay/send envelope is captured) and can be forced DOWN for the outage
// drills. serve.js itself is CommonJS over node:http and cannot run in-process; this
// re-implements only its relay LOGIC — the hello signature is verified with the same
// wire.verifySig the browser trusts, over the same fields.hello bytes.
//
// A "member" is a fully isolated peer: its own kernel and its own identity/storage
// custody (per-member Maps swapped into the globals the managers read), booting the
// REAL chat.js against a recording UI. Members warm up serially (each awaits its own
// join before the next boots) so every manager closure captures its own maps; after
// bind, the managers hold their maps directly, so later global swaps can't cross the
// wires. This is the in-process form of the drives' "two member processes + relay".
import { createKernel } from '../runtime/kernel/kernel.js';
import { register as regStore, DESCRIPTOR as STORE_D } from '../runtime/managers/storage.js';
import { register as regId, DESCRIPTOR as ID_D } from '../runtime/managers/identity.js';
import { register as regTp, DESCRIPTOR as TP_D, PAIR_DESCRIPTOR as TP_PAIR_D } from '../runtime/managers/transport.js';
import { boot as chatBoot } from '../runtime/app/chat.js';
import { b64u, unb64u, fields, CONTEXTS, verifySig } from '../runtime/lib/wire.js';

const ENC = new TextEncoder();

// --- timer tracking, so a scene can quiesce lingering presence/freshness/retry
// timers before the next scene (installed once).
const activeTimers = new Set();
let timersPatched = false;
function patchTimers() {
  if (timersPatched) return; timersPatched = true;
  const _si = globalThis.setInterval, _st = globalThis.setTimeout, _ci = globalThis.clearInterval, _ct = globalThis.clearTimeout;
  globalThis.setInterval = (fn, ms, ...a) => { const t = _si(fn, ms, ...a); activeTimers.add(t); return t; };
  globalThis.setTimeout = (fn, ms, ...a) => { const t = _st(fn, ms, ...a); activeTimers.add(t); return t; };
  globalThis.clearInterval = (t) => { activeTimers.delete(t); return _ci(t); };
  globalThis.clearTimeout = (t) => { activeTimers.delete(t); return _ct(t); };
  globalThis.__clearAllTimers = () => { for (const t of activeTimers) { try { _ci(t); } catch {} try { _ct(t); } catch {} } activeTimers.clear(); };
}
export function clearAllTimers() { if (globalThis.__clearAllTimers) globalThis.__clearAllTimers(); }

function setMemberGlobals(m) {
  globalThis.__cellIdentityMem = m.idMem;
  globalThis.__cellStoreMem = m.storeMem;
  globalThis.isSecureContext = true; // L0 floor: the identity cell's ring resolution gates on it
}

// --- the fetch-shim relay ------------------------------------------------------
export function installRelay() {
  patchTimers();
  const relay = {
    RELAY_ID: b64u(rand(32)),
    roster: new Set(),
    sessions: new Map(),   // ring -> { name, controller|null, queue: [] }
    tokens: new Map(),     // token -> ring
    challenges: new Set(),
    captured: [],          // every /relay/send envelope (observer)
    tripwire: 0,
    down: false,
    seq: 0,
    sessionCount() { return this.sessions.size; },
    deliverCount: 0,
  };
  const prevFetch = globalThis.fetch;
  relay._restore = () => { globalThis.fetch = prevFetch; };
  globalThis.CELL_RELAY_BASE = '';

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url && url.url ? url.url : url);
    const path = u.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
    if (relay.down && path.startsWith('/relay/')) throw new Error('relay down (simulated outage)');

    if (path.endsWith('/relay/challenge')) {
      const c = b64u(rand(16)); relay.challenges.add(c);
      return json({ c, relay_id: relay.RELAY_ID });
    }
    if (path.endsWith('/relay/hello')) {
      const p = JSON.parse(opts.body || '{}');
      if (Object.prototype.hasOwnProperty.call(p, 'pass')) { relay.tripwire++; return refused(); }
      if (!p.ring || !p.name || !p.client_nonce || !p.challenge || !p.sig) return refused();
      let ok = false;
      try {
        const field = fields.hello(unb64u(relay.RELAY_ID), unb64u(p.ring), unb64u(p.client_nonce), unb64u(p.challenge));
        ok = relay.challenges.has(p.challenge) && await verifySig(unb64u(p.ring), CONTEXTS.hello, field, p.sig);
      } catch { ok = false; }
      if (!ok || !relay.roster.has(p.ring)) return refused();
      const token = 'tok-' + (++relay.seq);
      relay.tokens.set(token, p.ring);
      const nm = String(p.name).slice(0, 30);
      const prev = relay.sessions.get(p.ring);
      relay.sessions.set(p.ring, { name: nm, controller: prev ? prev.controller : null, queue: prev ? prev.queue : [] });
      const peers = [...relay.sessions.keys()].filter((r) => r !== p.ring).map((r) => ({ ring: r, name: relay.sessions.get(r).name }));
      const announce = JSON.stringify({ from: { ring: p.ring, name: nm }, envelope: { __peer: true } });
      for (const [r, s] of relay.sessions) if (r !== p.ring && s.controller) push(s, announce);
      return json({ ok: true, token, peers });
    }
    if (path.endsWith('/relay/events')) {
      const tk = bearer(opts); const ring = tk && relay.tokens.get(tk);
      const sess = ring && relay.sessions.get(ring);
      if (!sess) return refused();
      let controller;
      const stream = new ReadableStream({
        start(c) {
          controller = c; sess.controller = c;
          c.enqueue(ENC.encode(':open\n\n'));
          while (sess.queue.length) c.enqueue(ENC.encode('data: ' + sess.queue.shift() + '\n\n'));
        },
        cancel() { if (sess.controller === controller) sess.controller = null; },
      });
      if (opts.signal) opts.signal.addEventListener('abort', () => { try { controller.close(); } catch {} if (sess.controller === controller) sess.controller = null; });
      return { ok: true, status: 200, body: stream };
    }
    if (path.endsWith('/relay/send')) {
      const p = JSON.parse(opts.body || '{}');
      const ring = p.token && relay.tokens.get(p.token);
      if (!ring) return refused();
      relay.captured.push(p.envelope);
      const from = relay.sessions.get(ring);
      const msg = JSON.stringify({ from: { ring, name: from ? from.name : '' }, envelope: p.envelope });
      let delivered = 0;
      for (const [r, s] of relay.sessions) { if (r === ring) continue; push(s, msg); delivered++; }
      relay.deliverCount += delivered;
      return json({ ok: true, delivered });
    }
    if (path.endsWith('/relay/session')) {
      const tk = bearer(opts); const ring = tk && relay.tokens.get(tk);
      if (ring) { relay.tokens.delete(tk); const s = relay.sessions.get(ring); if (s && s.controller) { try { s.controller.close(); } catch {} } relay.sessions.delete(ring); }
      return json({ ok: true });
    }
    throw new Error('no route: ' + path); // e.g. kernel schema.json -> kernel falls back to its inline default
  };
  return relay;
}

function push(sess, msg) {
  if (sess.controller) { try { sess.controller.enqueue(ENC.encode('data: ' + msg + '\n\n')); return; } catch {} }
  sess.queue.push(msg); if (sess.queue.length > 256) sess.queue.shift();
}
function json(obj, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return obj; } }; }
function refused() { return { ok: false, status: 403, async json() { return { op: 'fault', body: { code: 'refused', detail: 'refused' } }; } }; }
function bearer(opts) { const a = opts.headers && (opts.headers.Authorization || opts.headers.authorization); return a && a.startsWith('Bearer ') ? a.slice(7) : null; }
function rand(n) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }

// --- a recording UI standing in for chat.html's screen -------------------------
export function makeUi() {
  const ui = {
    statuses: [], messages: [], typings: [], presences: [], photos: [], alarms: [], stales: [], freshes: [],
    status(s) { this.statuses.push(s); },
    message(name, text, at, mine) { this.messages.push({ name, text, at, mine }); },
    typing(name) { this.typings.push(name); },
    presence(online, name) { this.presences.push({ online, name }); },
    photo(name, data, ok) { this.photos.push({ name, size: data ? data.length : 0, ok }); },
    alarm(detail) { this.alarms.push(detail); },
    stale(name, last) { this.stales.push({ name, last }); },
    fresh(name) { this.freshes.push(name); },
  };
  return ui;
}

// --- members -------------------------------------------------------------------
// Phase 1: prepareMember mints the ring through the REAL identity cell (so the
// ceremony BIRTH carries the same static key the cell will open with) and returns
// the material. Phase 2: member.start() seeds the store and boots the real chat.
export async function prepareMember({ name, petname }) {
  const m = { name, petname, idMem: new Map(), storeMem: new Map(), ui: makeUi() };
  setMemberGlobals(m);
  const kernel = await createKernel();
  regStore(kernel); regId(kernel); regTp(kernel);
  const reg = kernel.bind(kernel.resolve({ need: ['registry'] }), { onEnvelope() {} });
  for (const d of [STORE_D, ID_D, TP_D, TP_PAIR_D]) {
    const ack = await kernel.transmit(reg, { op: 'mint', body: d });
    if (ack && ack.op === 'fault') throw new Error('mint ' + d.id + ': ' + ack.body.detail);
  }
  // Bind identity + mint the ring (a signer that speaks the identity cell contract).
  const waiters = new Map(); let seq = 0;
  const idh = kernel.bind(kernel.resolve({ need: ['identity:pair'] }), { onEnvelope: (env) => { if (env.correlation && waiters.has(env.correlation)) { const w = waiters.get(env.correlation); waiters.delete(env.correlation); w(env); } } });
  if (!idh.ref) throw new Error('identity bind failed (secure-context gate?)');
  const ask = (op, body) => { const c = 'prep-' + (++seq); const p = new Promise((r) => waiters.set(c, r)); return kernel.transmit(idh, { op, body, correlation: c }).then((ack) => { if (ack && ack.op === 'fault') { waiters.delete(c); return ack; } return p; }); };
  const minted = await ask('mint', { name });
  m.kernel = kernel; m.ring = minted.body.ring; m.x_pub = minted.body.x_pub;
  m.sign = async (context, payloadB64) => { const s = await ask('sign', { context, payload: payloadB64 }); if (s.op === 'fault') throw new Error('sign refused'); return s.body.sig; };
  m.bundle_epoch = 1;
  m.bundle_sig = await m.sign(CONTEXTS.bundle, b64u(fields.bundle(m.bundle_epoch, unb64u(m.ring), unb64u(m.x_pub))));
  m.seedStore = (obj) => { setMemberGlobals(m); for (const [k, v] of Object.entries(obj)) m.storeMem.set(k, JSON.stringify(v)); };
  m.readStore = (k) => { const s = m.storeMem.get(k); return s === undefined ? undefined : JSON.parse(s); };
  m.start = async () => { setMemberGlobals(m); m.api = await chatBoot(kernel, { name }, m.ui); return m.api; };
  return m;
}

// --- small async helpers -------------------------------------------------------
export function sleep(ms) { return new Promise((r) => globalThis.setTimeout(r, ms)); }
export async function waitFor(cond, { timeout = 4000, step = 25 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await cond()) return true; await sleep(step); }
  return false;
}
