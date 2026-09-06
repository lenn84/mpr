// verify.mjs — the M7 security sub-ladder headless runner (bundles L5–L8).
//
// One command re-runs the whole cumulative battery the drives recorded ad-hoc; a
// level name runs one; --pre-g4 runs the operator's pre-flight subset. It drives the
// REAL runtime cells, so a green means what the drives' greens meant. Authoring, not
// evidence: sessions author, the operator commits (D2). It re-runs already-declared
// exams (regression) — it does not pre-declare new ones (RES-EVID-5).
//
//   node verify.mjs                 # the whole ladder, cumulative
//   node verify.mjs l6              # one level
//   node verify.mjs --from l5 --to l7
//   node verify.mjs --pre-g4        # the headless-certified pre-flight subset
//   node verify.mjs --save          # also write an evidence drive to raw/
//
// Exit code is non-zero on any failure (CI-able, like o0-verify.mjs).
import { Section } from './verify/harness.mjs';
import * as o0 from './verify/o0.mjs';
import * as ws2 from './verify/ws2.mjs';
import * as ws2b from './verify/scenes-ws2b.mjs';
import * as fence from './verify/fence.mjs';
import * as l5 from './verify/l5.mjs';
import * as l6 from './verify/l6.mjs';
import * as l7 from './verify/l7.mjs';
import * as l8 from './verify/l8.mjs';

// The ladder, in order. Each level lists the check groups it owns. o0 is the spore
// loader sub-ladder (spawned); l5..l8 are the M7 security sub-ladder (unit floor +
// relay-backed scenes); l8 measures its 20 scenarios against the levels below it.
const LADDER = [
  { key: 'o0', title: 'O0 — spore verified local loader', groups: [['loader', o0.run]] },
  { key: 'ws2', title: 'WS2 — Addendum-2 conformance', groups: [['conformance', ws2.run], ['witness', ws2b.scenes]] },
  { key: 'l5', title: 'L5 — lineage machinery', groups: [['unit', l5.unit], ['scenes', l5.scenes]] },
  { key: 'l6', title: 'L6 — freshness + stop-orders', groups: [['unit', l6.unit], ['scenes', l6.scenes]] },
  { key: 'l7', title: 'L7 — E2E baseline', groups: [['unit', l7.unit], ['scenes', l7.scenes]] },
  { key: 'l8', title: 'L8 — the 20-scenario benchmark', groups: [['benchmark', l8.benchmark]] },
];

// The --pre-g4 pre-flight: exactly the headless-certified rows that back the G4
// driven-pilot drills — the TLS fence (L0) + the relay-backed scenes (cold start,
// truncation, observer/downgrade, freshness/outage, stop). No units, no benchmark.
const PRE_G4 = [
  { key: 'fence', title: 'L0 — TLS fence (behavioral)', groups: [['fence', fence.run]] },
  { key: 'l5', title: 'L5 — ceremony rehearsal + truncation (scenes)', groups: [['scenes', l5.scenes]] },
  { key: 'l6', title: 'L6 — freshness/outage + stop-order (scenes)', groups: [['scenes', l6.scenes]] },
  { key: 'l7', title: 'L7 — on-path observer + downgrade (scenes)', groups: [['scenes', l7.scenes]] },
];

function parseArgs(argv) {
  const a = { levels: null, from: null, to: null, preG4: false, save: false, quiet: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--from') a.from = argv[++i];
    else if (x === '--to') a.to = argv[++i];
    else if (x === '--pre-g4') a.preG4 = true;
    else if (x === '--save') a.save = true;
    else if (x === '--quiet') a.quiet = true;
    else positional.push(x);
  }
  if (positional.length) a.levels = positional.map((s) => s.toLowerCase());
  return a;
}

function selectLevels(a) {
  if (a.preG4) return PRE_G4;
  const keys = LADDER.map((l) => l.key);
  let chosen;
  if (a.levels) chosen = LADDER.filter((l) => a.levels.includes(l.key));
  else if (a.from || a.to) {
    const i0 = a.from ? keys.indexOf(a.from) : 0;
    const i1 = a.to ? keys.indexOf(a.to) : keys.length - 1;
    chosen = LADDER.slice(i0, i1 + 1);
  } else chosen = LADDER.slice();
  // L8 MEASURES against the lower battery — selecting it pulls in its prerequisites
  // (in ladder order) so the scenario mapping has real evidence to point at.
  if (chosen.some((l) => l.key === 'l8')) {
    const need = new Set(chosen.map((l) => l.key));
    for (const k of ['l5', 'l6', 'l7']) need.add(k);
    chosen = LADDER.filter((l) => need.has(l.key));
  }
  return chosen;
}

const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m';

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const levels = selectLevels(a);
  const allFindings = [];
  const results = {}; // level.key -> findings so far (L8 maps its scenarios onto these)
  let totalPass = 0, totalFail = 0;

  for (const level of levels) {
    console.log('\n' + BOLD + level.title + RESET);
    results[level.key] = results[level.key] || [];
    for (const [groupName, fn] of level.groups) {
      if (!fn) continue;
      const sec = new Section(level.key + ':' + groupName);
      try {
        await fn(sec, { preG4: a.preG4, results });
      } catch (e) {
        sec.check(groupName + ' — harness error', false, 'threw: ' + ((e && e.stack) || e));
      }
      for (const f of sec.findings) {
        allFindings.push({ ...f, level: level.key, group: groupName });
        results[level.key].push(f);
        if (f.ok) totalPass++; else totalFail++;
        if (!a.quiet || !f.ok) {
          const tag = f.ok ? GREEN + 'PASS' + RESET : RED + 'FAIL' + RESET;
          console.log('  ' + tag + '  ' + f.name + (f.detail ? DIM + '  (' + f.detail + ')' + RESET : ''));
        }
      }
    }
  }

  const total = totalPass + totalFail;
  console.log('\n' + BOLD + (totalFail ? RED : GREEN) + totalPass + '/' + total + ' pass' + RESET +
    (totalFail ? RED + '  ' + totalFail + ' FAIL' + RESET : '') +
    DIM + '  [' + levels.map((l) => l.key).join(',') + (a.preG4 ? ' pre-g4' : '') + ']' + RESET);

  if (a.save) await saveDrive(allFindings, levels, a, totalFail === 0);
  process.exit(totalFail ? 1 : 0);
}

async function saveDrive(findings, levels, a, pass) {
  const { writeFileSync } = await import('node:fs');
  const payload = {
    kind: 'drive', project: 'MPR', phase: 'M7-verify', device: 'headless-node', mode: 'plain',
    date: new Date().toISOString(),
    userAgent: 'node (verify.mjs bundled runner: ' + levels.map((l) => l.key).join('+') + (a.preG4 ? ' pre-g4' : '') + ')',
    findings: findings.map((f) => ({ name: f.name, ok: f.ok, detail: f.detail })),
    pass,
  };
  const name = 'drive-headless-verify-' + levels.map((l) => l.key).join('') + (a.preG4 ? '-preg4' : '') + '.json';
  writeFileSync('raw/' + name, JSON.stringify(payload, null, 2));
  console.log(DIM + 'saved raw/' + name + RESET);
}

main();
