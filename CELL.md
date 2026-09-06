# CELL.md — The Interface Contract (Draft)

Status: CONCLUSION MODE, LOCKED v1 2026-08-25 (D16: five verbs, brief 1A; D17: cell:// scheme, brief 2A; sixth-verb counter-position preserved as branch P-park-4; term reference in ROSETTA.md per operator condition). Amendments only by dated addendum | Created 2026-08-24 | Updated 2026-08-25
Ground: the M2 census intersection (CLAIMS.md A1..E2, design law from B3). Prior art cited, not obeyed (D1): the twelve bridges, the sibling protocol-graph stream, actor mailbox models.

## One Cell

Every resource in this world, native or constructed, is the same shape:

```
DISCOVER what the context grants
    ↓
DESCRIBE what this resource provides, requires, costs, and gates
    ↓
RESOLVE a requirement against described resolutions
    ↓
BIND the chosen resolution into a live handle
    ↓
TRANSMIT messages through the handle
```

A manager built from bound resources DESCRIBES itself and becomes discoverable. That is minting. The ladder has no top: a composed manager is a primitive to whatever stands on it.

## Q3 Proposal: Five Primitives (target was five to seven)

| Primitive | Contract | Census grounding |
|-----------|----------|------------------|
| discover(realm?) | Enumerate descriptors the current context grants. Returns data, never handles | The census page is discover() run by hand; at runtime the kernel performs it at load |
| describe(id) | Return the descriptor: provides, requires, gates, cost, resolutions. Descriptors are pure data and precede execution, always | The egg carries the information; data-first bootstrap transfers from prior art as a law, not a style |
| resolve(requirement) | Intersect a requirement (semantic, never named implementations) with available descriptors; return a ranked resolution | The embryonic capability resolver; the sibling protocol graph docks here unchanged |
| bind(resolution) | Acquire a live handle; capability and context gates are enforced here and only here | B3 law: gates are context properties; bind is where "what does this context grant" gets answered |
| transmit(handle, message) | Move a message through a bound resource; the only verb that touches a live handle | Everything below is a mailbox |

### Everything else is composition, not new verbs

| Apparent verb | Actually |
|---------------|----------|
| execute(job) | transmit a job envelope to an executor resource (worker-backed now, compute-plane later: P-park-2 rides free) |
| read/write storage | transmit to a storage mailbox; a disk is a channel to your future self |
| schedule(task, priority) | transmit to a scheduler manager, which itself resolves and transmits onward to executors |
| register (minting) | transmit a descriptor to the registry resource; the registry is itself a cell instance |
| receive | transmit's return path; every handle is a duplex mailbox |

The reduction is the fractal claim in verb form: if any of these turns out to need a sixth primitive, the adversarial probes must catch it, and the set reopens (probe 1, phases/M3-interface.md).

### Bootstrap (the egg, precisely)

A tiny kernel implements the five primitives natively for root resources only. Everything after is recursion:

```
kernel (five verbs, native, minimal)
  → discover: census of the substrate
  → describe: root descriptors as data
  → resolve or bind: workers, channels, storage floor
  → constructed managers transmit their descriptors to the registry
  → the world above sees only cells
```

## Q1 Proposal: Identity Encodes Identity, Never Location

An address names a described resource, not a place:

```
cell://<realm>/<name>@<ref>
```

- realm: namespace of ownership (system, app, user). Two-person gate identity lives in a separate identity plane that FEEDS realms; it is not a resource address (M5 question, held open).
- name: stable within the realm.
- ref: content hash of the descriptor. Same identity, new descriptor, new ref: history stays append-only.
- No host, no port, no path-on-disk, ever. Where a manifestation lives is resolve()'s answer at that moment, in that context. The logical relationship survives re-resolution (M1's swap-without-rewrite claim, and the sibling stream's migration story).

Prior-art note: shaped like an import-by-identity plane and the object-addressed model, on purpose and by citation; the scheme, its realms, and its gate semantics are MPR's own.

## The Five Instances Over the Census

| Resource | Floor resolution (both devices) | Elevated resolutions | Gate |
|----------|--------------------------------|----------------------|------|
| Execution | Workers plus Wasm job envelopes | Shared-memory worker pool | Elevated: cross-origin isolation (B1, B3) |
| Memory | Transferable message-passing (B2) | SharedArrayBuffer plus Atomics | Same gate as execution's elevated tier |
| Scheduling | MessageChannel cooperative loop; never assumes idle callbacks (C1 facts) | Idle-callback assisted tiers where present | Feature presence, discovered not assumed |
| Storage | IndexedDB virtual disk (D1 floor) | OPFS virtual disk | Secure context (B3) |
| I/O | Relay transport: fetch, WebSocket, server-sent events | Peer channel (E2); HTTPS-on-LAN serving; compute-plane dispatch | Context, policy, and operator signal respectively |

Indistinguishability criterion (binding, from the Fractal Invariant corollary): a consumer holding a handle cannot tell floor from elevated, native from composed. Resolution is the only place difference exists.

## Open Edges (carried into the adversarial pass)

- Priority semantics under pure transmit: does the scheduler's envelope carry priority, or does resolve() rank scheduler tiers? One must win before M4.
- Descriptor schema: minimum fields that make resolve() honest (provides, requires, gates, cost) without inventing an ontology nobody maintains.
- Registry bootstrap: the first registry cannot be registered; the kernel declares it. Blast radius of that exception must stay one line.

---

## ADDENDUM 1 — 2026-08-25 (RATIFIED 2026-08-25, D18; part of the locked contract)

Product of the M3 adversarial pass, three independent refuter seats (closure, indistinguishability, substrate transfer). The five-verb set survived all three attacks: no seat could force a sixth verb. The text above stands unedited per the lock; this addendum amends it. Verdicts in CLAIMS.md cluster G.

### A1.1 The criterion, rescoped (replaces the line-84 wording)

The locked wording ("a consumer holding a handle cannot tell floor from elevated, native from composed") asserted consumer IGNORANCE, and the contract's own verbs falsify it: describe() and resolve() expose the backing as data by design, and B3's law makes every gate world-readable before bind. The binding criterion is BEHAVIORAL, one formulation, two axes split:

> The handle's semantic surface (message vocabulary, ordering and delivery guarantees, and the normalized fault vocabulary) is identical across resolutions, so consumer code never branches on the backing. The criterion binds the native-versus-composed axis fully; on the floor-versus-elevated axis it binds only the submission surface, because elevated tiers exist precisely to behave differently in time. Consumer knowledge of the backing, timing, throughput, load behavior, and availability under partition are out of scope by declaration, not by mitigation: they are unsealable on this substrate.

Priced consequences, accepted consciously: shared memory is manager-internal fabric (it speeds transmit and enables threaded-Wasm executors; no shared view or synchronous semantics ever crosses a handle). The Scheduling instance's criterion binds envelope shape and acknowledgement, never the execution timeline, which is that resource's product.

### A1.2 Transmit semantics, pinned

Per-handle FIFO ordering. Every envelope carries a correlation ref. Acceptance is acknowledged; completion, faults, and progress arrive as return-path envelopes carrying the correlation ref. Mailboxes are bounded; the bound and the drop policy are descriptor fields. Flow control is credit-based (a control envelope grants send-budget). All faults use the normalized fault vocabulary (A1.4); native exception shapes never cross a handle.

### A1.3 Kernel-declared roots: registry, binder, clock

The kernel declares three root cells, same well-foundedness shape as the registry exception: the REGISTRY (descriptors in), the BINDER (handles out; release is transmit {op: release, handle-ref} to it; handle refs are identity-as-data), and the CLOCK (ticks and deadlines as return-path envelopes; the Scheduling instance owns it). Cancellation is a control-plane message to the owning manager, never down the job's own channel (a blocked worker cannot read its mailbox); the manager's private termination of a worker is implementation detail. MessagePort transfer is bind-internal plumbing and never surfaces; "handles are never data" holds at the contract surface.

### A1.4 Descriptor schema minimums

provides and requires use a maintained capability-type vocabulary (typed matching; compatible_with-by-name is rejected as redundant and name-coupled). Descriptors additionally carry: gates, static cost class, mailbox bound and drop policy, the control-op vocabulary the resource honors (cancel, subscribe, release, credit), and the fault vocabulary. Measured runtime cost (latency samples, throughput) is resolver-plane telemetry, explicitly NOT descriptor data; descriptors stay pure and append-only, and the dent to data-first is taken here, once, visibly.

### A1.5 Resolution as plan; the durable requirement

A resolution may be a PLAN: a DAG of sub-resolutions with capability-typed edges (a chain is the linear case). resolve() performs typed composition search with whole-path scoring, not set intersection; the requirement schema carries hard predicates plus weighted soft objectives. bind(plan) is atomic: all nodes bind or the partial bind rolls back. The requirement, with its policy, PERSISTS as a property of the binding. Handles are logical mailboxes whose realization may re-bind; on realization death the fronting manager re-resolves the durable requirement, and gates plus policy are re-enforced at every re-bind. Migration is thereby legal, named, and policy-safe rather than smuggled. Above the kernel, discover, describe, and resolve are themselves transmit against the root cells; the irreducible runtime core is bind plus transmit, which is the fractal claim applied to the verb set itself.

### A1.6 Wording tightened; provenance flagged

discover() returns identities and summaries only; describe() is the sole full-record authority (kills the redundancy). Registration of descriptors ABOUT third parties (a discovery service minting what it found) requires a provenance gate; unauthenticated third-party description is refused. Peer authentication is a first-class concern the cell vocabulary does not yet carry; it is assigned to the M5 identity-plane question, on the record.

### A1.7 Worked chain (the owed example, transport-grade, three nodes)

Requirement: ordered private duplex to the partner session, prefer low latency. Descriptors available: envelope-codec (provides ordered-envelopes, requires byte-stream), websocket-stream (provides byte-stream, requires reachable-host), lan-reach (provides reachable-host, gate: same-subnet), peer-channel (provides byte-stream, requires signaling, gate: ICE succeeds). resolve() returns plan P1: envelope-codec over websocket-stream over lan-reach (scores best on latency); P2 (codec over peer-channel) ranks second. bind(P1) binds leaf-first, atomically. Mid-session the relay host dies: the fronting transport manager holds the durable requirement, re-resolves, gets P2, re-binds; the consumer's handle never changes; policy (private) is re-checked at the new bind. The consumer observed at most a delivery gap and a fault-vocabulary notice; no consumer code branched on the backing. This is M1's swap-without-rewrite, executed by the contract instead of promised by it.

---

## ADDENDUM 2 — 2026-08-25 (RATIFIED 2026-08-26, D22, D18 pattern; part of the locked contract)

Product of the M6 adversarial pass, three independent refuter seats (durability, blindness, gate/identity) turned from the contract onto the shipped M5 realization. Verdicts in CLAIMS.md cluster H. The finding of A1 was that the five verbs *survived*; the finding of A2 is different and worth stating plainly: **the contract held, but the shipped relay realization under-conforms to it in named ways.** That is the good failure — the contract named obligations the PoC realization does not yet meet, so the debts are localized to one resolution and the app never learns of them. This addendum (a) writes the sentence owed since M4, (b) makes descriptor claims binding on realizations, (c) pins delivery honesty, (d) scopes the behavioral criterion's witness, (e) makes time a resource and the blindness check executable, (f) records the identity plane's true PoC status and the M7 hardening inputs. Amendments to the locked text; the text above stands unedited.

### A2.1 The return-path race, pinned (the owed A1.2 sentence)

A realization's return-path envelope may arrive **before** the acceptance ack of the transmit that provoked it (the loopback microtask hang, M4; confirmed still latent, handled only by app folklore, cluster H). Therefore: a consumer **MUST register its correlation before it transmits**, and the kernel/realization **MUST buffer an unclaimed correlated return-path envelope** until it is claimed (or a declared bound elapses). This holds for every duplex handle, not just transport. The contract already permits consumer-assigned correlations (A1.2); this makes pre-registration mandatory rather than discovered by hitting a silent hang.

### A2.2 Descriptor claims are binding on the realization (tightens A1.4)

A descriptor is a promise the realization must keep. A realization **MUST NOT emit a fault code outside its descriptor's declared `faults`**; its actual `mailbox` bound and drop policy **MUST** be the ones the descriptor states. `resolve()`/the kernel **SHOULD** validate the `mailbox` field's presence and shape (it did not, cluster H). Shipped non-conformances recorded, not hidden: the relay cell declares `faults:[dead,gate-closed,bad-envelope]` yet emits `overflow`; its client outbox runs bound 64 / reject while the descriptor says 256 / oldest; the kernel's `validateDescriptor` never inspected `mailbox`. These are realization debts against a now-explicit rule, priced to M7.

### A2.3 Delivery honesty (tightens A1.2)

A realization **MUST NOT signal acceptance or delivery for a message it dropped.** Store-and-forward **MUST** distinguish three outcomes — *buffered durably*, *delivered*, *discarded* — and loss **MUST** surface as a fault, never a silent drop nor a false success count. Per-handle FIFO (A1.2) is an **obligation on the realization**, not an accident of network arrival order: a realization that cannot guarantee order **MUST** carry a sequence and reorder, or **MUST** declare weaker ordering in its descriptor. Shipped non-conformances recorded: concurrent empty-outbox sends reorder (FIFO relies on two independent fetches' arrival); a relay-*process* restart flushes the client outbox into a freshly-empty pair and reports the messages `flushed` though no peer received them; server-side queue overflow drops the oldest message silently at HTTP 200; delivered-but-unacked posts re-send without dedup (at-least-once). "The conversation outlived the infrastructure" is therefore true, precisely, for a **stream re-resolution against a surviving relay process** — not for the relay process's own death, which is the exact word "infrastructure" most invites. The claim is rescoped accordingly.

### A2.4 The behavioral criterion needs a two-resolution witness (scopes G2b)

G2b binds resolutions **of one cell**. Loopback (`channel:duplex`) and relay (`channel:paired`) are **different cells** with genuinely different `recv` surfaces (loopback echoes the sender's own correlation and no `from`; relay delivers peer traffic with correlation 0 and an authenticated `from`), so they are **not** a witness for "identical across resolutions," and the consumer is in fact wired to one backing's behavior. G2b stays CARRIED AS TARGET until a **single cell ships two resolutions** whose semantic surface (message vocabulary, correlation, ordering, fault set) is identical; the peer-channel resolution (E2) is the intended witness, and it **MUST** match the relay resolution's surface exactly. Until then, "indistinguishable across resolutions" is asserted, not demonstrated.

### A2.5 Time is a resource; blindness is executable (tightens A1.3 and the blindness probe)

The clock root **gains a `now` op** so wall-clock reads are verb-mediated; an application **MUST NOT** read substrate time directly. The blindness check becomes an **executable, committed script**, not a prose sentence, and its forbidden-token set **MUST** include ambient-authority globals (`Date`, `crypto`, `performance`, `localStorage`, `fetch`, `self`, `structuredClone`, …), not only a hand-picked host-object list. Shipped non-conformances recorded: `chat.js` reaches `Date.now()` for message timestamps and presence liveness because the clock cell exposed no `now`; the M4 "blindness grep" was prose-only and omitted `Date`, so it passed over a real leak. Pure ECMAScript intrinsics with no ambient authority (`Math`, `JSON`, `Promise`, arithmetic) are **not** leaks and stay permitted; the criterion is *capability* reach, not token spelling.

### A2.6 The identity plane's PoC status, on the record (advances A1.6)

The two-person gate as shipped is **shared-secret bucketing**: it verifies knowledge of a passphrase, it does not authenticate a peer, and A1.6 already flagged peer authentication as a concern the cell vocabulary does not yet carry. Named limits and non-conformances, carried whole to M7's security pipeline as its declared inputs: unsalted passphrase with no rate limit and no lockout (online brute-force is entry, not just confirmation; the `peers` name-list is a success oracle); caller-chosen session ids; no session eviction, TTL, revocation, or unpair op (permanent replay until process restart); slot-squat lockout and second-slot MITM; a session-id collision that bypasses the third-session cap and can take over a peer's stream; the app trusting the message-body `from` over the server-authenticated identity (sender-name impersonation, attacker-chosen message id overwriting history — the single most fixable defect, since the authenticated identity is already on the wire and merely discarded); no TLS and no end-to-end encryption, so message and photo content is readable by any third device on the LAN (the relay host is a participant, so operator visibility is inherent, but third-party wire visibility is not); bearer token carried in the events URL query. The auth-contract seam is real but **not zero-touch**: the credential flows through the app boot config and the join envelope, so the swap to a redirect/one-time-code/signed-token contract is small but not "no app change," and the claim is corrected to that. Peer authentication is the head of M7 security work.

**Update 2026-08-25 (operator word, pulled forward):** the impersonation half of the above — the app discarding the authenticated `from` — is FIXED in `chat.js` (`onWire` renders `env.from`, falling back to the body only when unstamped), headless-verified (CLAIMS H12). Everything else in this list, including the attacker-chosen message-id overwrite, remains an M7 input.
