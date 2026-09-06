// The chat. Verbs and handles only: zero substrate API tokens, same law as G1.
// The UI layer owns the screen and hands plain data in; this module never
// touches anything below the kernel's five verbs.

const CHUNK = 48 * 1024;

function checksum(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export async function boot(kernel, config, ui) {
  const waiters = new Map();
  const inbox = new Map();
  let seq = 0;
  const photosIn = new Map(); // id -> { total, got, parts: [] }
  let peerOnline = false;
  let lastBeat = 0;

  const route = (env) => {
    if (env.correlation && waiters.has(env.correlation)) {
      const w = waiters.get(env.correlation); waiters.delete(env.correlation); w(env); return;
    }
    if (env.op === 'recv' && env.body) return onWire(env.body, env.from, env.ctr);
    // A2.3 wording honesty: "flushed" means the relay ACCEPTED the queued
    // messages — peer receipt is not known here and is not claimed.
    if (env.op === 'rebound') { ui.status('link re-bound' + (env.body.flushed ? ', ' + env.body.flushed + ' queued message(s) handed to the relay' : '') + ', conversation continues'); beat(); return; }
    // An integrity alarm is BLOCKING (it cannot be clicked through), not a status line.
    if (env.op === 'alarm') { if (ui.alarm) ui.alarm(env.body.detail); else ui.status('ALARM: ' + env.body.detail); return; }
    // Freshness decay (L6): the badge names the peer by PETNAME and says when it
    // was last heard from; restoration clears it. Legal per the no-global-presence
    // rule — this is a per-contact approximation, not an oracle.
    if (env.op === 'stale') { const n = display(env.body.ring, env.body.name); if (ui.stale) ui.stale(n, env.body.last); else ui.status(n + ' is stale, last heard from a while ago'); return; }
    if (env.op === 'fresh') { const n = display(env.body.ring, env.body.name); if (ui.fresh) ui.fresh(n); else ui.status('freshness restored for ' + n); return; }
    if (env.op === 'fault') { ui.status('fault: ' + env.body.code + ' (' + env.body.detail + ')'); return; }
    if (env.correlation) inbox.set(env.correlation, env);
  };
  const expect = (c) => {
    if (inbox.has(c)) { const e = inbox.get(c); inbox.delete(c); return Promise.resolve(e); }
    return new Promise((res) => waiters.set(c, res));
  };
  const ask = async (handle, envelope) => {
    const correlation = 'chat-' + (++seq);
    const reply = expect(correlation);
    const ack = await kernel.transmit(handle, { ...envelope, correlation });
    if (ack.op === 'fault') { waiters.delete(correlation); return ack; }
    return reply;
  };
  const opts = { onEnvelope: route };
  const acquire = (need) => kernel.bind(kernel.resolve({ need }), opts);

  const store = acquire(['store:kv']);
  const identity = acquire(['identity:pair']);
  const chan = acquire(['channel:paired']);
  const clock = acquire(['time']);
  for (const [n, h] of [['storage', store], ['identity', identity], ['paired channel', chan], ['clock', clock]]) {
    if (!h.ref) { ui.status('bind failed: ' + n); return null; }
  }

  // Session identity: the identity cell is the source (load-or-generate its Ring).
  // Always mint so the non-extractable signing key is rehydrated from custody on
  // every boot; keep ring/x_pub (L2 signs hellos with the ring, L4/L7 the
  // envelopes and E2E bundle) — do not strip them to {session,name}.
  const minted = await ask(identity, { op: 'mint', body: { name: config.name } });
  if (minted.op === 'fault') { ui.status('identity refused'); return null; }
  const who = { session: minted.body.session, name: config.name || minted.body.name, ring: minted.body.ring, x_pub: minted.body.x_pub };

  // Petname registry: ring -> the LOCAL display name sealed at the ceremony.
  // Wire names are advisory; rendering keys on the signed sender ring. Where a
  // registry exists, a ring outside it is named but marked, never trusted bare.
  let petnames = {};
  const pn = await ask(store, { op: 'get', body: { key: 'petnames' } });
  if (pn.op === 'value' && pn.body.value) petnames = pn.body.value;
  const display = (ring, wireName) => petnames[ring] || (Object.keys(petnames).length ? wireName + ' (unrecognized)' : wireName);

  // No passphrase: entry is a signed hello the transport makes with the ring key.
  // Admission is roster membership (installed at the ceremony), not a shared word.
  const joined = await ask(chan, { op: 'join', body: { name: who.name } });
  if (joined.op === 'fault') { ui.status('not admitted: ' + joined.body.detail); return null; }
  ui.status('joined as ' + who.name + (joined.body.peers.length ? ', with ' + joined.body.peers.join(', ') : ', waiting for the other side'));

  function onWire(m, from, ctr) {
    if (!m || !m.kind) return;
    // `from` is the SIGNED sender the transport already verified (L4). Render by
    // the PETNAME for that ring (L5) — the wire name is advisory — and key stored
    // history on (sender ring, ctr), both from inside the signed envelope, so an
    // attacker-chosen id can no longer overwrite history (H12 residual closed by
    // construction). Fall back only for the loopback backing.
    const who = (from && from.name) ? { ring: from.ring, name: display(from.ring, from.name) } : { name: 'unknown', ring: '?' };
    if (m.kind === 'msg') { ui.message(who.name, m.text, m.at, false); persist('rx-' + who.ring + '-' + ctr, { kind: 'msg', from: who.name, text: m.text, at: m.at }); return; }
    if (m.kind === 'typing') { ui.typing(who.name); return; }
    if (m.kind === 'presence') { peerOnline = true; lastBeat = m.at; ui.presence(true, who.name); return; }
    if (m.kind === 'photo-chunk') {
      const pk = who.ring + '|' + m.photo;
      let p = photosIn.get(pk);
      if (!p) { p = { total: m.total, got: 0, parts: new Array(m.total), from: who, sum: m.sum }; photosIn.set(pk, p); }
      if (!p.parts[m.seq]) { p.parts[m.seq] = m.data; p.got++; }
      ui.status('receiving photo: ' + p.got + '/' + p.total);
      if (p.got === p.total) {
        const data = p.parts.join('');
        const ok = checksum(data) === p.sum;
        photosIn.delete(pk);
        persist('rx-photo-' + who.ring + '-' + m.photo, { from: p.from.name, sum: p.sum, size: data.length });
        ui.photo(p.from.name, data, ok);
        ui.status(ok ? 'photo received, integrity verified' : 'photo received, CHECKSUM MISMATCH');
      }
      return;
    }
  }

  async function persist(key, value) { await ask(store, { op: 'put', body: { key, value } }); }
  // A2.5: wall-clock reads are verb-mediated — time comes from the clock cell's
  // `now` op, never from a substrate global (the app carries zero API tokens).
  async function now() {
    const t = await ask(clock, { op: 'now' });
    return t.op === 'time' ? t.body.ms : 0;
  }
  async function wire(kind, extra) {
    const m = { kind, from: who, at: await now(), ...extra };
    const ack = await kernel.transmit(chan, { op: 'send', body: m, correlation: 'chat-' + (++seq) });
    if (ack.op === 'fault') ui.status('send held: ' + ack.body.detail);
    else if (ack.queued) ui.status('link is down, message queued for delivery');
    return m;
  }

  // Presence: heartbeat on the clock, peer considered gone after two missed beats.
  async function beat() {
    await wire('presence', {});
    const tick = await ask(clock, { op: 'after', body: { ms: 10000 } });
    if (tick.op === 'tick') {
      if (peerOnline && (await now()) - lastBeat > 25000) { peerOnline = false; ui.presence(false, ''); }
      beat();
    }
  }
  beat();

  return {
    who,
    async sendText(text) {
      const m = await wire('msg', { text });
      ui.message(who.name, text, m.at, true);
      persist('tx-' + who.ring + '-' + m.at, m);
    },
    sendTyping() { wire('typing', {}); },
    // The stop-order (L6): cut a compromised peer key off. Deliberate, loud, and
    // reversible only by the in-person cross-signed contest close.
    async issueStop() {
      const r = await ask(chan, { op: 'stop', body: {} });
      if (r.op === 'fault') { ui.status('stop refused: ' + r.body.detail); return false; }
      ui.status('stop order issued: the peer key is blocked on this device and the order is gossiped');
      return true;
    },
    async sendPhoto(data) {
      const id = seq + '-' + who.session;
      const sum = checksum(data);
      const total = Math.ceil(data.length / CHUNK);
      ui.status('sending photo in ' + total + ' parts');
      for (let i = 0; i < total; i++) {
        await wire('photo-chunk', { photo: id, seq: i, total, sum, data: data.slice(i * CHUNK, (i + 1) * CHUNK) });
      }
      ui.photo(who.name, data, true);
      ui.status('photo sent');
    },
  };
}
