# M5 — The Makeup

Status: DONE, CLOSED 2026-08-25 (D21; probes 1..5 MET, G2 MET; known outage-delivery limits carried to M6 as attack surface) | Created 2026-08-25 | Updated 2026-08-25
Depends on: M4 (the running runtime). Feeds: M6 (the adversarial pass attacks what this phase ships). Gate: G2 (POV.md).

## What You Are Building

The finished world of this phase: the chat. Two people open one link on their own devices and talk inside the constructed runtime: messages, presence, typing state, photos (D8, full spectrum). The transport manager gains its second resolution, the relay over the one LAN link, and the durable requirement proves itself by surviving a mid-session relay death (the A1.7 scenario, carried from M4 probe 4). A two-person gate lives in the identity plane, separate from resource addresses (D17), shaped so the platform's customer-auth contract can replace it on export without touching the app. The surface wears the house visual style (D4). The chat application itself passes the same blindness grep as G1: verbs and handles only.

## Inherited Obligations

- M4 probe 4 second half: a realization killed mid-session surfaces a fault-vocabulary envelope and the durable requirement re-binds without the consumer's handle changing.
- Observation 004 question: the boot page ships the fetch-probe plus data-url-canary instrument permanently.
- Storage-manager serialization and normalized faults carry into photo handling (D2 claim: photo blobs round-trip without main-thread stalls; mailbox bounds respected when chunking).

## Decision Needed at Drive Time (not before)

DECIDED 2026-08-25 (D20): the phone is admitted as the second device for the G2 drive while the partner laptop is unavailable. Desktop-class remains the target class of record; the phone is the stand-in, not a retargeting.

## Steps

1. Relay resolution: the census server grows a minimal channel relay on the censused floor (send by POST, receive by server-sent events), two-person scoped, no message persistence beyond delivery.
2. Transport manager v2: second resolution (relay) beside loopback; the plan carries the durable requirement; on realization death the manager re-resolves and re-binds silently, per A1.5.
3. Identity plane: a pairing cell. First device mints the pair with a short passphrase, second device joins with it; both get session identities; the relay refuses unpaired sessions. No passwords, no accounts; the seam where the auth contract docks later is documented in the cell's descriptor.
4. Chat application (verbs and handles only): messages, presence heartbeats, typing signals, photo send (chunked through the channel within mailbox bounds, stored via the storage cell, rendered from local store).
5. House style pass on the chat surface (graph-paper grid, hard borders, house palette, system-boot loader), per D4.
6. Drives: single-machine loopback first, then the two-device LAN drive (G2), then the relay-death drive.

## Verification (pre-declared)

- Probe 1 (blindness): the chat app modules contain zero substrate API tokens, mechanically, same grep as M4.
- Probe 2 (G2, the gate): two devices, one link, live chat: a message each way, presence visible, typing indicator seen, one photo delivered and re-opened from storage on the receiving device. Evidence: drive log from each device saved to raw/.
- Probe 3 (A1.7 live): mid-chat, the relay process is killed and restarted; the transport manager re-binds from the durable requirement; the conversation continues without reload; the consumer handle ref is unchanged; the gap surfaces as fault-vocabulary envelopes, not exceptions. AMENDED 2026-08-25 on operator live feedback: messages sent during the outage are not refused but QUEUED in the manager's bounded outbox (store-and-forward, the sibling stream's next fallback rung) and flushed in order on re-bind; overflow past the bound faults per vocabulary. Verified headlessly: three dark-period messages queued, flushed, delivered in order on unchanged handles.
- Probe 4 (gate): a third session without the pairing passphrase is refused by the relay; refusal uses the fault vocabulary.
- Probe 5 (photo integrity): the received photo's bytes hash-match the sent bytes; chunk count respects the channel descriptor's mailbox bound.

## Done When

All five probes pass, G2 is declared MET in POV.md, and the operator declares M5 closed.

## Rollback

Delete the chat app modules and the relay endpoint; the runtime, kernel, and all prior evidence stand untouched. The transport manager's relay resolution can remain as dead code or be reverted with it.

## Open Questions

- Q2 (photo pipeline): pure in-browser processing for the PoC, or first honest use of the parked compute-plane manager? Default: in-browser; decide when photos land.
- Presence semantics: heartbeat interval versus last-seen derivation; decide in build, record in the descriptor.
