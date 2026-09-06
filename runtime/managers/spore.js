// Spore (L3): the verified LOCAL loader (sovereign-peer O0). On `load {id}` it
// reads a package (descriptor + code) from local store:kv by content-hash,
// verifies the address-hash, the code-hash, and the schema (via the registry's
// own mint), then registers the code as the descriptor's factory. After a load
// the ordinary acquire()/resolve/bind path binds it, indistinguishable from a
// compiled-in cell (CELL.md A1.1).
//
// SANDBOX GATE (hard): step 9 instantiates code with ambient privileges (a
// module import is not a sandbox). This is safe here ONLY because the store is
// local and pre-seeded. Before any NETWORK fetch of a package (Spore O2), the
// loaded code must get a capability-restricted instantiation or a Wasm artifact.
// Do not ship remote fetch on this loader. (sovereign-peer O0 spec, "sandbox gate".)
import { makeFault } from '../kernel/faults.js';
import { sha256, jcs } from '../lib/wire.js';

export const DESCRIPTOR = {
  id: 'cell://system/spore@0', provides: ['pkg:load'], requires: ['store:kv'], gates: [], cost: 'low',
  mailbox: { bound: 32, drop: 'reject' }, controlOps: [], faults: ['bad-envelope', 'not-found', 'dead'],
  resolutions: [{ key: 'local', gates: [], cost: 'low' }],
};

const ID_RE = /^cell:\/\/[a-z0-9-]+\/[a-z0-9-]+@[a-z0-9]+$/;
const enc = new TextEncoder();
const hex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hexSha256(strOrBytes) {
  return hex(await sha256(typeof strOrBytes === 'string' ? enc.encode(strOrBytes) : strOrBytes));
}
function reflessId(id) { const at = id.lastIndexOf('@'); return at === -1 ? id : id.slice(0, at); }

// The ref a descriptor MUST carry: hex sha256 of jcs(descriptor with a ref-less
// id) — the id contains the ref, so it cannot hash itself. Publisher and loader
// share this one function (the same-implementation discipline).
export async function computeRef(descriptor) {
  return hexSha256(jcs({ ...descriptor, id: reflessId(descriptor.id) }));
}

// Publisher/test helper: build a package (descriptor with id+codeHash, and the
// two store keys) from a partial descriptor + code text. Kept beside the loader
// so both compute ref/codeHash the identical way.
export async function pack(base, codeText) {
  const codeHash = await hexSha256(codeText);
  const refless = {
    id: 'cell://' + base.realm + '/' + base.name,
    provides: base.provides, requires: base.requires || [], gates: base.gates || [],
    cost: base.cost || 'low', mailbox: base.mailbox || { bound: 16, drop: 'reject' },
    controlOps: base.controlOps || [], faults: base.faults || ['bad-envelope'],
    resolutions: base.resolutions || [{ key: 'local', gates: [], cost: 'low' }],
    codeHash,
  };
  const ref = await hexSha256(jcs(refless));
  const descriptor = { ...refless, id: refless.id + '@' + ref };
  return { descriptor, ref, codeHash, descText: JSON.stringify(descriptor), codeText,
    descKey: 'spore/d/' + ref, codeKey: 'spore/c/' + codeHash };
}

// Instantiate code text into a module. Browser: blob URL. Node/headless (and
// where Blob/createObjectURL are absent): data URL — the same import mechanism
// index.html already probes as alive.
async function instantiate(codeText) {
  // Real browser: blob URL (Node exposes Blob/createObjectURL too but its ESM
  // loader refuses the blob: scheme, so gate on a DOM marker, not Blob presence).
  const inBrowser = typeof document !== 'undefined';
  if (inBrowser && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(new Blob([codeText], { type: 'text/javascript' }));
    try { return await import(url); } finally { URL.revokeObjectURL(url); }
  }
  return import('data:text/javascript,' + encodeURIComponent(codeText));
}

export function register(kernel) {
  kernel.registerFactory(DESCRIPTOR.id, (_key, emit) => {
    // Two reply mechanisms, one per cell: store:kv answers a `get` on the
    // return path (an emitted {op:'value'} envelope), so it needs a waiter;
    // the registry answers `mint` IN THE ACK (no emit), so it uses the ack.
    let sh = null; const stW = new Map(); let stSeq = 0;
    function ensureStore() {
      if (!sh) sh = kernel.bind(kernel.resolve({ need: ['store:kv'] }), { onEnvelope: (env) => {
        if (env.correlation && stW.has(env.correlation)) { const w = stW.get(env.correlation); stW.delete(env.correlation); w(env); }
      } });
      return sh;
    }
    async function storeGet(key) {
      ensureStore();
      if (!sh || !sh.ref) return undefined;
      const c = 'sp-st-' + (++stSeq);
      const reply = new Promise((res) => stW.set(c, res));
      const ack = await kernel.transmit(sh, { op: 'get', body: { key }, correlation: c });
      if (ack && ack.op === 'fault') { stW.delete(c); return undefined; }
      const env = await reply;
      return env && env.body ? env.body.value : undefined;
    }
    let rh = null; let rgSeq = 0;
    function ensureRegistry() { if (!rh) rh = kernel.bind(kernel.resolve({ need: ['registry'] }), { onEnvelope: () => {} }); return rh; }
    async function mint(descriptor) {
      ensureRegistry();
      if (!rh || !rh.ref) return makeFault('dead', 'no registry', 0);
      return kernel.transmit(rh, { op: 'mint', body: descriptor, correlation: 'sp-rg-' + (++rgSeq) }); // ack IS the result
    }

    async function load(id, correlation) {
      if (typeof id !== 'string' || !ID_RE.test(id)) return makeFault('bad-envelope', 'bad id', correlation);
      const ref = id.slice(id.lastIndexOf('@') + 1);
      const existing = kernel.describe(id);
      if (existing && existing.op !== 'fault') return { accepted: true, correlation, body: { id, already: true } };

      const descText = await storeGet('spore/d/' + ref);
      if (typeof descText !== 'string') return makeFault('not-found', 'descriptor', correlation);
      let descriptor;
      try { descriptor = JSON.parse(descText); } catch { return makeFault('bad-envelope', 'descriptor json', correlation); }
      if (descriptor.id !== id) return makeFault('bad-envelope', 'id mismatch', correlation);
      if ((await computeRef(descriptor)) !== ref) return makeFault('bad-envelope', 'ref mismatch', correlation);   // address IS the hash
      if (typeof descriptor.codeHash !== 'string') return makeFault('bad-envelope', 'no codeHash', correlation);

      const codeText = await storeGet('spore/c/' + descriptor.codeHash);
      if (typeof codeText !== 'string') return makeFault('not-found', 'code', correlation);
      if ((await hexSha256(codeText)) !== descriptor.codeHash) return makeFault('bad-envelope', 'codeHash mismatch', correlation);  // code bound to descriptor

      let mod;
      try { mod = await instantiate(codeText); } catch (e) { return makeFault('bad-envelope', 'instantiate: ' + ((e && e.message) || e), correlation); }
      if (!mod || typeof mod.factory !== 'function') return makeFault('bad-envelope', 'no factory export', correlation);

      const m = await mint(descriptor);   // registry validates the schema; a bad descriptor never mints
      if (m && m.op === 'fault') return makeFault('bad-envelope', 'mint refused: ' + (m.body && m.body.detail), correlation);
      kernel.registerFactory(descriptor.id, mod.factory);
      return { accepted: true, correlation, body: { id } };
    }

    return {
      accept(env) {
        if (env.op === 'load' && env.body && typeof env.body.id === 'string') return load(env.body.id, env.correlation);
        return makeFault('bad-envelope', env.op, env.correlation);
      },
      close() { /* store/registry handles are released by the binder on teardown */ },
    };
  });
  return DESCRIPTOR;
}
