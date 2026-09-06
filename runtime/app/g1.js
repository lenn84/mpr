// G1: the trivial application. It speaks verbs and handles only. It must contain
// zero direct substrate API tokens (M4 probe 2, mechanically enforced by grep).
export async function run(kernel, report) {
  const log = [];
  const step = (name, ok, detail) => { log.push({ name, ok, detail: String(detail ?? '') }); if (report) report(name, ok, detail); };
  // The return path can outrun the acceptance ack, so interest is registered
  // BEFORE transmitting: the app assigns its own correlation (A1.2 allows it)
  // and buffers any envelope that arrives with no waiter yet.
  const waiters = new Map();
  const inbox = new Map();
  let seq = 0;
  const settle = (env) => {
    const w = waiters.get(env.correlation);
    if (w) { waiters.delete(env.correlation); w(env); }
    else inbox.set(env.correlation, env);
  };
  const expect = (correlation) => {
    if (inbox.has(correlation)) { const e = inbox.get(correlation); inbox.delete(correlation); return Promise.resolve(e); }
    return new Promise((res) => waiters.set(correlation, res));
  };
  const opts = { onEnvelope: settle };

  const acquire = (need) => kernel.bind(kernel.resolve({ need }), opts);
  const ask = async (handle, envelope) => {
    const correlation = 'g1-' + (++seq);
    const reply = expect(correlation);
    const ack = await kernel.transmit(handle, { ...envelope, correlation });
    if (ack.op === 'fault') { waiters.delete(correlation); return ack; }
    return reply;
  };

  try {
    const sched = acquire(['schedule']);
    const exec = acquire(['execute:js']);
    const store = acquire(['store:kv']);
    const chan = acquire(['channel:duplex']);
    const clock = acquire(['time']);
    const binder = acquire(['bind-control']);
    for (const [n, h] of [['scheduler', sched], ['executor', exec], ['storage', store], ['channel', chan], ['clock', clock], ['binder', binder]]) {
      step('bind ' + n, !!h.ref, h.ref || (h.body && h.body.code));
      if (!h.ref) return { pass: false, log };
    }

    const due = await ask(sched, { op: 'task', body: { priority: 2 } });
    step('scheduled task came due', due.op === 'due', due.op);

    const job = await ask(exec, { op: 'run', body: { src: 'return args.a + args.b;', args: { a: 20, b: 22 } } });
    const answer = job.body && job.body.result;
    step('worker computed 20 + 22', answer === 42, answer);

    const put = await ask(store, { op: 'put', body: { key: 'g1-answer', value: answer } });
    step('stored the answer', put.op === 'stored', put.op);
    const got = await ask(store, { op: 'get', body: { key: 'g1-answer' } });
    step('read the answer back', got.body && got.body.value === 42, got.body && got.body.value);

    const tick = await ask(clock, { op: 'after', body: { ms: 100 } });
    step('clock ticked after 100ms', tick.op === 'tick', tick.op);

    const echo = await ask(chan, { op: 'send', body: { text: 'hello world' } });
    step('channel echoed', echo.op === 'recv' && echo.body.text === 'hello world', echo.body && echo.body.text);

    const rel = await kernel.transmit(binder, { op: 'release', body: { ref: exec.ref } });
    step('released executor via binder', rel.accepted === true, JSON.stringify(rel));
    const deadAck = await kernel.transmit(exec, { op: 'run', body: { src: 'return 1;', args: {} } });
    step('released handle faults as dead', deadAck.op === 'fault' && deadAck.body.code === 'dead', deadAck.body && deadAck.body.code);

    const exec2 = acquire(['execute:js']);
    const job2 = await ask(exec2, { op: 'run', body: { src: 'return args.n * 2;', args: { n: 21 } } });
    step('re-bound executor computed', job2.body && job2.body.result === 42, job2.body && job2.body.result);

    const pass = log.every((s) => s.ok);
    return { pass, log };
  } catch (err) {
    step('unexpected failure', false, (err && err.message) || err);
    return { pass: false, log };
  }
}
