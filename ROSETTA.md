# ROSETTA.md — MPR Term Reference

Status: living reference | Created 2026-08-25 | Updated 2026-08-25
Operator condition on D17: every term in the contract has a standing lookup row. Three columns, house pattern: the term, what it technically refers to, the plain image. New terms get a row the day they are coined; rows are amended in place with dates, never deleted.

## The Cell and Its Verbs

| Term | Refers to | Plain image |
|------|-----------|-------------|
| cell | The one repeating shape every resource follows: discover, describe, resolve, bind, transmit | The pattern, same at every scale |
| primitive | One of the five verbs the kernel implements natively; everything else composes from them | The alphabet |
| discover | Enumerate the descriptors the current context grants | "What is here?" |
| describe | Return a resource's descriptor, pure data, always before any execution | "What does it say about itself?" |
| resolve | Intersect a semantic requirement with available descriptors, return a ranked resolution | "Which one fits?" |
| bind | Acquire a live handle; every capability and context gate is enforced here, only here | "Get a grip on it"; the bouncer checks at this door |
| transmit | Move a message through a bound handle; the only verb touching live resources | "Pass this along" |
| composition | An apparent operation built from the five verbs, never a new verb | Execute, store, schedule, register are all sentences, not letters |

## Descriptions and Resolution

| Term | Refers to | Plain image |
|------|-----------|-------------|
| descriptor | The data record of a resource: provides, requires, gates, cost, resolutions | The thing's self-description; the egg is always data |
| requirement | What a consumer needs, stated semantically, never naming an implementation | "Reliable, private, fast", never "use WebSocket" |
| resolution | One concrete way a requirement can be satisfied | A candidate answer |
| handle | A bound, live, duplex mailbox | The grip |
| gate | A context condition checked at bind | The bouncer's rule |
| floor | The resolution available in every context (message-passing memory, IndexedDB) | The guaranteed baseline |
| elevated | A resolution behind a gate (shared memory, OPFS, HTTPS serving) | The upgrade, when context allows |
| resolver | The engine behind resolve(); where the sibling protocol-graph stream docks | The matchmaker |
| envelope | The standard message shape for jobs, identical for local workers and future remote dispatch | One envelope, any letterbox |

## Identity

| Term | Refers to | Plain image |
|------|-----------|-------------|
| cell:// | The address scheme: identity, never location | A name, not a street address |
| realm | The ownership namespace in an address (system, app, user) | Whose shelf it sits on |
| name | Stable identity within a realm | The label on the jar |
| ref | Content hash of the descriptor version; new descriptor, new ref, history append-only | The fingerprint of that exact edition |
| identity plane | Where people live (the two-person gate), separate from resource addresses, feeding realm access | People are not furniture |

## Structure

| Term | Refers to | Plain image |
|------|-----------|-------------|
| substrate | Whatever executes underneath; the browser now, by design not forever | The ground the house stands on |
| kernel | The minimal native implementation of the five verbs for root resources | The yolk |
| manager | A constructed thing fronting resources and minting new ones; indistinguishable from native at the interface | A cell wearing a cell |
| registry | The discoverable set of descriptors, itself a cell instance; the kernel declares the first one | The phone book that lists itself |
| minting | A manager transmitting its descriptor to the registry, becoming discoverable | Getting listed |
| census | discover() run as a recorded experiment with preserved raw evidence (M2) | The land survey |
| context | The set of grants the origin gives a page (secure or not, isolated or not); gates read it at bind | The room you are standing in, not the machine |

## Addendum 1 Terms (coined 2026-08-25, ratified D18)

| Term | Refers to | Plain image |
|------|-----------|-------------|
| binder | Kernel-declared root cell that issues handles and takes release envelopes; handle refs are identity-as-data | The cloakroom: ticket out, coat back |
| clock | Kernel-declared root cell; ticks and deadlines arrive as return-path envelopes; owned by the Scheduling instance | The wall clock that mails you the time |
| plan | A resolution that is a DAG of sub-resolutions with capability-typed edges; a chain is the linear case; bind(plan) is atomic with rollback | The route, not just the destination |
| durable requirement | The requirement plus policy persisting inside a binding; re-resolved and re-gated on every realization death | The standing order that survives the waiter changing |
| correlation ref | The id every envelope carries; completions, faults, progress return under it | The tracking number |
| credit | Flow-control envelope granting send-budget; mailboxes are bounded with declared drop policy | The tokens at the deli counter |
| fault vocabulary | The normalized error set every resolution speaks; native exception shapes never cross a handle | One language for bad news |
| control plane | Where cancel, release, subscribe, credit travel: manager control handles, never the job's own channel | The service corridor |
| telemetry | Measured runtime cost held by the resolver, explicitly not descriptor data | The stopwatch stays with the referee |
| behavioral criterion | G2b: the handle's semantic surface is identical across resolutions; consumer code never branches on the backing; knowledge, timing, and partition are out of scope by declaration | You may know what is under the hood; your hands never act on it |

## Project Machinery (for orientation)

| Term | Refers to | Plain image |
|------|-----------|-------------|
| M0..M7 | The phase ladder in PLAN.md | The staircase |
| Q1..Q5 | Numbered open questions; DECIDED rows carry the decision number | The parking lot for questions |
| D1..D17 | Locked decisions in the LOBBY Decision Log | The signed register |
| A1..E2, B3, G* | Claim IDs in CLAIMS.md, clustered by resource | The evidence lockers |
| P-park-N | Parked branches in LOBBY.md (mobile census, compute plane, ScriptC, sixth verb) | Seeds in the drawer |
| probes | Pre-declared verification steps in each phase doc, written before execution | The exam written before the lesson |
