# QUICKSTART — run the two-person chat on your own network

Status: living | Created 2026-09-05
The stranger-facing walk-through. Two devices, one Wi-Fi, one laptop as the relay
host — a private, end-to-end-encrypted two-person chat where identity is a key
born in a small ceremony, not an account. This same document is the operator's
drive-day script for the G4 pilot (the run book proper is
`phases/M7-G4-driven-pilot.md`).

**Prefer it interactive:** open `quickstart.html` in a browser (straight from disk,
no server needed) — the same steps as a live checklist with fill-in commands,
per-drill note fields, and an export of the drill notes at the end. Your LAN IP,
port, and ticks live only in that browser's localStorage, never in repo files.

## What you need

- A laptop with Node.js ≥ 20 (`node --version`) and `openssl` — this machine hosts the relay.
- A second device (phone or laptop) on the **same Wi-Fi**.
- **VPNs and tailnets OFF on both devices** for the session — the population is one LAN.
- Your laptop's LAN IP (`ip a` / your Wi-Fi settings). Called `<LAN-IP>` below. Ports are yours to pick; they are never written into repo files.

## 0) Prove the stack before trusting it

```
node verify.mjs
```

Expect **165/165 pass**. This drives the real crypto and transport — the lineage
chain, the sealed envelopes, the stop-orders, the 20-scenario benchmark — headlessly.
If anything fails, stop; the demo would be demonstrating a broken claim.

## 1) Mint the TLS material (once, or whenever your LAN IP changes)

```
sh census/make-cert.sh <LAN-IP>
```

Writes a local CA + host cert (90-day validity) with `<LAN-IP>` as the IP SAN into
`runtime/tls/` (gitignored; the private keys never leave this machine — the server
refuses to serve them, and that fence is part of the verified battery).

## 2) Start the server — ceremony phase (no roster yet)

```
node census/serve.js <port>
```

Then trust the CA on the second device: browse to `https://<LAN-IP>:<port>/ca.pem`
(one trust warning here is expected — the CA is not installed yet), install the
downloaded profile, and on iOS also enable full trust: Settings → General → About →
Certificate Trust Settings.

The **laptop's browser needs the CA too** — browsers don't read `runtime/tls/`.
Firefox: Settings → Privacy & Security → Certificates → View Certificates →
Authorities → delete any old "MPR pilot CA" → Import… `runtime/tls/ca.pem` →
tick "Trust this CA to identify websites". Chromium-family: Settings →
Certificates → Authorities → Import, same file, same tick. Re-do on both devices
whenever `make-cert.sh` is re-run — every run mints a new CA.

After that, **both** devices must load
`https://<LAN-IP>:<port>/runtime/app/ceremony.html` with **zero certificate
warnings** — that is the floor; do not proceed past a warning.

At this stage the relay refuses everyone (no roster exists) — that is correct.
Only the pages serve.

## 3) The birth ceremony (throwaway keys for a demo)

Keep all ceremony artifacts in a scratch directory **outside** this repo, e.g.
`~/ceremony-scratch/`. Use a normal browser window on each device — **not private
browsing** — and the same browser later for the chat (the keys live in that
browser's storage).

1. **Each device**, on `ceremony.html`: enter your name, **Step 1 — mint**. Copy the
   QR block (it is public material: a public key, an encryption public key, a
   signature) off the device to the laptop, one file per member:
   `~/ceremony-scratch/qr-a.json`, `qr-b.json`.
2. **On the laptop** (the offline-kit stand-in; at a real ceremony this machine has
   networking down):
   ```
   node census/ceremony.mjs genesis ~/ceremony-scratch/g.json
   node census/ceremony.mjs compose ~/ceremony-scratch/g.json ~/ceremony-scratch ~/ceremony-scratch/qr-a.json ~/ceremony-scratch/qr-b.json
   node census/ceremony.mjs wipe ~/ceremony-scratch/g.json
   ```
   This writes `lineage.json` (the birth record) and `roster.txt` (who the relay
   admits), then destroys the genesis key — at a real ceremony it goes to paper
   first; for a demo the wipe is the point.
3. **Each device**, Step 2: paste `lineage.json`, **Verify and counter-sign**
   (verification happens before anything is appended). Step 3: carry each device's
   counter-signature block to the *other* device and **Merge and verify strict**.
   Step 4: **Seal** with your petname for the other member.

## 4) Restart the server — chat phase (the roster goes live)

Stop `serve.js` (Ctrl-C), then:

```
CELL_ROSTER=~/ceremony-scratch/roster.txt node census/serve.js <port>
```

The console must say `roster loaded: 2 ring(s)`. **This restart is mandatory** —
the roster is read at boot. A relay running without the roster refuses every join;
a relay restarted without it mid-session strands both chats in a silent retry loop
(sends report "link is down, message queued for delivery" forever).

## 5) Chat

Both devices open `https://<LAN-IP>:<port>/runtime/app/chat.html`, enter a name,
join. Text and photos flow both ways, rendered by the petnames you sealed — not by
whatever name the wire claims. Things worth trying, because they are the point:

- **Kill the relay mid-conversation** (Ctrl-C), keep typing — sends queue loudly.
  Restart it (with the roster!) — both sides silently re-bind and the queue flushes
  in order.
- **Open DevTools → Network** — every `/relay/send` payload is a sealed blob; no
  message text crosses the wire.
- **Try a third browser / private window** — a stranger's join is refused with one
  opaque error; a device without the CA gets a TLS error. Both are the fence
  working, not bugs.
- **The stop button** — cuts a peer's key off deliberately, with a blocking banner
  on the stopped side that has no dismiss control at all.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Phone: "can't connect to the server" (before any cert talk) | The laptop firewall is dropping the port (firewalld is on by default on openSUSE; a non-`--permanent` opening vanishes on reboot), or the LAN IP changed | On the laptop: `sudo firewall-cmd --add-port=<port>/tcp` (runtime-only on purpose — it closes itself on reboot). Confirm the IP with `ip -4 addr` |
| Phone: trust error even though a CA profile is installed | `make-cert.sh` was re-run since that profile was installed — every run mints a **new** CA | Delete the old MPR profile (Settings → General → VPN & Device Management), reinstall from `/ca.pem`, re-enable full trust |
| "link is down, message queued for delivery", forever | Relay not running at that origin, or it was restarted **without** the roster, so every re-hello is refused (opaque by design) and the transport retries silently | Restart: `CELL_ROSTER=... node census/serve.js <port>`; confirm `roster loaded: 2 ring(s)` in the console |
| "not admitted" at join | Your ring is not in the loaded roster: roster from a different ceremony run, phase-2 restart skipped, or **the QR came from a different browser on that device** (each browser holds its own ring) | Mint again on ceremony.html in the refused browser and compare the ring's first characters to `roster.txt`. If it differs: re-run compose with **this** browser's QR block, redo Steps 2–4 on both devices, restart the relay with the fresh `roster.txt` |
| Certificate warning on the second device | CA profile not installed / full trust not enabled / cert minted for a different IP | Redo step 2; if your LAN IP changed, redo step 1 first |
| Identity cell refuses to bind / mint | Page loaded over plain HTTP (crypto is switched off there, by law of the substrate) | Use the `https://` origin with the trusted CA |
| Ceremony verified but chat shows wire names, not petnames | Chat opened in a different browser/profile than the ceremony was sealed in | Use the same browser on each device for ceremony and chat |
| Phone mints a DIFFERENT ring after every reload | (a) The page was opened from a link inside a messenger — in-app browsers have throwaway storage; (b) historic: Safari 26.2/iOS silently dropped IndexedDB records containing X25519 keys (commit reports OK, row gone next session) — found at the G4 drive, fixed by custody v2 in `identity.js` | Always use the real browser app with a typed URL/bookmark. To diagnose the storage layer on any device, open `census/storage-probe.html`, reload, and read the survival rows |
| Peer stays "alone" | The other side hasn't joined chat yet (ceremony half-done on that device) | Finish Steps 2–4 on both devices, then both join |

## What this demonstrates — and honestly does not

The security-notes panel in the chat states the claims verbatim. In short: sealed
end-to-end against other LAN devices and the relay host as carrier — YES; the
identity is a device-held key with a hash-chained, invite-conserving birth record,
stop-orders, and freshness decay — YES, all regression-verified by `node verify.mjs`.
Signal-grade forward secrecy / double-ratchet — NO, stated in the UI. A copied
software key authenticates — the declared substrate limit that prices the next
hardware step.

## For the operator (G4)

`node verify.mjs --pre-g4` is the pre-flight (TLS fence + every headless-certified
scene). Green there → drive `phases/M7-G4-driven-pilot.md`, recording per drill.
