// M2 census server. Node built-ins only (house rule: no dependencies for infra tooling).
// Usage: node serve.js <port> [--isolate | --no-isolate]
// --isolate sets the cross-origin isolation headers so shared-memory probes see the gated state.
// The port is chosen at run time and never recorded in repo files.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- Relay v2 (authid R7 L2): the door recognizes a KEY, not a word. A hello is
// a fresh challenge signed by the ring's private key; the roster is the transport
// ACL; the relay is DUMB TRANSPORT — it routes and stamps an authenticated `from`,
// and never holds identity truth, liveness, or an access decision. In-memory only;
// content is never logged or persisted beyond delivery buffers. The passphrase
// pair machinery is DELETED (V1); a hello bearing a `pass` field trips a
// rate-limited downgrade tripwire.
const rc = require('./relay-crypto.js');
const K_RELAY = crypto.randomBytes(32);          // CSPRNG at boot, memory only; a restart is a mass re-hello
let RELAY_ID = crypto.randomBytes(32);           // reset to SHA-256(TLS cert) at boot below
const sessions = new Map();                       // ring -> { name, res, queue }
const tokens = new Map();                         // token -> { ring, name, exp }
const roster = new Set();                          // authenticated ring_ids permitted to transport here
const RELAY_QUEUE_BOUND = 256;
const tripHits = new Map();
(function loadRoster() {
  const a = process.argv.slice(2);
  const i = a.indexOf('--roster');
  const p = i >= 0 ? a[i + 1] : process.env.CELL_ROSTER;
  if (p) { try { fs.readFileSync(p, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).forEach((r) => roster.add(r)); console.log('roster loaded: ' + roster.size + ' ring(s)'); } catch (e) { console.error('roster load failed: ' + e.message); } }
})();
// The L2 rehearsal-only --open-roster escape is RETIRED (L5): the roster file is
// written by the ceremony kit from the BIRTH entries; there is no auto-admission.

// Every hello failure returns this one opaque shape — same code, status, body —
// so nothing (roster hit/miss, bad sig, stale challenge) is a distinguishing oracle.
function relayRefused(res) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ op: 'fault', body: { code: 'refused', detail: 'refused' } }));
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
  req.on('end', () => cb(body));
}

function relayChallenge(res) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ c: rc.makeChallenge(K_RELAY, Date.now()), relay_id: RELAY_ID.toString('base64url') }));
}

function tripwire(req) {
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  let t = tripHits.get(ip);
  if (!t || now - t.first > 60000) { t = { count: 0, first: now }; tripHits.set(ip, t); }
  t.count++;
  if (t.count <= 5) console.log('relay tripwire: pass-bearing hello refused (downgrade attempt)');
}

function relayHello(req, res) {
  readBody(req, (body) => {
    let p; try { p = JSON.parse(body); } catch { return relayRefused(res); }
    if (p && Object.prototype.hasOwnProperty.call(p, 'pass')) { tripwire(req); return relayRefused(res); }
    if (!p || !p.ring || !p.name || !p.client_nonce || !p.challenge || !p.sig) return relayRefused(res);
    let ringBuf, nonceBuf, chalBuf, sigBuf;
    try {
      ringBuf = Buffer.from(p.ring, 'base64url'); nonceBuf = Buffer.from(p.client_nonce, 'base64url');
      chalBuf = Buffer.from(p.challenge, 'base64url'); sigBuf = Buffer.from(p.sig, 'base64url');
    } catch { return relayRefused(res); }
    // Both checks always run (the sig verify uses a dummy key on a malformed ring),
    // so neither the roster decision nor ring validity is a timing oracle.
    const chalOk = rc.verifyChallenge(K_RELAY, p.challenge, Date.now());
    const sigOk = rc.verifyHelloSig(RELAY_ID, ringBuf, nonceBuf, chalBuf, sigBuf);
    if (!(chalOk && sigOk && roster.has(p.ring))) return relayRefused(res);
    const token = rc.relayToken(K_RELAY, ringBuf, nonceBuf); // idempotent: replay re-derives, never evicts
    tokens.set(token, { ring: p.ring, name: String(p.name).slice(0, 30), exp: Date.now() + 12 * 3600 * 1000 });
    const nm = String(p.name).slice(0, 30);
    const prev = sessions.get(p.ring);
    sessions.set(p.ring, { name: nm, res: prev ? prev.res : null, queue: prev ? prev.queue : [], dropped: prev ? prev.dropped || 0 : 0 });
    // peers carry rings so the transport can address (sign to) the other side.
    const peers = [...sessions.keys()].filter((r) => r !== p.ring).map((r) => ({ ring: r, name: sessions.get(r).name }));
    // Announce this joiner to the other live streams (transport-level presence, not
    // identity truth — the ring is the one the relay just authenticated).
    const announce = 'data: ' + JSON.stringify({ from: { ring: p.ring, name: nm }, envelope: { __peer: true } }) + '\n\n';
    for (const [r, s] of sessions) { if (r !== p.ring && s.res) { try { s.res.write(announce); } catch {} } }
    console.log('relay hello -> ok (sessions ' + sessions.size + ')');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, token, peers }));
  });
}

// L3: the bearer token lives in the Authorization header only — never in a URL,
// so it cannot leak via browser history, referrers, or request logs (H14).
function tokenFrom(req) {
  const auth = req.headers['authorization'];
  return (auth && auth.startsWith('Bearer ')) ? auth.slice(7) : null;
}

function relayEvents(req, res, urlQuery) {
  const tk = tokenFrom(req, urlQuery);
  const t = tk && tokens.get(tk);
  if (!t || t.exp <= Date.now()) return relayRefused(res);
  const sess = sessions.get(t.ring);
  if (!sess) return relayRefused(res);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
  res.write(':open\n\n');
  sess.res = res;
  // A2.3 delivery honesty: frames dropped from this session's offline queue are
  // ANNOUNCED when the stream reopens, never silently absorbed (content is never
  // logged; only the count crosses the wire).
  if (sess.dropped) { res.write('data: ' + JSON.stringify({ relay_notice: { dropped: sess.dropped } }) + '\n\n'); sess.dropped = 0; }
  while (sess.queue.length) res.write('data: ' + sess.queue.shift() + '\n\n');
  const beat = setInterval(() => { try { res.write(':beat\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(beat); if (sess.res === res) sess.res = null; });
  console.log('relay events -> stream open');
}

function relaySend(req, res) {
  readBody(req, (body) => {
    let p; try { p = JSON.parse(body); } catch { return relayRefused(res); }
    const t = p.token && tokens.get(p.token);
    if (!t || t.exp <= Date.now()) return relayRefused(res);
    const from = sessions.get(t.ring);
    // Roster delivery: to the rostered ring(s) that are not the sender. The `from`
    // is the token's authenticated ring — the relay steers neither identity nor,
    // once L4 signs the envelope, attribution.
    const msg = JSON.stringify({ from: { ring: t.ring, name: from ? from.name : '' }, envelope: p.envelope });
    let delivered = 0;
    for (const [ring, s] of sessions) {
      if (ring === t.ring) continue;
      if (s.res) { try { s.res.write('data: ' + msg + '\n\n'); delivered++; continue; } catch {} }
      s.queue.push(msg);
      if (s.queue.length > RELAY_QUEUE_BOUND) { s.queue.shift(); s.dropped = (s.dropped || 0) + 1; }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, delivered }));
  });
}

// Explicit unpair (M-R5): drop the token and the session, close the stream.
function relayDeleteSession(req, res, urlQuery) {
  const tk = tokenFrom(req, urlQuery);
  const t = tk && tokens.get(tk);
  if (t) { tokens.delete(tk); const s = sessions.get(t.ring); if (s && s.res) { try { s.res.end(); } catch {} } sessions.delete(t.ring); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// Expiry sweep (declared cadence, not "on interval").
setInterval(() => { const now = Date.now(); for (const [tk, t] of tokens) if (t.exp <= now) tokens.delete(tk); }, 60000);

const args = process.argv.slice(2);
const port = parseInt(args[0], 10);
if (!port) {
  console.error('Usage: node serve.js <port> [--isolate | --no-isolate] [--no-tls | --proxy]');
  process.exit(1);
}
const isolate = args.includes('--isolate');
const noTls = args.includes('--no-tls');
// --proxy: serve plaintext HTTP on ALL interfaces, for running INSIDE a container
// behind the house TLS-terminating reverse proxy (Caddy). Distinct from --no-tls
// (which stays loopback-only dev). The browser's secure-context floor is met by
// the proxy's HTTPS at the edge; the only plaintext hop is proxy→container on the
// trusted internal network. SAFE ONLY behind such a proxy — the container port
// must never be published to an untrusted network (Workstream 3, platform export).
const proxy = args.includes('--proxy');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const rawDir = path.join(__dirname, '..', 'raw');
const baseDir = path.join(__dirname, '..');
// Only these subtrees are served; the rest of the repo never crosses the LAN.
const SERVED = ['census/', 'runtime/'];

function handler(req, res) {
  const urlPath = req.url.split('?')[0];
  const urlQuery = req.url.split('?')[1] || '';
  if (req.method === 'GET' && urlPath === '/relay/challenge') return relayChallenge(res);
  if (req.method === 'POST' && urlPath === '/relay/hello') return relayHello(req, res);
  if (req.method === 'GET' && urlPath === '/relay/events') return relayEvents(req, res, urlQuery);
  if (req.method === 'POST' && urlPath === '/relay/send') return relaySend(req, res);
  if (req.method === 'DELETE' && urlPath === '/relay/session') return relayDeleteSession(req, res, urlQuery);
  if (req.method === 'POST' && urlPath === '/submit') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        const device = String(p.device || 'unlabeled').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'unlabeled';
        const kind = p.kind === 'drive' ? 'drive' : 'census';
        const mode = String(p.mode || 'plain').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) || 'plain';
        fs.mkdirSync(rawDir, { recursive: true });
        // Client-detected mode and server header state can differ (secure-context gate,
        // claim B3), so both go into the name to keep runs from overwriting each other.
        const name = kind + '-' + device + '-' + mode + (isolate ? '-hdron' : '-hdroff') + '.json';
        fs.writeFileSync(path.join(rawDir, name), JSON.stringify(p, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ saved: name }));
        console.log('saved raw/' + name);
      } catch (e) {
        res.writeHead(400); res.end('bad payload');
      }
    });
    return;
  }
  // The CA certificate (PUBLIC half only) at a deliberate route, typed so phones
  // offer the profile install. The key material below is never served.
  if (req.method === 'GET' && urlPath === '/ca.pem') {
    return fs.readFile(path.join(baseDir, 'runtime', 'tls', 'ca.pem'), (err, data) => {
      if (err) { res.writeHead(404); res.end('no CA generated'); return; }
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }
  let file = urlPath === '/' ? 'census/census.html' : urlPath.replace(/^\/+/, '');
  if (file === 'census.html') file = 'census/census.html';
  let full = path.join(baseDir, path.normalize(file));
  // runtime/tls holds PRIVATE keys: inside the served runtime/ subtree, but never
  // across the wire (caught in the G4 prep walk-through, 2026-08-27).
  if (path.relative(baseDir, full).startsWith(path.join('runtime', 'tls'))) {
    console.log('req', req.method, urlPath, '-> 403 tls-material');
    res.writeHead(403); res.end(); return;
  }
  if (!full.startsWith(baseDir) || !SERVED.some((p) => path.relative(baseDir, full).startsWith(p.slice(0, -1)))) {
    console.log('req', req.method, urlPath, '-> 403', (req.headers['user-agent'] || '').includes('iPhone') ? 'iphone' : 'other');
    res.writeHead(403); res.end(); return;
  }
  // A directory asked for without its trailing slash gets redirected to add it:
  // otherwise the browser resolves the page's relative imports one level too
  // high and they land outside the allowlist (the phone's 403s, 2026-08-25).
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    if (!urlPath.endsWith('/')) {
      console.log('req', req.method, urlPath, '-> 301 add-slash');
      res.writeHead(301, { Location: urlPath + '/' });
      res.end(); return;
    }
    full = path.join(full, 'index.html');
  }
  fs.readFile(full, (err, data) => {
    const ua = (req.headers['user-agent'] || '').includes('iPhone') ? 'iphone' : 'other';
    if (err) { console.log('req', req.method, urlPath, '-> 404', ua); res.writeHead(404); res.end('not found'); return; }
    const headers = { 'Content-Type': types[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (isolate) {
      headers['Cross-Origin-Opener-Policy'] = 'same-origin';
      headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    }
    console.log('req', req.method, urlPath, '-> 200 (' + data.length + 'b)', ua);
    res.writeHead(200, headers);
    res.end(data);
  });
}

// L0: HTTPS on the LAN is the crypto floor — browsers switch crypto.subtle off on
// plain-HTTP origins, so the identity plane cannot bind without it (M-R9). Default
// is TLS on all interfaces; --no-tls is a loopback-only dev escape that refuses to
// serve the LAN in the clear (no downgrade). Either way /submit stays available so
// census collection is not silently broken.
let server, scheme, host;
if (proxy) {
  // Plaintext on all interfaces, for the container-behind-Caddy case (see flag
  // note above). RELAY_ID keeps its boot-random value (no cert to hash), which is
  // stable per process — the challenge/hello consistency the relay needs.
  server = http.createServer(handler);
  scheme = 'http'; host = '0.0.0.0';
} else if (noTls) {
  server = http.createServer(handler);
  scheme = 'http'; host = '127.0.0.1';
} else {
  const certPath = process.env.CELL_TLS_CERT || path.join(baseDir, 'runtime', 'tls', 'host.pem');
  const keyPath = process.env.CELL_TLS_KEY || path.join(baseDir, 'runtime', 'tls', 'host.key');
  let creds;
  try { creds = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }; }
  catch (e) {
    console.error('TLS material not found at ' + certPath + ' / ' + keyPath + '.');
    console.error('Generate it with:  sh census/make-cert.sh <this-machine-LAN-IP>');
    console.error('or run loopback-only dev with:  node census/serve.js ' + port + ' --no-tls');
    process.exit(1);
  }
  // relay_id = SHA-256 of the TLS cert: a hello is signed against it, so a
  // captured hello cannot be replayed to a sibling relay with a different cert.
  RELAY_ID = crypto.createHash('sha256').update(creds.cert).digest();
  server = https.createServer(creds, handler);
  scheme = 'https'; host = '0.0.0.0';
}
server.listen(port, host, () => {
  console.log('census/relay serving ' + scheme + ' on ' + host + ':' + port + ', isolation ' + (isolate ? 'ON' : 'OFF') + (noTls ? ' [--no-tls: loopback only, no LAN]' : '') + (proxy ? ' [--proxy: plaintext behind a trusted TLS proxy]' : ''));
  if (!noTls) console.log('second device opens ' + scheme + '://<this machine LAN IP>:' + port + '/ (CA cert installed on the device at the ceremony).');
});
