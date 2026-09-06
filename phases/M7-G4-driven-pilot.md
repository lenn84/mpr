# M7 — G4: The Driven Pilot Run (the road test)

Status: PRE-DECLARED, awaiting the operator's drive | Created 2026-08-27 | Ratifies as G4 by being run and recorded
Depends on: the complete headless sub-ladder L0–L8 (benchmark 21/21 ×3, commit 167785c). This document is written and committed BEFORE the run (RES-EVID-5): the expectations below cannot be retrofitted.

## What this is

The live half of graduation. L8 executed the twenty-scenario suite headlessly; the binding status rule says the spec stays CARRIED AS TARGET until a real, driven MPR pilot run is recorded in the register style. This run book is that drive: the operator, two real devices, one LAN, the benchmarked stack — results recorded the way the attacks were, a written disposition for every deviation. Passing does not require perfection; it requires HONESTY (the T-row lesson: recording the gap is the pass).

## Setup (once, before the drive)

0. Environment: both devices on the same Wi-Fi/LAN; **VPNs and tailnets DOWN on both for the duration** (`tailscale down` / toggle off). The declared population is one LAN — a live tailnet widens the reachable room beyond the declaration, and the cert's IP SAN names only the LAN IP. Use the LAN IP everywhere, never a 100.x address or a MagicDNS name. (Environmental deviations get written dispositions like any other.)
1. TLS material: `sh census/make-cert.sh <laptop-LAN-IP>` (IP SAN, L0). CA on the phone: visit `https://<laptop-LAN-IP>:<port>/ca.pem` (one-time trust warning is expected — the CA is not installed yet), install the downloaded profile, then enable full trust (iOS: Settings → General → About → Certificate Trust Settings). The `/ca.pem` route serves the PUBLIC cert only; `runtime/tls/` key material is 403 across the wire (fence added and behaviorally verified in prep, 2026-08-27 — the walk-through caught the private key being servable under `runtime/`). This step doubles as ceremony step 7.
2. Ceremony artifacts (QR blocks, lineage.json, roster.txt, the genesis key file until its wipe) live in a scratch directory OUTSIDE the repo; nothing from the ceremony is committed. Rehearsal degeneracy, stated: the laptop with networking down stands in for the offline machine.
3. Relay: pick a port at run time (never recorded here). Start AFTER the ceremony writes the roster: `CELL_ROSTER=<scratch>/roster.txt node census/serve.js <port>`.
4. Both devices reach `https://<laptop-LAN-IP>:<port>/runtime/app/ceremony.html` with zero certificate warnings — the L0 floor, re-confirmed live.

## The ceremony rehearsal on real devices (scenario A's first half)

Throwaway keys — the REAL ceremony runs only after G4 graduates the spec. The kit is `census/ceremony.mjs` (offline machine role; at the rehearsal, the laptop with the network down is an acceptable stand-in — noted honestly as a rehearsal degeneracy).

1. Each device: ceremony.html Step 1 — mint, copy the QR block off the device.
2. Kit: `node census/ceremony.mjs genesis g.json`, then `compose g.json <outdir> qr-a.json qr-b.json` → `lineage.json` + `roster.txt`. Then `wipe g.json` (the paper stand-in is the printout; at the rehearsal, destruction).
3. Each device: Step 2 — paste `lineage.json`, verify, counter-sign; carry each device's counter-signature block to the other (Step 3); each seals with its own petname for the peer (Step 4).
4. Install `roster.txt` at the relay and start it. Both devices open chat.html and join.

## The drills (pre-declared expected outcomes)

Record per drill: done/deviation, timestamps where asked, one line of what was seen. Save-log on BOTH devices at the end (payload lands in raw/ as `drive-*-chat-*.json`, phase M7-G4).

| # | Drill | §8 row | Pre-declared expected outcome |
|---|-------|--------|-------------------------------|
| 1 | Cold start: after the ceremony, both devices chat — text both ways, one photo each way | A | Sealed traffic flows; petnames (not wire names) render; photos byte-perfect; no alarms |
| 2 | The stranger: a private-browsing window (new custody → new ring, unrostered) tries to join; a third device WITHOUT the CA tries to load the page | R | Unrostered join: one opaque refusal, no detail. No-CA device: TLS trust error — the fence working, not a bug |
| 3 | Steady state (≥30 min of normal use) | G | DevTools network audit on either device: relay-origin traffic only — zero third-party, zero telecom, nothing centralized on the session path; every /relay/send payload is a sealed blob |
| 4 | Privacy crawl: with DevTools open, write down everything an observer sees | L | Pubkeys, advisory names in hello, kinds, timing, sizes — NO message plaintext, NO phone numbers. The visible metadata list is RECORDED, not waved away |
| 5 | Relay outage: SIGKILL serve.js mid-conversation; keep typing; restart it | I | Sends acknowledge as queued (loudly); on restart both sides silently re-bind and the queue flushes IN ORDER; no bypass credential exists; no silent loss |
| 6 | Stop drill: device B fires "stop peer" (the confirm is the deliberate act); note the fire time; A keeps trying to talk | H (N=2 form) | A's device: BLOCKING banner, no dismiss path in the DOM (drill 7 verifies); B refuses A's envelopes from the stop forward; the fire→refusal window is WRITTEN DOWN (at N=2 it is near-zero — the number is recorded, not assumed; the real gossip window is the N=3 rehearsal's to measure) |
| 7 | Warning fatigue: try to click/tap/scroll past the banner on A | M | No path exists; conversation halted on the stopped side |
| 8 | Total device loss (RUN LAST — it destroys the rehearsal population, which is the point): clear site data on one device, reload, try to rejoin | D | New ring minted; roster refuses with the opaque fault; re-entry only as a stranger — identity death while provisional, EXPECTED and correct |
| 9 | Ledger re-walk: re-read the §7 invariant-gap table against what was just driven | — | No gap exceeds the declared software-anchor maximum (the session/hello row stays THE max, priced by the FIDO stem) |

Rows certified headless and NOT re-driven live (their disposition is the L8 evidence pack, raw/drive-headless-l8-benchmark.json): J (truncation alarm), K (re-anchor rehearsal), T/B (profile-copy trap — requires OS-level profile surgery; the honest-gap recording already stands), and the blocked classes C/E/F/N/O/P/Q/S (telecom / FIDO / N≥3 dependencies, dispositions unchanged).

## Recording discipline

- Every deviation gets a written disposition in this file (append-only, dated) — deviation is data, not failure; an UNEXPLAINED deviation is the failure.
- Both devices' save-log outputs land in raw/; this file's close block names them.
- Close block, when driven: date, device pair, drill outcomes 1–9, deviations + dispositions, and the graduation sentence — whether the register may now move the authid spec from CARRIED AS TARGET toward ADOPTED (with the binding status rule quoted).

## After G4 (the order of releases, all operator words)

1. The REAL genesis ceremony (real keys, paper vault, no rollback — only after graduation).
2. The N=3 rehearsal build phase (transport peer-map, relay routing decision, multi-peer UI, and the stop-authority decision brief — who may stop whom at N≥3).
3. The FIDO stem (~$120) — closes the copyable-key gap, unlocks the invite economy (member-minted invites, vouching, recovery quorums).
4. Workstreams 2 (A2.2–A2.5 conformance debts) and 3 (platform export mechanics).
