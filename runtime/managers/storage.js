// Storage manager: one virtual-disk surface, two resolutions. IndexedDB is the
// floor; OPFS elevates behind the secure-context gate (D1, B3). All operations
// serialize through a single chain (M3 probe obligation); faults are normalized.
import { makeFault } from '../kernel/faults.js';

export const DESCRIPTOR = {
  id: 'cell://system/storage@1', provides: ['store:kv'], requires: [], gates: [], cost: 'low',
  mailbox: { bound: 64, drop: 'reject' }, controlOps: [], faults: ['refused', 'not-found', 'overflow', 'bad-envelope'],
  resolutions: [
    { key: 'idb', gates: [], cost: 'medium' },
    { key: 'opfs', gates: ['secure-context'], cost: 'low' },
  ],
};

function idbBackend() {
  const open = new Promise((res, rej) => {
    const rq = indexedDB.open('cell-store', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  const op = (mode, fn) => open.then((db) => new Promise((res, rej) => {
    const tx = db.transaction('kv', mode);
    const rq = fn(tx.objectStore('kv'));
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
  return {
    put: (k, v) => op('readwrite', (s) => s.put(v, k)),
    get: (k) => op('readonly', (s) => s.get(k)),
  };
}

function opfsBackend() {
  const root = navigator.storage.getDirectory();
  return {
    put: async (k, v) => {
      const fh = await (await root).getFileHandle('kv-' + k, { create: true });
      const w = await fh.createWritable(); await w.write(JSON.stringify(v)); await w.close();
    },
    get: async (k) => {
      try {
        const fh = await (await root).getFileHandle('kv-' + k);
        return JSON.parse(await (await fh.getFile()).text());
      } catch { return undefined; }
    },
  };
}

// Headless floor: where neither OPFS nor IndexedDB exists (Node), an in-process
// map. Same shape as identity's custody fallback; browser behavior is unchanged.
function memBackend() {
  const m = (globalThis.__cellStoreMem = globalThis.__cellStoreMem || new Map());
  return { put: async (k, v) => { m.set(k, JSON.stringify(v)); }, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : undefined) };
}

function pickBackend(key) {
  if (key === 'opfs' && typeof navigator !== 'undefined' && navigator.storage) return opfsBackend();
  if (typeof indexedDB !== 'undefined') return idbBackend();
  return memBackend();
}

export function register(kernel) {
  kernel.registerFactory(DESCRIPTOR.id, (key, emit) => {
    const backend = pickBackend(key);
    let chain = Promise.resolve();
    return {
      accept(env) {
        if ((env.op === 'put' || env.op === 'get') && env.body && typeof env.body.key === 'string') {
          const { key: k, value } = env.body;
          chain = chain.then(async () => {
            try {
              if (env.op === 'put') { await backend.put(k, value); emit({ op: 'stored', correlation: env.correlation, body: { key: k } }); }
              else { const v = await backend.get(k); emit({ op: 'value', correlation: env.correlation, body: { key: k, value: v } }); }
            } catch (err) {
              const quota = err && /quota/i.test(String(err.name || err.message));
              emit(makeFault(quota ? 'overflow' : 'refused', String((err && err.message) || err), env.correlation));
            }
          });
          return { accepted: true, correlation: env.correlation };
        }
        return makeFault('bad-envelope', env.op, env.correlation);
      },
      close() {},
    };
  });
  return DESCRIPTOR;
}
