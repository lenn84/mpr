# Contributing

One rule governs everything here: **honesty over polish.** Every claim this project
makes carries evidence you can re-run. A contribution that makes a claim stronger
than its evidence is not an improvement, even if the feature works. A finding that a
claim is *weaker* than stated is one of the most valuable things you can send.

## 1. Test it — three levels

**The battery (start here, no devices).**
```
node verify.mjs            # everything: expect 202/202
node verify.mjs l6         # one layer (o0, ws2, l5, l6, l7, l8)
node verify.mjs --save     # writes the run as evidence JSON under raw/
node verify.mjs --pre-g4   # the pre-flight before a live drive (spawns the real relay)
```
It drives the real runtime cells over an in-process relay: two fully isolated members
run the actual ceremony, sync their lineage, seal every message, fire stop-orders, and
survive relay outages. The 20-scenario adversarial benchmark and the
contract-conformance checks (descriptor validation, fault-vocabulary sweep, the
executable blindness scan) run every time. **If it's red on your machine, that is a
finding — report it with the `--save` JSON and your Node version.**

**The LAN demo (two devices).** Follow `quickstart.html` (interactive) or
`QUICKSTART.md`. The troubleshooting table there grew from real drives; if you hit
friction it doesn't cover, that's a contribution too.

**The run book (actively testing the claims).** `phases/M7-G4-driven-pilot.md` is a
pre-declared set of nine drills with the expected outcome of each written *before*
running. Drive them on your own devices and record what you see. The discipline:

- A **deviation** (what you saw ≠ what was pre-declared) is *data*, not failure. Write
  it down with what you think caused it.
- An **unexplained** deviation is the only failure. Run it down before reporting if
  you can; if you can't, say so — that's still useful.
- Never edit an expected outcome to match what happened. Record the gap.

**The storage probe.** `census/storage-probe.html` tests whether your browser persists
the key types the identity cell relies on (plain records, AES, Ed25519, X25519), with
per-transaction commit watching. We found a real WebKit defect this way — Safari 26.2
on iOS reports COMMITTED and then silently drops records containing an X25519 key.
Every browser/OS combination not yet in `raw/` is worth a run.

## 2. Report findings

Open an issue with:

- **Environment**: browser + version, OS + version, Node version (for the battery).
- **What you expected** — quote the pre-declared outcome (run book row, or the check
  name from the battery).
- **What you saw** — the exact status line / fault text / probe rows. Screenshots are
  fine; the app's **save-log** button and `verify.mjs --save` produce JSON that's
  better.
- **Your read on why**, if you have one. "I don't know" is an acceptable answer.

Please don't paste your LAN IPs, ports, or anything from your own ceremony (keys,
lineage, roster) — the project never records addresses, and your keys are yours.

## 3. What contribution is welcome

**Substrate evidence** (highest value, lowest barrier)
- Battery + storage-probe runs on browsers/OSes we lack — Android Chrome/Firefox,
  desktop Safari, older iOS, Linux WebKit, anything embedded.
- Reproductions (or non-reproductions) of the Safari X25519 finding on other versions.

**The honest NOs** (design first, then code)
- Forward secrecy against recipient-static-key compromise: a ratchet design that fits
  the per-message ephemeral scheme, with its own claims table.
- KCI resistance.

**Beyond two people** — the thesis meets its real trial at N≥3
- Multi-peer transport (a peer map instead of one peer), multi-pair relay routing
  (today one relay instance serves exactly one pair).
- A design brief on stop authority: who may stop whom when there are three.
- The invite economy the conserved-invite lineage already formats: vouching, weight,
  subtree revocation.

**The hardware anchor**
- A FIDO/WebAuthn custody path for the ring key, closing the copyable-key gap the
  claims table declares. This is the single most important open item.

**New transport carriers**
- The transport is *one cell with pluggable resolutions* (`relay` and `local` ship).
  A WebRTC or other carrier as a third resolution is welcome — the existing witness
  scene (`verify/scenes-ws2b.mjs`) must prove its surface identical to the others.

**Docs and quickstart**
- Every real setup friction you hit, added to the troubleshooting table with its cause.

## 4. What is out of scope

- **Turning it into a hosted, multi-tenant service.** The thesis is no server that
  knows who you are; a central identity provider is the thing being refused.
- **Adding dependencies.** The runtime and the relay are zero-dependency by rule
  (Node built-ins and Web APIs only). No package.json is a feature.
- **Stronger claims than evidence.** A change to the claims table or README must
  arrive with the verification that earns it.
- **Anything that records addresses, ports, or key material** in the repository.

## 5. Submitting changes

- Keep `node verify.mjs` green. New behavior should come with a new check in the
  battery, not just a description of one.
- Code conventions the battery enforces: applications speak only verbs and handles
  (the blindness scan will reject `Date`, `fetch`, `crypto`, storage globals in
  `runtime/app/`); a descriptor's declared `faults` and `mailbox` are binding promises
  (the conformance sweep checks them); nothing is dropped silently — loss surfaces as
  a fault; every signed concatenation uses fixed-width fields.
- Substrate findings: attach the evidence JSON. Design proposals: open a discussion
  before code — the honest-NOs and the N≥3 questions are design questions first.
- Small, explained commits over large silent ones. Say what changed and what the
  battery said.
