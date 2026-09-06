// The M7 sub-ladder headless harness — shared floor for the level modules.
//
// Why this exists: the L5–L8 drives (raw/drive-headless-l*.json) were each produced
// by an ephemeral Node harness re-authored from the phase-doc prose and then thrown
// away. Re-verifying meant re-deriving the harness every time. This is that harness,
// kept: one committed runner that drives the REAL runtime cells (kernel, identity,
// storage, transport, lineage, e2e, envelope, wire) exactly as the browser does, so
// a green here means what a green in those drives meant. It is authoring, not
// evidence — sessions author, the operator commits (D2). It re-runs already-passed,
// already-pre-declared exams (regression); it does not declare new ones (RES-EVID-5).
//
// This file holds only what every level shares: the check accumulator, the throwaway
// ceremony/actor helpers (reusing census/ceremony.mjs so the exact wire bytes are
// exercised, §4.1), and small crypto utilities. The in-process relay + member boot
// live in ./net.mjs; each level (l5..l8) is its own module.
import { b64u, unb64u, fields, CONTEXTS, signedBytes } from '../runtime/lib/wire.js';
import { makeEntry, addSig, verifyChain, chainHash } from '../runtime/lib/lineage.js';
import { newGenesis, composeCeremony, rosterText } from '../census/ceremony.mjs';

const subtle = globalThis.crypto.subtle;

// --- The check accumulator. A Section collects {name, ok, detail} the way the
// drives record findings; a level pushes into it and the runner rolls them up.
export class Section {
  constructor(title) { this.title = title; this.findings = []; }
  check(name, cond, detail = '') {
    const ok = !!cond;
    this.findings.push({ name, ok, detail: String(detail) });
    return ok;
  }
  // A throwing check: record the error text as the detail on failure.
  async guard(name, fn, detailOnPass = '') {
    try { const r = await fn(); return this.check(name, r !== false, r && r !== true ? String(r) : detailOnPass); }
    catch (e) { return this.check(name, false, 'threw: ' + ((e && e.message) || e)); }
  }
  get passed() { return this.findings.every((f) => f.ok); }
  get counts() { const t = this.findings.length, p = this.findings.filter((f) => f.ok).length; return { total: t, pass: p, fail: t - p }; }
}

// --- An "actor": a ring keypair + a signer that speaks the identity cell's exact
// signing contract (context in the §4.1 registry, payload = fixed-width field
// concat as base64url). Used to craft ceremony material and synthetic peers. The
// X25519 private key is kept so E2E-open drills can decrypt as the recipient.
export async function makeActor(petname_hint = '') {
  const ed = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const x = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const ring = b64u(new Uint8Array(await subtle.exportKey('raw', ed.publicKey)));
  const x_pub = b64u(new Uint8Array(await subtle.exportKey('raw', x.publicKey)));
  const sign = async (context, payloadB64) =>
    b64u(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, ed.privateKey, signedBytes(context, unb64u(payloadB64)))));
  const bundle_epoch = 1;
  const bundle_sig = await sign(CONTEXTS.bundle, b64u(fields.bundle(bundle_epoch, unb64u(ring), unb64u(x_pub))));
  return { ring, x_pub, bundle_epoch, bundle_sig, petname_hint, sign, edPub: ed.publicKey, xPriv: x.privateKey, xPub: x.publicKey };
}

// --- Compose a throwaway ceremony (genesis + N member BIRTHs) exactly as the
// offline kit does, then have each member counter-sign its own BIRTH (spec step 5).
// Returns the strict-verifying replica + roster + the actors.
export async function throwawayCeremony({ members = 2, budget = 6, now = 1_700_000_000_000, petnames } = {}) {
  const names = petnames || ['captain', 'bobby', 'ada', 'grace'];
  const actors = [];
  for (let i = 0; i < members; i++) actors.push(await makeActor(names[i] || ('m' + i)));
  const genesis = await newGenesis();
  const composed = await composeCeremony({ genesis, members: actors, params: { invite_budget: budget }, now });
  return { genesis, actors, ...composed };
}

// Counter-sign each BIRTH with its member's own key (the on-device step 5). Mutates
// entries in place (addSig appends without touching the chained content).
export async function countersign(entries, actors) {
  const byRing = new Map(actors.map((a) => [a.ring, a]));
  for (const e of entries) {
    if (e.type === 'BIRTH') { const a = byRing.get(e.body.ring); if (a) await addSig(e, a.ring, a.sign); }
  }
  return entries;
}

// Append a signed entry of an arbitrary format-only type to a chain (seed a STOP /
// WEIGHT-REVOKE / CONTEST for the "formats chain" assertions and scene seeds).
export async function appendSigned(entries, type, body, signerActor) {
  const prevHash = await chainHash(entries[entries.length - 1]);
  const e = await makeEntry({ n: entries.length, prevHash, ts: (entries[entries.length - 1].ts || 0) + 1, type, body }, [{ ring: signerActor.ring, sign: signerActor.sign }]);
  entries.push(e);
  return e;
}

export { b64u, unb64u, fields, CONTEXTS, verifyChain, rosterText };
