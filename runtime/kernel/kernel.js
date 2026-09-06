// The kernel: five verbs native, three declared roots (registry, binder, clock).
// Kernel exception budget: exactly these three declarations (CELL.md A1.3).
import { makeFault } from './faults.js';

const COST_RANK = { low: 0, medium: 1, high: 2 };

// Gates are context properties, read at bind and only at bind (B3 law).
const GATES = {
  'secure-context': () => globalThis.isSecureContext === true,
  'cross-origin-isolation': () => globalThis.crossOriginIsolated === true,
  'feature:idle-callback': () => typeof globalThis.requestIdleCallback === 'function',
};

// Complete inline default: behavior must not depend on JSON-module support,
// which varies by engine. schema.json remains the declared data artifact and
// overrides this copy wherever it loads.
const DEFAULT_SCHEMA = {
  descriptor: {
    required: ['id', 'provides', 'requires', 'gates', 'cost', 'mailbox', 'controlOps', 'faults', 'resolutions'],
    cost: ['low', 'medium', 'high'],
    drop: ['oldest', 'reject'],
    idPattern: '^cell://[a-z0-9-]+/[a-z0-9-]+@[a-z0-9]+$',
    resolution: { required: ['key', 'gates', 'cost'] },
  },
};

let schemaCache = null;
async function loadSchema() {
  if (!schemaCache) {
    // Plain fetch of the data artifact: JSON-module import syntax parses only on
    // some engines (mobile WebKit rejects it at parse time, killing the whole
    // module graph). Where fetch cannot reach the file, the identical inline
    // copy serves.
    try {
      const r = await fetch(new URL('./schema.json', import.meta.url));
      const j = await r.json();
      schemaCache = j && j.descriptor ? j : DEFAULT_SCHEMA;
    } catch {
      schemaCache = DEFAULT_SCHEMA;
    }
  }
  return schemaCache;
}

export function validateDescriptor(d, schema) {
  const s = schema.descriptor;
  const errs = [];
  for (const f of s.required) if (!(f in d)) errs.push('missing ' + f);
  if (d.id && s.idPattern && !new RegExp(s.idPattern).test(d.id)) errs.push('bad id ' + d.id);
  if (d.cost && !s.cost.includes(d.cost)) errs.push('bad cost');
  // A2.2: the mailbox claim is binding, so its shape is validated, not just its
  // presence — a positive integer bound and a drop policy from the schema enum.
  if (d.mailbox) {
    if (!Number.isInteger(d.mailbox.bound) || d.mailbox.bound < 1) errs.push('bad mailbox bound');
    if (!s.drop.includes(d.mailbox.drop)) errs.push('bad mailbox drop');
  }
  for (const r of d.resolutions || []) for (const f of s.resolution.required) if (!(f in r)) errs.push('resolution missing ' + f);
  return errs;
}

export async function createKernel() {
  const schema = await loadSchema();
  const registry = new Map();      // id -> descriptor (pure data)
  const factories = new Map();     // id -> (resolutionKey, emit) => realization {accept, close}
  const bindings = new Map();      // handleRef -> {realization, plan, emit}
  const watchers = new Set();      // registry subscribers' emit fns
  let nextCorrelation = 1;
  let nextRef = 1;

  const gateOpen = (name) => (GATES[name] ? GATES[name]() : false);

  function mint(descriptor) {
    const errs = validateDescriptor(descriptor, schema);
    if (errs.length) return makeFault('bad-envelope', errs.join('; '));
    registry.set(descriptor.id, descriptor);
    for (const emit of watchers) emit({ op: 'minted', correlation: 0, body: { id: descriptor.id } });
    return null;
  }

  // --- The three declared roots. Descriptors are data like any other.
  const ROOTS = [
    { id: 'cell://system/registry@0', provides: ['registry'], requires: [], gates: [], cost: 'low',
      mailbox: { bound: 64, drop: 'reject' }, controlOps: ['subscribe'], faults: ['bad-envelope', 'refused'],
      resolutions: [{ key: 'native', gates: [], cost: 'low' }] },
    { id: 'cell://system/binder@0', provides: ['bind-control'], requires: [], gates: [], cost: 'low',
      mailbox: { bound: 64, drop: 'reject' }, controlOps: ['release'], faults: ['not-found'],
      resolutions: [{ key: 'native', gates: [], cost: 'low' }] },
    { id: 'cell://system/clock@0', provides: ['time'], requires: [], gates: [], cost: 'low',
      mailbox: { bound: 256, drop: 'reject' }, controlOps: [], faults: ['bad-envelope'],
      resolutions: [{ key: 'native', gates: [], cost: 'low' }] },
  ];
  for (const d of ROOTS) registry.set(d.id, d);

  factories.set('cell://system/registry@0', (_key, emit) => ({
    accept(env) {
      if (env.op === 'mint') { const f = mint(env.body); return f ? f : { accepted: true, correlation: env.correlation }; }
      if (env.op === 'subscribe') { watchers.add(emit); return { accepted: true, correlation: env.correlation }; }
      return makeFault('bad-envelope', env.op, env.correlation);
    },
    close() { watchers.delete(emit); },
  }));

  factories.set('cell://system/binder@0', () => ({
    accept(env) {
      if (env.op === 'release') {
        const b = bindings.get(env.body && env.body.ref);
        if (!b) return makeFault('not-found', env.body && env.body.ref, env.correlation);
        try { b.realization.close(); } catch {}
        bindings.delete(env.body.ref);
        return { accepted: true, correlation: env.correlation };
      }
      return makeFault('bad-envelope', env.op, env.correlation);
    },
    close() {},
  }));

  factories.set('cell://system/clock@0', (_key, emit) => {
    const timers = new Set();
    return {
      accept(env) {
        if (env.op === 'after' && env.body && typeof env.body.ms === 'number') {
          const t = setTimeout(() => { timers.delete(t); emit({ op: 'tick', correlation: env.correlation, body: {} }); }, env.body.ms);
          timers.add(t);
          return { accepted: true, correlation: env.correlation };
        }
        // A2.5: wall-clock reads are verb-mediated — the app asks the clock root
        // for `now` instead of reaching Date directly.
        if (env.op === 'now') {
          emit({ op: 'time', correlation: env.correlation, body: { ms: Date.now() } });
          return { accepted: true, correlation: env.correlation };
        }
        return makeFault('bad-envelope', env.op, env.correlation);
      },
      close() { for (const t of timers) clearTimeout(t); },
    };
  });

  return {
    // discover: identities and summaries only (A1.6); describe is the full-record authority.
    discover(realm) {
      const out = [];
      for (const d of registry.values()) {
        if (realm && !d.id.startsWith('cell://' + realm + '/')) continue;
        out.push({ id: d.id, provides: [...d.provides] });
      }
      return out;
    },

    describe(id) {
      const d = registry.get(id);
      return d ? JSON.parse(JSON.stringify(d)) : makeFault('not-found', id);
    },

    // resolve: typed match of need against provides, gate-filtered resolutions,
    // ranked by cost then preference. Returns a plan carrying the durable requirement (A1.5).
    resolve(requirement) {
      const need = requirement && requirement.need ? requirement.need : [];
      const candidates = [];
      for (const d of registry.values()) {
        if (!need.every((n) => d.provides.includes(n))) continue;
        const open = (d.resolutions || []).filter((r) => (r.gates || []).every(gateOpen));
        if (!open.length) continue;
        open.sort((a, b) => COST_RANK[a.cost] - COST_RANK[b.cost]);
        candidates.push({ id: d.id, resolution: open[0].key, cost: open[0].cost });
      }
      if (!candidates.length) return makeFault('not-found', JSON.stringify(need));
      candidates.sort((a, b) => COST_RANK[a.cost] - COST_RANK[b.cost]);
      return { plan: [candidates[0]], requirement: requirement };
    },

    // bind: gates enforced here and only here; atomic over the plan with rollback (A1.5).
    bind(plan, opts) {
      if (plan && plan.op === 'fault') return plan;
      const onEnvelope = (opts && opts.onEnvelope) || (() => {});
      const bound = [];
      for (const node of plan.plan) {
        const d = registry.get(node.id);
        const r = (d.resolutions || []).find((x) => x.key === node.resolution);
        if (!d || !r || !(r.gates || []).every(gateOpen)) {
          for (const b of bound) { try { b.close(); } catch {} }
          return makeFault('gate-closed', node.id + '#' + node.resolution);
        }
        const factory = factories.get(node.id);
        if (!factory) {
          for (const b of bound) { try { b.close(); } catch {} }
          return makeFault('dead', 'no realization for ' + node.id);
        }
        bound.push(factory(node.resolution, onEnvelope));
      }
      const ref = 'h' + nextRef++;
      bindings.set(ref, { realization: bound[0], plan, emit: onEnvelope });
      return { ref };
    },

    // transmit: the only verb touching a live handle. Correlation assigned if absent;
    // acceptance acked synchronously, results/faults arrive on the return path (A1.2).
    async transmit(handle, envelope) {
      const b = bindings.get(handle && handle.ref);
      if (!b) return makeFault('dead', handle && handle.ref, envelope && envelope.correlation);
      const env = { ...envelope };
      if (!env.correlation) env.correlation = nextCorrelation++;
      const ack = await b.realization.accept(env);
      return ack || { accepted: true, correlation: env.correlation };
    },

    // Kernel plumbing for managers: factory registration is implementation, not contract surface.
    registerFactory(id, factory) { factories.set(id, factory); },
  };
}
