# verify.mjs — the M7 sub-ladder headless runner

One command re-runs the security battery the L5–L8 drives recorded ad-hoc. It drives
the **real** runtime cells (kernel, identity, storage, transport, lineage, e2e,
envelope, wire) over an in-process relay, so a green here means what the committed
drives' greens meant. No dependencies; Node's built-in WebCrypto only (Node ≥ 20,
tested on 24).

## Run it

```
node verify.mjs                 # the whole bundle: o0 + L5 + L6 + L7 + L8
node verify.mjs l6              # one level
node verify.mjs l5 l7           # a couple of levels
node verify.mjs --from l5 --to l7
node verify.mjs --pre-g4        # the G4 driven-pilot pre-flight (TLS fence + scenes)
node verify.mjs --save          # also write an evidence drive to raw/
node verify.mjs --quiet         # only print failures + the summary
```

Exit code is non-zero on any failure (CI-able, like `o0-verify.mjs`).

## What each level is

| Level | What it drives | Backs (drive) |
|-------|----------------|---------------|
| `o0`  | Spore verified local loader (spawns `o0-verify.mjs`) | O0 |
| `l5`  | lineage unit battery + ceremony rehearsal + truncation alarm | drive-headless-l5-lineage |
| `l6`  | stop-derivation unit + freshness/decay (synthetic peer, clock seam) + stop-order race | drive-headless-l6-freshness-stop |
| `l7`  | E2E unit battery + on-path observer + downgrade probe | drive-headless-l7-e2e |
| `l8`  | the 20-scenario benchmark + §7 invariant-gap ledger, mapped onto L5–L7 + five l8-mini checks | drive-headless-l8-benchmark |

Selecting `l8` pulls in `l5`/`l6`/`l7` first — L8 *measures* against them.

## The discipline line (why this is safe to bundle)

This runner is **regression**: it re-runs already-passed, already-pre-declared exams.
It does **not** pre-declare new ones — a new level's exam still gets committed to its
phase doc *before* the run (RES-EVID-5). The G4 driven pilot and its live-only drills
stay live; `--pre-g4` only clears the headless-certifiable rows off the operator's
plate before the road test. Authoring, not evidence: sessions author, the operator
commits.

## Layout

```
verify.mjs            entry + CLI + ladder
verify/harness.mjs    check accumulator, actors, throwaway ceremony helpers
verify/net.mjs        in-process fetch-shim relay + isolated member boot + timers
verify/scenes-*.mjs   relay-backed scenes (l5/l6/l7); scenes-common shared floor
verify/l5..l8.mjs     per-level unit batteries + scene wiring + benchmark mapping
verify/o0.mjs         spore-loader passthrough
verify/fence.mjs      L0 TLS-fence behavioral check (spawns the real serve.js)
```
