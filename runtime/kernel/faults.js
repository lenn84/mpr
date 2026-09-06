// Fault vocabulary (A1.4): the only error shapes that may cross a handle.
export const FAULTS = ['gate-closed', 'not-found', 'refused', 'overflow', 'bad-envelope', 'dead', 'cancelled'];

export function makeFault(code, detail, correlation) {
  return { op: 'fault', correlation, body: { code: FAULTS.includes(code) ? code : 'refused', detail: String(detail ?? '') } };
}
