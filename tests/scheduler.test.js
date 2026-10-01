'use strict';
const assert = require('node:assert/strict');
const { simulate, ORDER } = require('../public/js/scheduler.js');

const mk = (pairs) => pairs.map(([arrival, burst], i) => ({ id: i + 1, arrival, burst }));
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

test('FCFS: sample workload', () => {
  const r = simulate(mk([[0, 6], [1, 4], [2, 8], [3, 3], [9, 5]]), 'fcfs');
  assert.deepEqual(r.rows.map((x) => x.completion), [6, 10, 18, 21, 26]);
  approx(r.metrics.avgTurnaround, 13.2);
  approx(r.metrics.avgWaiting, 8);
  assert.equal(r.metrics.switches, 4);
  approx(r.metrics.utilization, 100);
});

test('SJF: classic non-preemptive example', () => {
  const r = simulate(mk([[0, 7], [2, 4], [4, 1], [5, 4]]), 'sjf');
  assert.deepEqual(r.rows.map((x) => x.waiting), [0, 6, 3, 7]);
  approx(r.metrics.avgWaiting, 4);
});

test('SRTN: Silberschatz example (avg wait 6.5)', () => {
  const r = simulate(mk([[0, 8], [1, 4], [2, 9], [3, 5]]), 'srtn');
  assert.deepEqual(r.rows.map((x) => x.completion), [17, 5, 26, 10]);
  approx(r.metrics.avgWaiting, 6.5);
});

test('SRTN: tie keeps the running job (no needless preemption)', () => {
  const r = simulate(mk([[0, 4], [1, 3]]), 'srtn');
  // at t=1 P1 has 3 left, P2 has 3: P1 keeps running
  assert.deepEqual(r.rows.map((x) => x.completion), [4, 7]);
});

test('RR: quantum 2, arrivals enter the queue before the preempted job', () => {
  const r = simulate(mk([[0, 4], [1, 3]]), 'rr', { quantum: 2 });
  assert.deepEqual(r.rows.map((x) => x.completion), [6, 7]);
  assert.deepEqual(r.segments.filter((s) => s.kind === 'run').map((s) => [s.run, s.start, s.end]),
    [[0, 0, 2], [1, 2, 4], [0, 4, 6], [1, 6, 7]]);
});

test('RR: a lone job is not charged context switches', () => {
  const r = simulate(mk([[0, 5]]), 'rr', { quantum: 2, switchCost: 3 });
  assert.equal(r.total, 5);
  assert.equal(r.metrics.switches, 0);
});

test('Idle gaps are shown and lower utilisation', () => {
  const r = simulate(mk([[0, 2], [5, 2]]), 'fcfs');
  assert.deepEqual(r.segments.map((s) => s.kind), ['run', 'idle', 'run']);
  assert.equal(r.total, 7);
  approx(r.metrics.utilization, (4 / 7) * 100);
  assert.equal(r.metrics.switches, 0); // idle in between resets the previous process
});

test('Context-switch cost adds dead time between different jobs', () => {
  const r = simulate(mk([[0, 2], [0, 2]]), 'fcfs', { switchCost: 1 });
  assert.deepEqual(r.segments.map((s) => s.kind), ['run', 'cs', 'run']);
  assert.equal(r.total, 5);
  approx(r.metrics.utilization, 80);
  assert.equal(r.rows[1].completion, 5);
});

test('Invariants hold for 2000 random workloads on every algorithm', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let iter = 0; iter < 2000; iter++) {
    const n = 1 + Math.floor(rnd() * 12);
    const procs = mk(Array.from({ length: n }, () => [Math.floor(rnd() * 20), 1 + Math.floor(rnd() * 15)]));
    const opts = { quantum: 1 + Math.floor(rnd() * 6), switchCost: Math.floor(rnd() * 3) };
    for (const algo of ORDER) {
      const r = simulate(procs, algo, opts);
      const ran = new Array(n).fill(0);
      r.segments.forEach((s) => { if (s.kind === 'run') ran[s.run] += s.end - s.start; });
      r.rows.forEach((row, i) => {
        assert.equal(ran[i], row.burst, `${algo}: P${row.id} ran ${ran[i]} not ${row.burst}`);
        assert.ok(row.completion >= row.arrival + row.burst);
        assert.ok(row.waiting >= 0 && row.response >= 0 && row.response <= row.waiting);
      });
      // segments tile the timeline exactly
      let cursor = 0;
      r.segments.forEach((s) => { assert.equal(s.start, cursor); cursor = s.end; });
      assert.equal(cursor, r.total);
      // nothing runs before it arrives
      r.segments.forEach((s) => { if (s.kind === 'run') assert.ok(s.start >= r.rows[s.run].arrival); });
    }
  }
});

console.log(`\n${passed} test groups passed`);
