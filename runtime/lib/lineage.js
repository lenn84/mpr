// The lineage log (authid R7 §4.7, L5): append-only, hash-chained, replicated in
// full on every device. Layer-1 truth — no home copy outranks another. Entries are
// signed under mpr-lineage-v1 and the signature covers type/n/ts/prev_hash/body
// (crypto HIGH-4): an entry's kind and its display order/time are not mutable.
//
// Build decision (L5, forced by the ceremony ordering): the chain hash covers
// {n, prev_hash, ts, type, body} and EXCLUDES sigs[]. The ceremony script has
// members counter-sign their BIRTH on-device AFTER all entries are composed
// offline (spec steps 4 -> 5), so a late counter-signature must not break the
// links that were hashed at composition. Nothing signed escapes coverage — every
// signature independently covers the same (type, n, ts, prev_hash, bodyHash)
// field — only sig-set MEMBERSHIP sits outside the chain hash, and verifyChain
// enforces the required signers per type, so a stripped signature still fails.
//
// What the descent check catches and does NOT catch (stated, never implied away):
// truncation and rollback are caught against the per-verifier anchors; EQUIVOCATION
// and FREEZE/WITHHOLD are not — at N=2 the two humans compare heads in person at
// each ceremony; beyond N=2 that is the at-scale log debt (§4.7).
import { b64u, unb64u, concat, sha256, fields, CONTEXTS, verifySig, jcs } from './wire.js';

const enc = new TextEncoder();

// Fixed-width enum codes for the signed concatenation (the free-text label lives
// only in the JSON entry; the tag is what the signature covers).
export const TYPE_TAG = {
  'GENESIS-DECL': 1, 'BIRTH': 2, 'INVITE-MINT': 3, 'REANCHOR': 4, 'STOP': 5,
  'CONTEST-OPEN': 6, 'CONTEST-CLOSE': 7, 'VAULT-REENTRY-ANNOUNCE': 8, 'WEIGHT-REVOKE': 9,
};

export const ZERO_HASH = b64u(new Uint8Array(32));

// The Z4 sentence, quoted verbatim in every GENESIS-DECL (binding rule 12).
export const Z4_SENTENCE = 'Birth in this deployment is by invitation; existence-by-permission is the declared cost until an open, weightless birth track exists.';

// Chain hash: SHA-256(JCS(entry without sigs)). See the build decision above.
export async function chainHash(entry) {
  const { n, prev_hash, ts, type, body } = entry;
  return b64u(await sha256(enc.encode(jcs({ n, prev_hash, ts, type, body }))));
}

// The exact bytes every signature on an entry covers (context added by the cell).
export async function lineageField(entry) {
  const tag = TYPE_TAG[entry.type];
  if (!tag) throw new Error('unknown lineage type ' + entry.type);
  const bodyHash = await sha256(enc.encode(jcs(entry.body)));
  return fields.lineage(tag, entry.n, entry.ts, unb64u(entry.prev_hash), bodyHash);
}

// signers: [{ ring, sign }] where sign(context, payloadB64) -> b64u signature.
export async function makeEntry({ n, prevHash, ts, type, body }, signers) {
  const entry = { n, prev_hash: prevHash, ts, type, body, sigs: [] };
  for (const s of signers) await addSig(entry, s.ring, s.sign);
  return entry;
}

// Counter-signing appends; it never alters the chained content.
export async function addSig(entry, ring, sign) {
  const field = await lineageField(entry);
  entry.sigs.push({ ring, sig: await sign(CONTEXTS.lineage, b64u(field)) });
  return entry;
}

// Who MUST have signed, per type. Format-only types at pilot (REANCHOR, STOP,
// CONTEST-*, VAULT-*, WEIGHT-REVOKE) require their named actor; their semantics
// arrive at L6/N>=3 (G3: the shapes ship and parse now).
function requiredSigners(entry, genesisRing) {
  const b = entry.body || {};
  switch (entry.type) {
    case 'GENESIS-DECL': return [b.genesis_ring];
    case 'INVITE-MINT': return [genesisRing];
    case 'BIRTH': return [genesisRing, b.ring];
    case 'REANCHOR': return [b.ring];
    default: return [b.issuer];
  }
}

async function verifyEntrySigs(entry, required) {
  let field; try { field = await lineageField(entry); } catch { return 'unknown type'; }
  const have = new Set();
  for (const s of entry.sigs || []) {
    let ok = false;
    try { ok = await verifySig(unb64u(s.ring), CONTEXTS.lineage, field, s.sig); } catch { ok = false; }
    if (!ok) return 'signature by ' + String(s.ring).slice(0, 8) + ' does not verify';
    have.add(s.ring);
  }
  for (const r of required) if (!r || !have.has(r)) return 'missing required signature';
  return null;
}

// Full-replica verification, GENESIS-DECL to head: order, links, signatures,
// required signers, BIRTH bundle signatures, and invite conservation (Z2: budget
// declared at genesis, decremented on spend, only genesis mints — clause ii).
// requireCountersign=false is the kit's pre-handover state only (spec step 4,
// before members counter-sign in step 5); every synced replica verifies strict.
export async function verifyChain(entries, { requireCountersign = true } = {}) {
  const fail = (reason) => ({ ok: false, reason });
  if (!Array.isArray(entries) || !entries.length) return fail('empty replica');
  const g = entries[0];
  if (g.type !== 'GENESIS-DECL' || g.n !== 0 || g.prev_hash !== ZERO_HASH) return fail('entry 0 is not a genesis declaration');
  const genesisRing = g.body && g.body.genesis_ring;
  const declared = g.body && g.body.invite_budget;
  if (!genesisRing || !Number.isInteger(declared) || declared < 0) return fail('genesis declaration malformed');
  const hashes = [];
  const mints = new Map();   // mint_seq -> spent-by-BIRTH yet?
  const births = [];
  const bundles = [];        // {ring, x_pub, epoch} from BIRTH and REANCHOR — the E2E key directory (§4.1)
  let prevHash = ZERO_HASH, lastMintSeq = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.n !== i) return fail('entry ' + i + ' out of order');
    if (e.prev_hash !== prevHash) return fail('entry ' + i + ' breaks the chain link');
    if (i > 0 && e.type === 'GENESIS-DECL') return fail('second genesis declaration');
    let required = requiredSigners(e, genesisRing);
    if (e.type === 'BIRTH' && !requireCountersign) required = [genesisRing];
    const sigErr = await verifyEntrySigs(e, required);
    if (sigErr) return fail('entry ' + i + ': ' + sigErr);
    if (e.type === 'INVITE-MINT') {
      const b = e.body;
      if (b.issuer !== genesisRing) return fail('entry ' + i + ': invite minted by a non-genesis ring (provisional rings hold no spendable capacity)');
      if (b.mint_seq !== lastMintSeq + 1) return fail('entry ' + i + ': mint_seq not sequential');
      if (b.mint_seq > declared) return fail('entry ' + i + ': invite budget exhausted (' + declared + ' declared)');
      lastMintSeq = b.mint_seq;
      mints.set(b.mint_seq, false);
    }
    if (e.type === 'BIRTH') {
      const b = e.body;
      const ref = b.invite_ref;
      if (!ref || ref.issuer_ring !== genesisRing || !mints.has(ref.mint_seq)) return fail('entry ' + i + ': birth spends no minted invite');
      if (mints.get(ref.mint_seq)) return fail('entry ' + i + ': invite already spent');
      mints.set(ref.mint_seq, true);
      let bok = false;
      try { bok = await verifySig(unb64u(b.ring), CONTEXTS.bundle, fields.bundle(b.bundle_epoch, unb64u(b.ring), unb64u(b.x_pub)), b.bundle_sig); } catch { bok = false; }
      if (!bok) return fail('entry ' + i + ': bundle signature does not verify');
      births.push({ ring: b.ring, x_pub: b.x_pub, epoch: b.bundle_epoch, petname_hint: b.petname_hint || '', anchor: b.anchor });
      bundles.push({ ring: b.ring, x_pub: b.x_pub, epoch: b.bundle_epoch });
    }
    // A REANCHOR carrying a new bundle re-pins encryption (clause iv, §4.1): its
    // bundle signature must verify like a BIRTH's, or the chain is invalid.
    if (e.type === 'REANCHOR' && e.body.x_pub) {
      const b = e.body;
      let rok = false;
      try { rok = await verifySig(unb64u(b.ring), CONTEXTS.bundle, fields.bundle(b.bundle_epoch, unb64u(b.ring), unb64u(b.x_pub)), b.bundle_sig); } catch { rok = false; }
      if (!rok) return fail('entry ' + i + ': re-anchor bundle signature does not verify');
      bundles.push({ ring: b.ring, x_pub: b.x_pub, epoch: b.bundle_epoch });
    }
    hashes.push(await chainHash(e));
    prevHash = hashes[i];
  }
  return { ok: true, hashes, head: hashes[hashes.length - 1], genesisRing, births, bundles,
    budget: { declared, spent: lastMintSeq, remaining: declared - lastMintSeq } };
}

// The E2E key lookup (§4.1/§4.8): a verifier encrypts only to the HIGHEST-epoch
// bundle its lineage replica holds for a ring — never a wire-supplied key, and a
// superseded bundle cannot re-pin encryption to a retired static key.
export function bundleFor(bundles, ring) {
  let best = null;
  for (const b of bundles || []) if (b.ring === ring && (!best || b.epoch > best.epoch)) best = b;
  return best;
}

// The sync run (§4.7): the ordered entries from a given head to my head. found=false
// means the head is not in my chain — the peer is ahead of me or divergent; the
// caller sends the full replica and the peer's own descent check judges it.
export function makeRun(entries, hashes, fromHead) {
  const pos = hashes.indexOf(fromHead);
  if (pos < 0) return { found: false, entries: entries.slice() };
  return { found: true, entries: entries.slice(pos + 1) };
}

// Client-side spend guard (clause ii): only genesis mints, and only inside the
// declared budget. Every caller path refuses before an entry is even composed.
export function mayMint(issuerRing, chain) {
  if (!chain || !chain.ok) return { ok: false, reason: 'no verified chain' };
  if (issuerRing !== chain.genesisRing) return { ok: false, reason: 'provisional rings hold no spendable capacity; only genesis mints' };
  if (chain.budget.remaining < 1) return { ok: false, reason: 'invite budget exhausted' };
  return { ok: true };
}

// L6 (§4.6): the stop state DERIVES from the log — no separate blocklist to rot.
// A STOP blocks its target unless a LATER CONTEST-CLOSE clears it, and un-stop
// while provisional is an in-person act: the close must be CROSS-SIGNED by every
// ceremony member (both humans at N=2), not just its named issuer. Entries are
// walked in chain order, so a still-later STOP re-blocks a cleared target.
export function stoppedRings(entries, memberRings) {
  const blocked = new Map(); // target ring -> ts of the governing STOP
  for (const e of entries || []) {
    if (e.type === 'STOP') {
      const t = e.body.target_ring;
      blocked.set(t, Math.max(blocked.get(t) || 0, e.ts));
    } else if (e.type === 'CONTEST-CLOSE') {
      const t = e.body.target_ring;
      const signers = new Set((e.sigs || []).map((s) => s.ring));
      const crossSigned = memberRings.length > 0 && memberRings.every((r) => signers.has(r));
      if (crossSigned && blocked.has(t) && e.ts >= blocked.get(t)) blocked.delete(t);
    }
  }
  return new Set(blocked.keys());
}

// The replay guard's other half: a stop-order whose ts does not post-date the
// latest cross-signed CONTEST-CLOSE for its target is a replayed stale stop and
// must not re-block an already-cleared victim (§4.6).
export function latestContestCloseTs(entries, targetRing, memberRings) {
  let ts = 0;
  for (const e of entries || []) {
    if (e.type !== 'CONTEST-CLOSE' || e.body.target_ring !== targetRing) continue;
    const signers = new Set((e.sigs || []).map((s) => s.ring));
    if (memberRings.length > 0 && memberRings.every((r) => signers.has(r))) ts = Math.max(ts, e.ts);
  }
  return ts;
}
