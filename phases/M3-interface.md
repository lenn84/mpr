# M3 — Interface Layer

Status: DONE, CLOSED 2026-08-25 (D18) | Created 2026-08-24 | Updated 2026-08-25

Close record, probes re-judged against CELL.md as amended by ratified Addendum 1:
- Probe 1 (primitive set closes every resource, none unused): PASS. Claim G1 VERIFIED 3-0 across nine hostile candidates; discover/describe redundancy repaired by A1.6.
- Probe 2 (same set expresses the sibling transport node): PASS as amended. G3 as originally worded CONTRADICTED; G3b VERIFIED on paper via the A1.7 worked chain (plans, durable requirement, policy-checked re-bind).
- Probe 3 (indistinguishability, adversarially voted): PASS under the ratified A1.1 behavioral criterion. Original line-84 wording CONTRADICTED (G2); per-instance holds recorded in the seat verdict table under the rescope; G2b carried as target, verified by drive at M4 and adversarially at M6. Storage-manager serialization and normalized faults are M4 build obligations inherited from this probe.
- Probe 4 (explicit context gates, zero device names in the contract): PASS. Instance-table gates name conditions only; device mentions exist solely in the census-ground evidence section.
- Probe 5 (Q1, Q3 flipped to DECIDED with dated rationale): PASS (D16, D17).
Depends on: M2 (interfaces are drawn only over censused facts). Feeds: M4 (the runtime composes what this phase defines).

## What You Are Building

The finished world of this phase: one interface contract, the cell, written once and instantiated five times over the census intersection. Each instance names its resource, describes itself, states what it requires and provides, and admits multiple resolutions. A consumer reading any instance cannot tell whether it fronts a native primitive or a composed manager (the M3 acceptance criterion from the Fractal Invariant corollary). The identity scheme is asserted here: what an address means in this world, independent of prior-art identity planes.

## The Census Intersection (the ground this phase stands on)

Both devices, proven 2026-08-24:
- Execution: workers, module workers, 8 hardware threads, Wasm on main thread and in workers (A1, A2).
- Memory: transferable message-passing (B2 mechanism). Shared memory is an ELEVATED resolution, operator device only, and only in a secure context (B1, B3). The floor is message passing.
- Scheduling: MessageChannel everywhere; requestIdleCallback must NOT be assumed (absent on partner); measured drift 3.7 to 5.3 ms (C1 facts).
- Storage: IndexedDB is the floor; OPFS is an elevated resolution (D1, two-resolution rider).
- I/O: fetch, WebSocket, server-sent events, BroadcastChannel everywhere; peer channels present both sides (E1 facts, E2).

Design law derived from B3: elevated resolutions are context-gated, not device-gated. The interface must express "what this context grants" and resolve accordingly, never hardcode per machine.

## Steps

1. Decide Q3: the minimal primitive set that closes the cell (candidate: discover, describe, bind, transmit, resolve, execute; target 5 to 7). Test the set on paper against all five resources AND against the sibling stream's protocol-graph node (same cell, different substrate) before locking.
2. Decide Q1: the identity scheme. What a resource address encodes (identity, not location), seeded by the sibling research's object-addressed model. Assert independence: this is MPR's own scheme, prior art cited not adopted.
3. Write the cell contract as a single document plus a TypeScript-shaped interface sketch (no runtime code yet; M4 builds it).
4. Instantiate the contract on paper for all five census resources, each with its floor resolution and any elevated resolutions, each marked with its context gate.
5. Adversarial read: attack the contract with the indistinguishability criterion, the B3 context-gate law, and at least one hostile scenario per resource (resolution vanishes mid-session; the M1 claim is that the logical relationship survives re-resolution).

## Verification (pre-declared)

- Probe 1: the primitive set closes every census resource with no resource needing a primitive outside the set, and no primitive unused.
- Probe 2: the same set expresses the sibling stream's transport node without modification (the cell is substrate-independent, observation 002).
- Probe 3: for each of the five instances, a reader given only the interface text cannot determine whether the backing is native or composed (checked adversarially, votes recorded).
- Probe 4: every elevated resolution carries an explicit context gate; zero device names appear in the contract.
- Probe 5: Q1 and Q3 flip to DECIDED in PLAN.md with dated rationale in the LOBBY Decision Log.

## Done When

All five probes pass, CLAIMS.md carries the contract claims with verdicts, and the operator declares M3 closed.

## Rollback

The contract is paper; discard the doc, Q1 and Q3 reopen, census verdicts stand untouched.

## Open Questions

- Does the scheduler primitive need a distinct verb, or is it a composition of bind plus execute? (Decides inside Q3.)
- Where does the two-person gate identity live relative to resource identity: same scheme or a separate plane? (Feeds M5 and the customer-auth contract shaping.)
