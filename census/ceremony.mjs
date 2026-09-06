// The ceremony kit (authid R7 §3, L5): the birth room's tooling, run on the
// OFFLINE machine — never on the relay host in steady state. It generates the
// genesis key, composes and signs the GENESIS-DECL / INVITE-MINT / BIRTH entries,
// and writes the roster file from the BIRTH entries. Member ring material arrives
// as QR-carried JSON ({ring, x_pub, bundle_epoch, bundle_sig, petname_hint});
// nothing here ever touches a network.
//
// Same-implementation rule (§4.1): this kit imports the exact wire.js/lineage.js
// the in-browser client runs — a byte disagreement between the offline kit and
// the client would fail every chain and anchor check, so there is one code path.
//
// The numbered ceremony script lives in phases/M7-export.md (rehearsal and real
// run are the same text); this file is steps 1, 2, 4, 8 and 9's wipe target.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { b64u, unb64u, signedBytes } from '../runtime/lib/wire.js';
import { makeEntry, verifyChain, ZERO_HASH, Z4_SENTENCE, chainHash } from '../runtime/lib/lineage.js';

const subtle = globalThis.crypto.subtle;

// Step 1: the genesis Ed25519 key. Extractable HERE only — the offline machine
// must print it to paper/steel (step 9) and then wipe it; browser custody rules
// do not apply to the vault path.
export async function newGenesis() {
  const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const ring = b64u(new Uint8Array(await subtle.exportKey('raw', kp.publicKey)));
  const paper = b64u(new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey)));
  return { ring, paper, sign: signer(kp.privateKey) };
}

export async function importGenesis({ ring, paper }) {
  const priv = await subtle.importKey('pkcs8', unb64u(paper), { name: 'Ed25519' }, false, ['sign']);
  return { ring, paper, sign: signer(priv) };
}

function signer(priv) {
  return async (context, payloadB64) =>
    b64u(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, priv, signedBytes(context, unb64u(payloadB64)))));
}

// Steps 2 + 4: compose the constitution and one INVITE-MINT + BIRTH per member.
// Every BIRTH leaves here with the genesis signature only; the member counter-sign
// is step 5, on-device — the chain hash excludes sigs so that cannot break links.
export async function composeCeremony({ genesis, members, params = {}, now }) {
  if (!Number.isInteger(now)) throw new Error('ceremony time required');
  const budget = params.invite_budget ?? 6;
  const entries = [];
  let prevHash = ZERO_HASH, n = 0;
  const push = async (type, body) => {
    const e = await makeEntry({ n, prevHash, ts: now, type, body }, [{ ring: genesis.ring, sign: genesis.sign }]);
    entries.push(e); prevHash = await chainHash(e); n++;
    return e;
  };
  await push('GENESIS-DECL', {
    genesis_ring: genesis.ring,
    invite_budget: budget,
    ttl: params.ttl ?? { soft_h: 24, hard_h: 72 },
    provisional_sunset: params.provisional_sunset ?? now + 90 * 24 * 3600 * 1000,
    vault_rule: '30-day public announcement before genesis re-entry; any member may veto',
    sentence: Z4_SENTENCE,
  });
  let mintSeq = 0;
  for (const m of members) {
    if (!m.ring || !m.x_pub || !Number.isInteger(m.bundle_epoch) || !m.bundle_sig) throw new Error('member material incomplete');
    mintSeq++;
    await push('INVITE-MINT', { issuer: genesis.ring, mint_seq: mintSeq, remaining: budget - mintSeq });
    await push('BIRTH', {
      ring: m.ring, x_pub: m.x_pub, bundle_epoch: m.bundle_epoch, bundle_sig: m.bundle_sig,
      petname_hint: String(m.petname_hint || '').slice(0, 30),
      anchor: 'PROVISIONAL-SOFTWARE',
      invite_ref: { issuer_ring: genesis.ring, mint_seq: mintSeq },
    });
  }
  // The kit verifies its own output (bundle sigs included) before it leaves the
  // room; countersigns are pending until step 5.
  const v = await verifyChain(entries, { requireCountersign: false });
  if (!v.ok) throw new Error('composed chain does not verify: ' + v.reason);
  return { entries, roster: v.births.map((b) => b.ring), budget: v.budget };
}

// Step 8: the roster file — the transport ACL, written from the BIRTH entries.
export function rosterText(rings) { return rings.join('\n') + '\n'; }

// --- CLI for the real ceremony (the rehearsal drives call the functions above).
//   node census/ceremony.mjs genesis <keyfile>
//   node census/ceremony.mjs compose <keyfile> <outdir> <member-qr.json> <member-qr.json> [...]
//   node census/ceremony.mjs wipe <keyfile>
const isMain = import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href;
const [, , cmd, ...rest] = isMain ? process.argv : [];
if (cmd === 'genesis') {
  const g = await newGenesis();
  writeFileSync(rest[0], JSON.stringify({ ring: g.ring, paper: g.paper }));
  console.log('genesis ring ' + g.ring + ' written to ' + rest[0] + ' — print, then wipe');
} else if (cmd === 'compose') {
  const [keyfile, outdir, ...qrs] = rest;
  const genesis = await importGenesis(JSON.parse(readFileSync(keyfile, 'utf8')));
  const members = qrs.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const { entries, roster, budget } = await composeCeremony({ genesis, members, now: Date.now() });
  writeFileSync(outdir + '/lineage.json', JSON.stringify(entries, null, 1));
  writeFileSync(outdir + '/roster.txt', rosterText(roster));
  console.log('composed ' + entries.length + ' entries; roster ' + roster.length + ' ring(s); invites ' + budget.spent + '/' + budget.declared + ' spent, ' + budget.remaining + ' remaining');
} else if (cmd === 'wipe') {
  rmSync(rest[0]);
  console.log('genesis key wiped from this machine — the vault holds the only copies');
} else if (cmd !== undefined) {
  console.error('usage: ceremony.mjs genesis|compose|wipe ...');
  process.exit(1);
}
