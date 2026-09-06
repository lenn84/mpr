// Scheduler manager: MessageChannel cooperative loop, priority inside A1.2
// envelope semantics. Never assumes idle callbacks (absent on the partner device, C1).
import { makeFault } from '../kernel/faults.js';

export const DESCRIPTOR = {
  id: 'cell://system/scheduler@1', provides: ['schedule'], requires: ['time'], gates: [], cost: 'low',
  mailbox: { bound: 128, drop: 'reject' }, controlOps: [], faults: ['overflow', 'bad-envelope'],
  resolutions: [{ key: 'channel-loop', gates: [], cost: 'low' }],
};

export function register(kernel) {
  kernel.registerFactory(DESCRIPTOR.id, (_key, emit) => {
    const queue = []; // {priority, correlation}, drained highest priority first, one per tick
    const mc = new MessageChannel();
    let scheduled = false;
    mc.port1.onmessage = () => {
      scheduled = false;
      if (!queue.length) return;
      queue.sort((a, b) => b.priority - a.priority);
      const t = queue.shift();
      emit({ op: 'due', correlation: t.correlation, body: { priority: t.priority } });
      if (queue.length) { scheduled = true; mc.port2.postMessage(0); }
    };
    return {
      accept(env) {
        if (env.op === 'task') {
          if (queue.length >= DESCRIPTOR.mailbox.bound) return makeFault('overflow', 'queue bound', env.correlation);
          queue.push({ priority: (env.body && env.body.priority) || 0, correlation: env.correlation });
          if (!scheduled) { scheduled = true; mc.port2.postMessage(0); }
          return { accepted: true, correlation: env.correlation };
        }
        return makeFault('bad-envelope', env.op, env.correlation);
      },
      close() { mc.port1.close(); mc.port2.close(); queue.length = 0; },
    };
  });
  return DESCRIPTOR;
}
