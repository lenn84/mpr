// Executor manager: worker pool behind job envelopes. Cancel travels the control
// plane and is effected by termination, never sent down the job's channel (A1.3).
import { makeFault } from '../kernel/faults.js';

export const DESCRIPTOR = {
  id: 'cell://system/executor@1', provides: ['execute:js'], requires: [], gates: [], cost: 'low',
  mailbox: { bound: 32, drop: 'reject' }, controlOps: ['cancel'], faults: ['refused', 'overflow', 'bad-envelope', 'cancelled'],
  resolutions: [{ key: 'worker-pool', gates: [], cost: 'low' }],
};

const WORKER_SRC = `onmessage = (e) => {
  const { src, args, correlation } = e.data;
  try {
    const f = new Function('args', src);
    Promise.resolve(f(args)).then(
      (r) => postMessage({ ok: true, correlation, result: r }),
      (err) => postMessage({ ok: false, correlation, code: 'refused', detail: String((err && err.message) || err) })
    );
  } catch (err) {
    postMessage({ ok: false, correlation, code: 'bad-envelope', detail: String((err && err.message) || err) });
  }
};`;

export function register(kernel) {
  kernel.registerFactory(DESCRIPTOR.id, (_key, emit) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const jobs = new Map(); // correlation -> worker (one worker per in-flight job; pool kept simple)
    const spawn = () => {
      const w = new Worker(url);
      w.onmessage = (e) => {
        const m = e.data;
        jobs.delete(m.correlation);
        w.terminate();
        emit(m.ok ? { op: 'result', correlation: m.correlation, body: { result: m.result } }
                  : makeFault(m.code, m.detail, m.correlation));
      };
      return w;
    };
    return {
      accept(env) {
        if (env.op === 'run' && env.body && typeof env.body.src === 'string') {
          if (jobs.size >= DESCRIPTOR.mailbox.bound) return makeFault('overflow', 'mailbox bound', env.correlation);
          const w = spawn();
          jobs.set(env.correlation, w);
          w.postMessage({ src: env.body.src, args: env.body.args, correlation: env.correlation });
          return { accepted: true, correlation: env.correlation };
        }
        if (env.op === 'cancel' && env.body && jobs.has(env.body.correlation)) {
          jobs.get(env.body.correlation).terminate();
          jobs.delete(env.body.correlation);
          emit(makeFault('cancelled', 'by control plane', env.body.correlation));
          return { accepted: true, correlation: env.correlation };
        }
        return makeFault('bad-envelope', env.op, env.correlation);
      },
      close() { for (const w of jobs.values()) w.terminate(); jobs.clear(); URL.revokeObjectURL(url); },
    };
  });
  return DESCRIPTOR;
}
