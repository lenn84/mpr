// Identity cell v2 (authid R7 L1): the lock's tumblers. Custodies the Ring
// keypair, mints the session identity (session == ring_id, the key IS the
// identity), and signs on request under an allowlisted domain context. The
// private key never crosses the cell boundary; there is no export op.
//
// The v2 resolution gates on secure-context: crypto.subtle is switched off on a
// plain-HTTP origin (B3 law), so a plain-HTTP bind is REFUSED at bind-time rather
// than succeeding and then faulting at generateKey (authid Seat B F3). L0's HTTPS
// floor must therefore land before this cell can bind on a device.
//
// The seam the platform's customer-auth contract (redirect / one-time code /
// signed token) eventually replaces is now "possession of the signing key":
// there is no shared secret to hand over. The credential is the key, in the cell.
import { makeFault } from '../kernel/faults.js';
import { b64u, unb64u, signedBytes, CONTEXT_SET } from '../lib/wire.js';
import { open as e2eOpen } from '../lib/e2e.js';

const subtle = globalThis.crypto.subtle;

export const DESCRIPTOR = {
  id: 'cell://system/identity@2', provides: ['identity:pair'], requires: [], gates: [], cost: 'low',
  mailbox: { bound: 16, drop: 'reject' }, controlOps: [], faults: ['refused', 'bad-envelope'],
  resolutions: [{ key: 'ring', gates: ['secure-context'], cost: 'low' }],
};

// Custody: non-extractable CryptoKeys live in IndexedDB where present (browser;
// CryptoKey is structured-cloneable and the non-extractable flag is preserved,
// so the key survives restart without ever being exportable). Headless (Node,
// no IndexedDB) falls back to an in-process map — cross-restart persistence is
// the IndexedDB path only, stated honestly.
function custody() {
  if (typeof indexedDB !== 'undefined') {
    const open = new Promise((res, rej) => {
      const rq = indexedDB.open('cell-identity', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('keys');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    const op = (mode, fn) => open.then((db) => new Promise((res, rej) => {
      const tx = db.transaction('keys', mode);
      const rq = fn(tx.objectStore('keys'));
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    }));
    return { get: (k) => op('readonly', (s) => s.get(k)), put: (k, v) => op('readwrite', (s) => s.put(v, k)) };
  }
  const mem = (globalThis.__cellIdentityMem = globalThis.__cellIdentityMem || new Map());
  return { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, v); } };
}

// Custody v2 (G4 drive finding, 2026-09-06): WebKit (Safari 26.2/iOS) SILENTLY
// DROPS any IndexedDB record containing an X25519 CryptoKey — the transaction
// reports COMMITTED, the row is gone next session (census/storage-probe.html
// caught it live; Ed25519, AES, and plain records persist). So the custody splits
// into three records, each a shape the probe PROVED survives: 'edk' holds the
// Ed25519 CryptoKeys, 'wrap' one non-extractable AES-GCM key, and 'ring' plain
// fields plus the X25519 private key as AES-GCM ciphertext of its pkcs8. The
// X25519 key is extractable only for the instant of its first export at birth;
// what the cell HOLDS (and re-imports each boot) is non-extractable, and what
// rests on disk is ciphertext. Honest rider: the pkcs8 bytes exist transiently
// in memory at birth/boot — inside the declared software-anchor ceiling (§7).
async function loadOrGenerate() {
  const store = custody();
  const [rec, edk, wrap] = await Promise.all([store.get('ring'), store.get('edk'), store.get('wrap')]);
  if (rec && rec.v === 2 && edk && edk.priv && wrap) {
    try {
      const pkcs8 = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, wrap, rec.xw));
      const xPriv = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
      pkcs8.fill(0);
      return { edPriv: edk.priv, xPriv, ring: rec.ring, x_pub: rec.x_pub };
    } catch { /* unreadable v2 custody: fall through to a fresh birth */ }
  }
  if (rec && rec.edPriv && rec.xPriv) return rec; // v1 record, engines that do persist X25519 keys
  const ed = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const x = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const ringRaw = new Uint8Array(await subtle.exportKey('raw', ed.publicKey));
  const xRaw = new Uint8Array(await subtle.exportKey('raw', x.publicKey));
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', x.privateKey));
  const wrapKey = wrap || await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const xw = await subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, pkcs8);
  const xPriv = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
  pkcs8.fill(0);
  const v2 = { v: 2, ring: b64u(ringRaw), x_pub: b64u(xRaw), xw, iv };
  await store.put('edk', { priv: ed.privateKey, pub: ed.publicKey });
  if (!wrap) await store.put('wrap', wrapKey);
  await store.put('ring', v2);
  return { edPriv: ed.privateKey, xPriv, ring: v2.ring, x_pub: v2.x_pub };
}

export function register(kernel) {
  kernel.registerFactory(DESCRIPTOR.id, (_key, emit) => {
    let keys = null;
    const ready = loadOrGenerate().then((k) => { keys = k; }).catch(() => { keys = null; });
    return {
      async accept(env) {
        await ready;
        if (!keys) return makeFault('refused', 'key custody unavailable', env.correlation);
        // mint = load-or-generate; the cell is the source of the session and ring.
        if (env.op === 'mint') {
          emit({ op: 'identity', correlation: env.correlation,
            body: { session: keys.ring, name: String((env.body && env.body.name) || '').slice(0, 30), ring: keys.ring, x_pub: keys.x_pub } });
          return { accepted: true, correlation: env.correlation };
        }
        // sign = an Ed25519 signature over context‖payload; context must be in the
        // §4.1 registry, payload is the fixed-width field concat as base64url.
        if (env.op === 'sign' && env.body && typeof env.body.context === 'string' && typeof env.body.payload === 'string') {
          if (!CONTEXT_SET.has(env.body.context)) return makeFault('refused', 'unregistered context', env.correlation);
          try {
            const sig = new Uint8Array(await subtle.sign({ name: 'Ed25519' }, keys.edPriv, signedBytes(env.body.context, unb64u(env.body.payload))));
            emit({ op: 'signature', correlation: env.correlation, body: { sig: b64u(sig) } });
            return { accepted: true, correlation: env.correlation };
          } catch (e) { return makeFault('refused', String((e && e.message) || e), env.correlation); }
        }
        // open = E2E decryption (L7): ECDH against the custodied static X25519 key,
        // which never crosses the cell boundary — the plaintext does, the key not.
        if (env.op === 'open' && env.body && typeof env.body.pair === 'string' && typeof env.body.e === 'string' && typeof env.body.c === 'string') {
          try {
            const plaintext = await e2eOpen(keys.xPriv, env.body.pair, env.body.e, env.body.c);
            emit({ op: 'opened', correlation: env.correlation, body: { plaintext } });
            return { accepted: true, correlation: env.correlation };
          } catch { return makeFault('refused', 'sealed payload does not decrypt', env.correlation); }
        }
        return makeFault('bad-envelope', env.op, env.correlation);
      },
      close() {},
    };
  });
  return DESCRIPTOR;
}
