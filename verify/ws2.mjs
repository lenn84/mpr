// WS2 — Addendum-2 conformance checks (phases/M7-workstream2.md). These lock the
// audit's discharged clauses in as permanent regression checks:
//   (1) the tightened kernel validateDescriptor rejects a malformed mailbox (A2.2)
//   (2) every shipped descriptor passes the tightened validation (A2.2)
//   (3) static fault-vocabulary sweep: every makeFault('code') literal in a manager
//       source appears in that module's declared faults (A2.2)
//   (4) the EXECUTABLE blindness scan over the app modules — ambient-authority
//       globals included, comments stripped, capability reach not token spelling (A2.5)
//   (5) the clock root's verb-mediated `now` (A2.5)
import { readFileSync } from 'node:fs';
import { createKernel, validateDescriptor } from '../runtime/kernel/kernel.js';

const SCHEMA = { descriptor: { required: ['id', 'provides', 'requires', 'gates', 'cost', 'mailbox', 'controlOps', 'faults', 'resolutions'], cost: ['low', 'medium', 'high'], drop: ['oldest', 'reject'], idPattern: '^cell://[a-z0-9-]+/[a-z0-9-]+@[a-z0-9]+$', resolution: { required: ['key', 'gates', 'cost'] } } };
const MANAGERS = ['storage', 'identity', 'transport', 'scheduler', 'executor', 'spore'];
const APP_MODULES = ['chat', 'g1'];
// Ambient-authority reach an app module must not have (pure intrinsics like
// Math/JSON/Promise are permitted — the criterion is capability, not spelling).
const FORBIDDEN = ['Date', 'crypto', 'fetch', 'performance', 'localStorage', 'sessionStorage', 'indexedDB',
  'navigator', 'window', 'document', 'self', 'globalThis', 'structuredClone', 'WebSocket', 'XMLHttpRequest', 'process'];

const src = (rel) => readFileSync(new URL('../runtime/' + rel, import.meta.url), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

export async function run(sec) {
  // (1) tightened validateDescriptor
  const base = { id: 'cell://t/t@1', provides: [], requires: [], gates: [], cost: 'low', mailbox: { bound: 8, drop: 'reject' }, controlOps: [], faults: [], resolutions: [{ key: 'k', gates: [], cost: 'low' }] };
  sec.check('a2.2 validateDescriptor accepts a well-formed mailbox', validateDescriptor(base, SCHEMA).length === 0, '');
  sec.check('a2.2 validateDescriptor rejects a non-integer mailbox bound',
    validateDescriptor({ ...base, mailbox: { bound: 'many', drop: 'reject' } }, SCHEMA).some((e) => /mailbox bound/.test(e)), '');
  sec.check('a2.2 validateDescriptor rejects an unknown drop policy',
    validateDescriptor({ ...base, mailbox: { bound: 8, drop: 'newest' } }, SCHEMA).some((e) => /mailbox drop/.test(e)), '');

  // (2) + (3) every shipped descriptor: passes validation; fault emissions declared.
  for (const name of MANAGERS) {
    const mod = await import('../runtime/managers/' + name + '.js');
    const descriptors = [mod.DESCRIPTOR, mod.PAIR_DESCRIPTOR].filter(Boolean);
    const errs = descriptors.flatMap((d) => validateDescriptor(d, SCHEMA));
    sec.check('a2.2 ' + name + ' descriptor(s) pass tightened validation', errs.length === 0, errs.join('; '));
    const declared = new Set(descriptors.flatMap((d) => d.faults));
    const emitted = [...stripComments(src('managers/' + name + '.js')).matchAll(/makeFault\(\s*'([a-z-]+)'/g)].map((m) => m[1]);
    const undeclared = [...new Set(emitted.filter((c) => !declared.has(c)))];
    sec.check('a2.2 ' + name + ' emits only declared fault codes', undeclared.length === 0,
      undeclared.length ? 'undeclared: ' + undeclared.join(',') : emitted.length + ' emission site(s), all declared');
  }

  // (4) the executable blindness scan (A2.5): app modules carry zero ambient-authority tokens.
  for (const name of APP_MODULES) {
    const body = stripComments(src('app/' + name + '.js'));
    const hits = FORBIDDEN.filter((t) => new RegExp('\\b' + t + '\\b').test(body));
    sec.check('a2.5 blindness: app/' + name + '.js reaches no ambient authority', hits.length === 0,
      hits.length ? 'reaches: ' + hits.join(',') : FORBIDDEN.length + ' capabilities scanned');
  }

  // (5) the clock root's verb-mediated now.
  const kernel = await createKernel();
  const waiters = new Map(); let seq = 0;
  const clock = kernel.bind(kernel.resolve({ need: ['time'] }), { onEnvelope: (env) => { const w = waiters.get(env.correlation); if (w) { waiters.delete(env.correlation); w(env); } } });
  const ask = (op, body) => { const c = 'ws2-' + (++seq); const p = new Promise((r) => waiters.set(c, r)); return kernel.transmit(clock, { op, body, correlation: c }).then((ack) => (ack && ack.op === 'fault') ? ack : p); };
  const t1 = await ask('now');
  sec.check('a2.5 clock root answers `now` with wall-clock ms', t1.op === 'time' && Number.isInteger(t1.body.ms) && t1.body.ms > 1_600_000_000_000, String(t1.body && t1.body.ms).slice(0, 13));
  const t2 = await ask('now');
  sec.check('a2.5 clock `now` is monotone across two asks', t2.op === 'time' && t2.body.ms >= t1.body.ms, '');
}
