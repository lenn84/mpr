// O0 headless verification (sovereign-peer phases/O0-spore-loader.md).
// Drives the REAL kernel + storage cell + spore cell in Node. Not committed to
// MPR by the research plane; re-authorable from the phase doc's verification lines.
// Run: node o0-verify.mjs
import { createKernel } from './runtime/kernel/kernel.js';
import { register as registerStorage } from './runtime/managers/storage.js';
import { register as registerSpore, pack } from './runtime/managers/spore.js';

let passes = 0, fails = 0;
function check(name, cond, detail) {
  if (cond) { passes++; console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { fails++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// --- boot the kernel exactly as index.html does: register() then mint via the registry cell.
const kernel = await createKernel();
registerStorage(kernel);
registerSpore(kernel);
const reg = kernel.bind(kernel.resolve({ need: ['registry'] }), { onEnvelope() {} });
for (const d of [ (await import('./runtime/managers/storage.js')).DESCRIPTOR, (await import('./runtime/managers/spore.js')).DESCRIPTOR ]) {
  const ack = await kernel.transmit(reg, { op: 'mint', body: d });
  if (ack.op === 'fault') { console.log('boot mint refused: ' + d.id + ' ' + ack.body.detail); process.exit(1); }
}

// --- request/reply helpers over a bound handle
function driver(handle) {
  const waiters = new Map(); let seq = 0;
  const h = kernel.bind(handle, { onEnvelope: (env) => { if (env.correlation && waiters.has(env.correlation)) { const w = waiters.get(env.correlation); waiters.delete(env.correlation); w(env); } } });
  return {
    ref: h,
    async send(op, body) {
      const c = 'drv-' + (++seq);
      const reply = new Promise((res) => waiters.set(c, res));
      const ack = await kernel.transmit(h, { op, body, correlation: c });
      if (ack && ack.op === 'fault') { waiters.delete(c); return ack; }
      // load returns its result in the ack directly; store returns it via emit.
      if (ack && ack.body && (ack.body.id || ack.body.already)) { waiters.delete(c); return ack; }
      return reply;
    },
  };
}
const store = driver(kernel.resolve({ need: ['store:kv'] }));
const spore = driver(kernel.resolve({ need: ['pkg:load'] }));
const put = (key, value) => store.send('put', { key, value });

// The echo SmartObject's code (a factory that echoes its body back). Each probe
// gets a UNIQUE code (a per-probe comment) so codeHashes never collide in the
// shared headless store — otherwise identical bytes would share a cache key.
const ECHO_BASE = "export const factory = (key, emit) => ({ accept(env){ if(env.op==='echo'){ emit({op:'echoed',correlation:env.correlation,body:env.body}); return {accepted:true,correlation:env.correlation}; } return {op:'fault',correlation:env.correlation,body:{code:'bad-envelope'}}; }, close(){} });";
const echoCode = (tag) => ECHO_BASE + '\n// ' + tag;

async function loadId(id) { return spore.send('load', { id }); }

console.log('O0 verification — Spore verified local loader\n');

// ---- Probe 1: the load path (the keystone) — a SmartObject NOT compiled in, loaded + run.
{
  const p = await pack({ realm: 'app', name: 'echo', provides: ['echo:v1'] }, echoCode('p1'));
  await put(p.descKey, p.descText);
  await put(p.codeKey, p.codeText);
  const r = await loadId(p.descriptor.id);
  check('1a load returns ok (not a fault)', r && r.op !== 'fault', r && r.op === 'fault' ? r.body.detail : ('loaded ' + p.descriptor.id.slice(0, 24) + '...'));
  const echo = driver(kernel.resolve({ need: ['echo:v1'] }));
  const back = await echo.send('echo', { x: 1 });
  check('1b loaded cell answers through acquire/transmit', back && back.op === 'echoed' && back.body && back.body.x === 1, back && back.op === 'fault' ? back.body.detail : ('echoed ' + JSON.stringify(back && back.body)));
  globalThis.__P1_ID = p.descriptor.id;
}

// ---- Probe 2: code tamper refuses (codeHash mismatch), no mint, no bind.
{
  const p = await pack({ realm: 'app', name: 'echoc', provides: ['echoc:v1'] }, echoCode('p2'));
  await put(p.descKey, p.descText);
  await put(p.codeKey, p.codeText.replace('echoed', 'echoED')); // one-byte-class flip -> hash changes
  const r = await loadId(p.descriptor.id);
  check('2a code tamper -> fault', r && r.op === 'fault' && /codeHash mismatch/.test(r.body.detail || ''), r && r.body ? r.body.detail : String(r));
  const d = kernel.describe(p.descriptor.id);
  check('2b no mint after refusal (describe still fault)', d && d.op === 'fault');
  const bind = kernel.resolve({ need: ['echoc:v1'] });
  check('2c no bind possible (resolve finds nothing)', bind && bind.op === 'fault');
}

// ---- Probe 3: descriptor tamper refuses (ref mismatch) — the address is the hash.
{
  const p = await pack({ realm: 'app', name: 'echod', provides: ['echod:v1'] }, echoCode('p3'));
  const tampered = { ...p.descriptor, cost: 'high' }; // change a field but keep the id (ref) -> recompute != ref
  await put(p.descKey, JSON.stringify(tampered));
  await put(p.codeKey, p.codeText);
  const r = await loadId(p.descriptor.id);
  check('3 descriptor tamper -> fault (ref mismatch)', r && r.op === 'fault' && /ref mismatch|id mismatch/.test(r.body.detail || ''), r && r.body ? r.body.detail : String(r));
}

// ---- Probe 4: missing code -> not-found (no partial install).
{
  const p = await pack({ realm: 'app', name: 'echom', provides: ['echom:v1'] }, echoCode('p4'));
  await put(p.descKey, p.descText); // descriptor only, no code
  const r = await loadId(p.descriptor.id);
  check('4 missing code -> not-found', r && r.op === 'fault' && r.body.code === 'not-found', r && r.body ? (r.body.code + ' ' + r.body.detail) : String(r));
}

// ---- Probe 5: idempotent — loading probe 1's id again returns already, no double-mint.
{
  const r = await loadId(globalThis.__P1_ID);
  check('5 idempotent second load (already)', r && r.op !== 'fault' && r.body && r.body.already === true, r && r.op === 'fault' ? r.body.detail : JSON.stringify(r && r.body));
}

console.log('\n' + passes + ' pass / ' + fails + ' fail');
process.exit(fails ? 1 : 0);
