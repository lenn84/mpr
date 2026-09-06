// L0 TLS fence — a behavioral check that serve.js refuses the private key material
// across the wire (the fault the G4 prep walk-through caught: runtime/tls/ is inside
// the served runtime/ subtree but must never cross the LAN). Spawns the REAL serve.js
// in loopback dev mode (--no-tls, no LAN, no recorded port) and probes it over
// node:http, bypassing the in-process relay shim entirely.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function get(port, path) {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (r) => { r.resume(); res(r.statusCode); });
    req.on('error', () => res(0));
    req.setTimeout(3000, () => { req.destroy(); res(0); });
  });
}

async function bootOnce(port) {
  const child = spawn('node', ['census/serve.js', String(port), '--no-tls'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = await new Promise((res) => {
    let buf = ''; const to = setTimeout(() => res(false), 5000);
    child.stdout.on('data', (d) => { buf += d; if (/serving/.test(buf)) { clearTimeout(to); res(true); } });
    child.on('exit', () => { clearTimeout(to); res(false); });
  });
  return { child, ready };
}

export async function run(sec) {
  let inst = null;
  for (let i = 0; i < 3 && !(inst && inst.ready); i++) {
    if (inst) try { inst.child.kill('SIGKILL'); } catch {}
    inst = await bootOnce(21000 + Math.floor(Math.random() * 20000));
  }
  if (!inst || !inst.ready) { sec.check('tls-fence: serve.js booted --no-tls (loopback)', false, 'server did not come up'); return; }
  const port = inst.child.spawnargs[inst.child.spawnargs.indexOf('--no-tls') - 1];
  sec.check('tls-fence: serve.js booted --no-tls (loopback, ephemeral port)', true, '');

  const tls = await get(port, '/runtime/tls/host.key');
  const app = await get(port, '/runtime/app/chat.html');
  const seed = await get(port, '/idea.txt');
  try { inst.child.kill('SIGKILL'); } catch {}

  sec.check('tls-fence: runtime/tls key material is 403 across the wire', tls === 403, 'status ' + tls);
  sec.check('tls-fence: runtime/app/chat.html is served (200)', app === 200, 'status ' + app);
  sec.check('tls-fence: the seed register (idea.txt) is 403 (never served)', seed === 403, 'status ' + seed);
}
