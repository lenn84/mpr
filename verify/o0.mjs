// O0 passthrough — runs the committed Spore loader verifier (o0-verify.mjs, the
// sovereign-peer sub-ladder) as a subprocess and folds its PASS/FAIL lines into the
// bundled run, so one command covers the whole verified surface. o0-verify.mjs stays
// the source of truth; this only relays its result.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function run(sec) {
  const r = spawnSync('node', ['o0-verify.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  let any = false;
  for (const ln of out.split('\n')) {
    const m = ln.match(/^\s*(PASS|FAIL)\s+(.*?)(?:\s+\((.*)\))?\s*$/);
    if (m) { any = true; sec.check('o0: ' + m[2].trim(), m[1] === 'PASS', m[3] || ''); }
  }
  if (!any) sec.check('o0: spore loader verify ran', r.status === 0, out.trim().slice(-200) || ('exit ' + r.status));
}
