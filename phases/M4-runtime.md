# M4 — Runtime

Status: DONE, CLOSED 2026-08-25 (D19, after cascade check) | Created 2026-08-25 | Updated 2026-08-25

Close record:
- Probe 1 (G1 cycle): PASS. Both drive logs, 15 steps, zero failures (raw/drive-laptop-operator-{secure,plain}-hdroff.json).
- Probe 2 (blindness grep): PASS, mechanically, twice (before and after the race fix). Zero substrate tokens in the app.
- Probe 3 (G2b dual drive): PASS. Byte-identical app, localhost secure context elevated storage to OPFS, LAN origin floored to IndexedDB; both all-pass, no code branches; the drive logs' mode fields carry the context difference.
- Probe 4 (lifecycle): PASS first half (release via binder, dead-handle fault per vocabulary, re-bind; in both drive logs). AMENDED 2026-08-25: the second half (mid-job worker kill surfacing a fault and the durable requirement auto-re-binding) requires the fronting-manager machinery that M5's transport work builds (the A1.7 scenario); carried into M5's probes rather than half-tested here.
- Probe 5 (registry watch): PASS headlessly (pure kernel behavior): a subscription saw cell://system/transport@1 minted without polling, and the minted manager is discoverable.
- Drive evidence under raw/ with device and mode in filenames per convention. Defect record: save-handler error swallowing (fixed, fallback download added) and the return-path-outruns-ack race (fixed in-app per A1.2's consumer-assigned correlations; contract lesson logged, candidate A1.2 clarifying sentence at M6).
Depends on: M3 (the ratified contract: CELL.md plus Addendum 1). Feeds: M5 (the chat runs on what this phase builds). Gate: G1 (POV.md).

## What You Are Building

The finished world of this phase: the contract stops being paper. A kernel implements the five verbs natively and declares the three roots (registry, binder, clock). Four managers mint themselves over the census floor: an executor (workers plus Wasm envelopes), a storage manager (IndexedDB floor, OPFS elevated behind its context gate), a scheduler (MessageChannel cooperative loop), and a transport manager (relay resolution, built as a plan so the peer-channel resolution is a later re-resolution, not a rewrite). A trivial application then executes entirely inside the constructed world: it discovers, resolves, binds, and transmits, and contains not one direct browser API call. Gate G1 is that application running on one machine.

## Build Decisions (session-scoped, declared here)

- Plain ES modules, zero build step, no bundler, no dependencies. The substrate loads the runtime the way the contract describes the world: files as data, execution deferred. Types ride as JSDoc; the TypeScript-shaped contract sketch stays in CELL.md.
- Repo layout: runtime/kernel/ (verbs, roots, descriptor schema as JSON), runtime/managers/ (executor, storage, scheduler, transport), runtime/app/ (the G1 trivial app), served by the census server (census/serve.js already carries isolation and header modes).
- The descriptor schema (A1.4) is authored first, as JSON, before any manager code: descriptors precede execution, in the build order itself.

## Steps

1. Descriptor schema (A1.4 minimums) as JSON plus a validating loader.
2. Kernel: five verbs native for roots; registry, binder (release, handle refs), clock (ticks as envelopes). Kernel exception budget: exactly these three declarations.
3. Executor manager: worker pool, job envelopes with correlation refs, control-plane cancel (A1.3), fault vocabulary on the return path.
4. Storage manager: IndexedDB floor with manager-side serialization (M3 probe obligation), OPFS elevated behind its gate, one virtual-disk surface, normalized faults.
5. Scheduler manager: MessageChannel loop, envelope priority within A1.2 semantics, clock-fed deadlines; never assumes idle callbacks.
6. Transport manager: the relay resolution expressed as a plan (A1.5) even though it is one chain, so re-resolution machinery exists from day one; durable requirement held in the binding.
7. The G1 application: smallest honest exercise of all five instances (schedule a job, compute in a worker, persist the result, read it back, tick once, echo over loopback transport), written against handles only.
8. Drive and record.

## Verification (pre-declared)

- Probe 1 (G1): the application completes its cycle on the operator machine, served by census/serve.js.
- Probe 2 (blindness, mechanical): a grep over runtime/app/ finds zero occurrences of Worker, indexedDB, fetch, WebSocket, EventSource, postMessage, navigator, or window API tokens. The app speaks only verbs and handles.
- Probe 3 (G2b first drive): the same application, byte-identical, runs served from localhost (secure context: storage elevates to OPFS) and from the LAN address (floor: IndexedDB), with zero code branches on the backing. The two runs differ only in resolver telemetry.
- Probe 4 (lifecycle): bind, release via the binder, re-bind an exclusive resource in sequence without leaks; a killed worker mid-job surfaces a fault-vocabulary envelope, and the durable requirement re-binds the executor.
- Probe 5 (registry watch): a manager minted after app start becomes visible through a registry subscription without polling.
- Raw evidence: drive logs exported under raw/ with device and mode in filenames, census-server convention.

## Done When

All five probes pass, G1 is declared met in POV.md's gate table, and the operator declares M4 closed.

## Rollback

Delete runtime/; the contract, census, and claims stand untouched. No other artifact depends on M4 output yet.

## Open Questions

- The G1 app's loopback transport: BroadcastChannel same-page loop or the relay through serve.js? (Decides in build; the relay exercises more truth.)
- Does the scheduler expose deadline-miss as a fault or as telemetry? (A1.4 telemetry split suggests telemetry; decide when the clock lands.)
