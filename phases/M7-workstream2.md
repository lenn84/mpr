# M7 — Workstream 2: the Addendum-2 conformance debts (A2.1–A2.5)

Status: OPEN | Created 2026-09-06 | The audit table below records the runtime AS FOUND before any fix in this workstream landed; fixes are dated beneath it, never blended into it.

Addendum 2 (CELL.md, ratified D22) recorded that the shipped realization under-conforms to the locked contract in named ways, priced to M7. L0–L8 discharged much of it en passant; this workstream audits every clause MUST against the runtime as it stands (post-L8, post-custody-v2), fixes what is small, builds what is real, and locks every discharged clause into `verify.mjs` as a permanent conformance check so "discharged" is a regression test, not a claim.

## The audit — as found, 2026-09-06

Classification: **DISCHARGED** (met, with the layer that met it) · **FIX NOW** (small, this pass) · **BUILD** (real construction, scheduled) · **RECORDED** (accepted debt, disposition written).

### A2.1 — pre-registration + unclaimed-envelope buffering

| Obligation | As found | Class |
|---|---|---|
| Consumer MUST register its correlation before transmitting | chat.js `ask()` registers via `expect()` before transmit; g1.js same pattern (with the A1.2 comment); transport's identity/storage binds register before transmit (commented "A2.1"); the verify harness drivers do the same | **DISCHARGED** (M5→L8 practice) |
| Unclaimed correlated return-path envelopes MUST be buffered until claimed | Buffered — but CONSUMER-side (chat.js/g1.js `inbox` maps), not kernel-side. Nothing observable drops; the obligation's letter names the kernel/realization, its intent (no lost race) is met by the consumer-library pattern every app copies | **RECORDED** — location note: kernel-side buffering would centralize what is today a per-app idiom; carried as a design item, not a violation |

### A2.2 — descriptor claims binding on the realization

| Obligation | As found | Class |
|---|---|---|
| Kernel SHOULD validate `mailbox` presence and shape | `validateDescriptor` checks presence (required list) but never inspects `mailbox.bound` or `mailbox.drop` against the schema's drop enum — the exact hole cluster H recorded | **FIX NOW** |
| Realization MUST NOT emit fault codes outside declared `faults` | **NEW FINDING (not in the M6 list): executor emits `overflow`** (`mailbox bound` refusal) **while declaring only `[refused, bad-envelope, cancelled]`**. All other cells emit within their declarations (transport-pair's L2-era vocabulary fix holds: dead/refused/overflow/bad-envelope all declared and used; storage declares `not-found` and never emits it — a declared-superset, permitted) | **FIX NOW** (declare `overflow` on the executor) |
| Actual mailbox bound + drop policy MUST be what the descriptor states | transport-pair declares `{bound:256, drop:'oldest'}`; the actual outbox is **bound 64, loud-overflow reject** (`OUTBOX_BOUND`), pending buffer likewise 64 — the M6 debt, still live. Scheduler (128/reject) and executor (32/reject) ENFORCE their bounds truthfully. Identity (16), registry (64), loopback-transport (256): no queue exists, bound vacuously unreachable. Storage (64) and clock root (256): genuinely unbounded in practice (storage serializes an unbounded chain; clock holds unbounded timers) | **FIX NOW** (transport-pair descriptor → the truth: `{bound:64, drop:'reject'}`) + **RECORDED** (storage-chain/clock-timer bound enforcement is a kernel-mailbox build item, priced with A2.4's build pass) |

### A2.3 — delivery honesty

| Obligation | As found | Class |
|---|---|---|
| No acceptance/delivery signal for a dropped message | Client side: sends ack `accepted`/`queued`, overflow faults loudly; L8 closed the two silent-drop races. Server side: **the relay queue still drops OLDEST silently at HTTP 200** when a disconnected peer's buffer overflows (`RELAY_QUEUE_BOUND` shift) | **FIX NOW** (relay counts drops per session and announces them in a notice frame when the stream reopens; the transport surfaces that as a loud `overflow` fault). Backstop argument, recorded: since L4 every envelope carries a per-(sender,device) counter, so ANY server-side loss is announced at the receiver as a gap fault — the loudness is end-to-end even where the relay is lossy |
| Three outcomes distinguished: buffered / delivered / discarded | Transport vocabulary: `accepted` (handed to the relay), `queued` (buffered client-side durably for the link), `overflow` fault (discarded, loud). The word "delivered" is not claimed by the transport — but **chat.js's rebound status says "N queued message(s) delivered"**, which claims exactly what A2.3 forbids claiming (the relay accepted them; no peer receipt is known) | **FIX NOW** (wording → "handed to the relay") |
| Per-handle FIFO is an obligation on the realization | The outbox is FIFO and the flush is single-flight (L8), BUT **two concurrent sends that both find the outbox EMPTY still post in parallel** — wire order is arrival order, the M6 "concurrent empty-outbox sends reorder" debt, narrowed but alive. (The receiver's window tolerates reorder and the ctr carries true order, but the renderer paints arrival order.) | **FIX NOW** (route every send THROUGH the outbox: push, then drain — the single-flight drain makes send order the wire order; ack derives from whether the item left the queue) |
| At-least-once resend MUST NOT duplicate | Replay window keys (sender, device, ctr): a re-sent envelope is dropped as a replay at the receiver | **DISCHARGED** (L4) |

### A2.4 — the two-resolution witness (G2b)

Still open, unchanged: loopback (`channel:duplex`) and relay (`channel:paired`) are different cells; "indistinguishable across resolutions" remains asserted, not demonstrated. **BUILD** (pass B of this workstream): a second resolution of the paired-channel cell — an in-process **local-pair** whose semantic surface (message vocabulary, correlation behavior, ordering, fault set) matches the relay resolution exactly — plus a harness scene that drives BOTH resolutions through one identical script and diffs the surfaces. Side value: a relay-free demo mode for the packaging goal.

### A2.5 — time as a resource; blindness executable

| Obligation | As found | Class |
|---|---|---|
| Clock root gains a `now` op; apps MUST NOT read substrate time | Clock root still speaks only `after`. chat.js reaches `Date.now()` in two places (the wire `at` stamp; the presence-liveness compare) — the known leak, still open. g1.js clean. (Managers legitimately touch substrate time; blindness is an APP law) | **FIX NOW** (add `now` to the clock root; migrate chat.js) |
| Blindness check becomes an executable, committed script incl. ambient-authority globals | No such script exists; the M4 grep was prose and famously omitted `Date` | **FIX NOW** (a `ws2` conformance group in verify.mjs: forbidden-token scan of the app modules — `Date`, `crypto`, `fetch`, `performance`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator`, `window`, `document`, `self`, `structuredClone`, `WebSocket`, `XMLHttpRequest`, `process` — pure intrinsics like `Math`/`JSON`/`Promise` stay permitted; the criterion is capability reach) |

### A2.6 — for completeness (no work here)

The M6 list is discharged by the sub-ladder: passphrase deleted + roster ACL (L2), header-only bearer (L3), signed envelopes + (sender,device,ctr) history + gap-loud window (L4), unpair op (L2 relay DELETE), TLS floor (L0), E2E (L7), peer authentication via ceremony-rostered rings (L1–L5). The A2.6 "not zero-touch auth seam" correction stands as written; the seam's swap is workstream 3's concern.

## Conformance checks locked into the runner (this workstream's product)

`verify/ws2.mjs`, a `ws2` group in the ladder: (1) the tightened `validateDescriptor` rejects a malformed mailbox; (2) every shipped descriptor passes it; (3) a static fault-vocabulary sweep — every `makeFault('code')` literal in each manager source must appear in that manager's declared `faults`; (4) the executable blindness scan over `runtime/app/chat.js` + `g1.js`; (5) clock `now` unit. The full battery (which drives FIFO, delivery, and the sealed scenes) re-runs green over every fix before it lands.

## FIX PASS A — landed 2026-09-06 (every FIX NOW row above discharged)

- **A2.2 kernel**: `validateDescriptor` now validates `mailbox.bound` (positive integer) and `mailbox.drop` (schema enum) — the cluster-H hole closed at the kernel.
- **A2.2 executor**: `overflow` added to the declared faults — the audit's new finding, discharged by declaration truth (the emission was always correct behavior; the promise now matches it).
- **A2.2 transport-pair**: descriptor mailbox corrected to the truth, `{bound: 64, drop: 'reject'}` — the M6 256/oldest debt closed by honesty, not by growing the queue.
- **A2.3 FIFO**: every send now routes THROUGH the outbox and a SHARED single-flight drain (concurrent callers await the same in-flight promise and learn their item's true fate; the drain's while-condition absorbs mid-drain pushes in order; a success-path re-kick covers the push-after-exit strand window). The concurrent-empty-outbox reorder debt is closed: send order IS wire order per handle. **Bug caught by the battery during this fix, disposition (a):** the first cut re-kicked the drain on FAILURE too — a microtask-speed retry loop while the link was down that starved the event loop (the l6 relay-down scene hung the battery). Re-kick is success-path-only; failure paths schedule the 800ms rebind, as before.
- **A2.3 relay queue**: the server counts frames dropped from a session's offline queue (bound overflow) and ANNOUNCES the count in a `relay_notice` frame when that stream reopens; the transport surfaces it as a loud `overflow` fault. Content never logged; only the count crosses. End-to-end backstop recorded: the L4 ctr-gap alarm already announces the same loss at the receiver.
- **A2.3 wording**: chat's rebound status now says "handed to the relay" — delivery is not claimed where only relay acceptance is known.
- **A2.5 clock**: the root gains the `now` op (`{op:'now'} → {op:'time', body:{ms}}`); chat.js's two `Date.now()` sites (wire `at` stamp, presence-liveness compare) migrated to verb-mediated time — the app modules now carry ZERO ambient-authority tokens, and the executable blindness scan enforces it on every battery run.

**Verification: full battery 184/184 (165 prior + 19 ws2 conformance checks), three consecutive runs.**

## FIX PASS B — landed 2026-09-06 (A2.4 / G2b witness built)

The transport-pair cell now ships **two resolutions of ONE cell**: `relay` (HTTP+SSE, the default, unchanged) and **`local`** — the SAME realization over a `BroadcastChannel` carrier (same-origin browser tabs; same process headless). One code path, two carriers, so the semantic surface is identical *by construction*, not by parallel maintenance. Only `post`/`hello`/`openStream`/`close` branch on the carrier; sign/verify/window/seal/lineage/stop are shared below the split, and attribution stays anchored in the signed envelope (the local `from` stamp is self-asserted and `verifyEnvelope` still requires the signed sender to match it). Its cost is `high` = **preference**, not compute: `resolve()` keeps the relay as default, and `local` is chosen only by an explicit plan. Bonus per the audit: `local` is a **relay-free demo/offline mode** for the packaging track.

`verify/scenes-ws2b.mjs` — the witness: one identical script (join, join, A→m1, B→m2, A→m3, one bad op) driven over BOTH resolutions with real members, tracing every app-visible emission and DIFFING the surfaces. The witness isolates the channel surface (pre-ceremony plaintext, no lineage seed) so it measures `channel:paired`'s own contract, not the sync/seal layer riding above it — which is where the first cut's spurious diff came from (a relay-only `message gap` notice injected by lineage-sync sharing the counter space; removed by dropping the seed, the honest scope). Result: **op vocabulary, joined surface, message order, and fault surface all measured IDENTICAL across `relay` and `local`.** G2b moves from "asserted, not demonstrated" to demonstrated — CARRIED AS TARGET → **MET** for the two-resolution witness (the peer-channel E2 the addendum named is realized as `local`).

**Verification: full battery 202/202 (184 + 18 ws2-witness), three consecutive runs.**

Remaining in this workstream (both RECORDED, not blocking): kernel-side unclaimed-envelope buffering (A2.1 location note — today satisfied by the per-app consumer idiom); storage-chain / clock-timer mailbox-bound enforcement (a kernel-mailbox build item). Neither is a live under-conformance; both are carried as design items.
