# MPR — a two-person private chat where identity is a key you birth, not an account you sign up for

## The problem

Every private-messaging app you can name roots your identity in something a provider
owns: a phone number, an email, an account row. Even the end-to-end-encrypted ones.
That root is the thing that gets SIM-swapped, subpoenaed, recycled to a stranger, or
simply switched off when the company changes its mind. "Private" conversations sit on
top of a public identity plane you never controlled.

MPR asks a narrower, harder question: **can two people hold a private conversation
where their identity is a cryptographic key they create themselves — in a short
in-person ceremony, with no account, no provider, and no server that ever learns who
they are?** And can that whole thing run on nothing but what a browser already
executes, so there is no app to install and no platform to trust?

This repository is the working answer. It is a research proof-of-concept: honest about
its limits, verified by a battery you can run yourself, not a product.

## What it is

- **A small runtime built from browser capabilities** — a kernel with five verbs and
  three roots, and a handful of self-minting managers (identity, storage, transport,
  scheduler, executor) over what the browser already provides. Applications running
  inside it speak only verbs and handles: they contain zero direct browser-API calls,
  and an executable scan enforces that on every test run.
- **An identity plane with no accounts** — an Ed25519/X25519 keypair born in the
  browser's own key custody; a short ceremony that writes a tamper-evident,
  hash-chained birth record for exactly the people in the room; a roster the relay
  admits; signed envelopes; per-message end-to-end sealing; a stop-order that is a real
  kill-switch; freshness decay.
- **A dumb relay** — one small dependency-free Node file that routes sealed blobs
  between rostered keys. It holds no identity, logs no content, and cannot tell you
  who anyone is. TLS is the floor because browsers switch crypto off on plain HTTP.
- **The chat itself** — two devices, one Wi-Fi, text and photos, names rendered from
  the petnames *you* sealed at the ceremony, never from what the wire claims.

## Try it in your own environment

Three levels, from zero setup to a full live drive:

**1. Run the battery (one minute, no devices, no dependencies).**
```
node verify.mjs
```
Expect **202/202 pass**. This drives the *real* code headlessly: the hash-chained
lineage, signed envelopes, per-message sealing, replay windows, stop-orders, freshness
decay, the 20-scenario adversarial benchmark, and the contract-conformance checks.
`node verify.mjs l6` runs one layer; `--save` writes the evidence as JSON. If this is
red on your machine, that is a finding — please report it (see CONTRIBUTING).

**2. Run the chat on your LAN (two devices, ~20 minutes).**
Open [quickstart.html](quickstart.html) from disk — an interactive checklist that fills
in every command once you type your LAN IP — or read [QUICKSTART.md](QUICKSTART.md).
You'll mint a TLS certificate for your LAN IP, run the birth ceremony on both devices,
start the relay with the roster it wrote, and talk.

**3. Actively test the security claims (the run book).**
[phases/M7-G4-driven-pilot.md](phases/M7-G4-driven-pilot.md) is a pre-declared drive
of nine drills — cold start, the stranger, a 30-minute steady state with a network
audit, a privacy crawl, killing the relay mid-conversation, the stop-order, the
un-dismissable banner, total device loss — each with its expected outcome written
*before* you run it. Record what you actually see. A deviation is data; only an
unexplained one is a failure.

We also ship a storage-persistence probe (`census/storage-probe.html`) because that is
how we found a real browser-engine bug: Safari 26.2 on iOS silently discards any
IndexedDB record containing an X25519 key while reporting the commit succeeded. If
your browser or OS combination isn't in our evidence yet, running the probe and the
battery there is one of the most useful things you can do.

## What it does — and does not — do

The chat carries this table verbatim in its UI. It is the honest scope, not a pitch.

| Property | |
|---|---|
| Confidentiality against other devices on your LAN and any non-participant relay | **YES** |
| Sender-key compromise does not expose past *sent* messages (no static decryption key on the sender; the per-message ephemeral is destroyed) | **YES** |
| Identity is a device-held key with a hash-chained, invite-conserving birth record, revocable by a signed stop-order, with freshness decay | **YES** |
| KCI resistance, full double-ratchet, Signal-grade E2E | **NO — future work** |
| Forward secrecy against compromise of a recipient's *static* key | **NO** — a compromised recipient static key decrypts past traffic to it |
| Resistance to a **copied software key** | **NO, and declared.** A profile-copy authenticates and the system detects nothing. This is the deliberate, priced limit of a software-only key; a hardware (FIDO/WebAuthn) key closes it and is the named next step. |

That last row is the point, not a bug: the project measures its own weakest link and
publishes it. At two people, the stop-order is the entire revocation story, and it is
permanent short of an in-person, cross-signed reversal.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version — the most valuable
contributions are the ones that keep the claims honest:

- **Substrate findings**: run the battery and the storage probe on browsers/OSes we
  haven't, and report the JSON.
- **The honest NOs**: forward-secrecy / double-ratchet design, KCI resistance.
- **Beyond two people**: multi-peer transport, multi-pair relay routing, and the
  open question of who may stop whom at N≥3.
- **The hardware anchor**: a FIDO/WebAuthn key custody to close the copyable-key gap.
- **New carriers**: the transport is one cell with pluggable resolutions (relay,
  local BroadcastChannel today) — a WebRTC carrier, proven identical by the existing
  witness scene, would be welcome.

## A note on citations in the code

Comments cite `authid R7 §x.y`. That is the identity-plane design specification this
code implements — a separate document, not included here. The citations are section
pointers so the design rationale behind each construction stays traceable.

## Layout

| Path | |
|---|---|
| `runtime/kernel/` | the kernel: five verbs, three roots |
| `runtime/managers/` | identity, storage, transport (relay + local resolutions), scheduler, executor, spore |
| `runtime/lib/` | wire crypto, signed envelopes, the lineage log, E2E sealing |
| `runtime/app/` | the chat (`chat.html`/`chat.js`) and the ceremony (`ceremony.html`) |
| `census/` | the relay + TLS tooling (`serve.js`, `make-cert.sh`), the offline ceremony kit, capability/storage probes |
| `verify.mjs`, `verify/` | the headless battery |
| `CELL.md`, `ROSETTA.md` | the interface contract and its term reference |
| `phases/` | the method docs for the milestones that shipped |
| `raw/` | preserved evidence: capability census probes and headless drive logs |

License — see `LICENSE`.
