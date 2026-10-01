/*
 * Schedulr scheduling engine.
 * Pure functions, no DOM. Works as a browser global (window.Scheduler) and in Node (require).
 *
 * Time model: integer time units, simulated one tick at a time. A tick [t, t+1) is either
 * running a process, idle, or spent on a context switch.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = Object.freeze({
    maxProcs: 12,
    maxArrival: 99,
    maxBurst: 99,
    maxQuantum: 20,
    maxSwitchCost: 5
  });

  var ORDER = ['fcfs', 'sjf', 'srtn', 'rr'];

  var ALGORITHMS = {
    fcfs: {
      id: 'fcfs',
      short: 'FCFS',
      name: 'First Come, First Served',
      preemptive: false,
      rule: 'The process that arrived first goes first and keeps the CPU until it is done.',
      blurb: 'Like a queue at a shop. Simple and fair by arrival, but one long job makes everyone behind it wait.'
    },
    sjf: {
      id: 'sjf',
      short: 'SJF',
      name: 'Shortest Job First',
      preemptive: false,
      rule: 'When the CPU is free, the waiting process with the shortest burst goes next. Nothing is interrupted.',
      blurb: 'Gives the lowest average waiting time without interruptions, but long jobs can be pushed back again and again.'
    },
    srtn: {
      id: 'srtn',
      short: 'SRTN',
      name: 'Shortest Remaining Time Next',
      preemptive: true,
      rule: 'The process with the least time left always runs. A newcomer that needs less time takes over.',
      blurb: 'SJF that can interrupt. Best average waiting time, but with more switching and the same risk for long jobs.'
    },
    rr: {
      id: 'rr',
      short: 'Round Robin',
      name: 'Round Robin',
      preemptive: true,
      rule: 'Processes take turns. Each runs for at most one time quantum, then goes to the back of the line.',
      blurb: 'Everyone gets a turn quickly. A tiny quantum wastes time switching; a huge one behaves like FCFS.'
    }
  };

  var KEYS = {
    fcfs: function (p) { return [p.arrival, p.idx]; },
    sjf: function (p) { return [p.burst, p.arrival, p.idx]; },
    srtn: function (p) { return [p.remaining, p.arrival, p.idx]; }
  };

  function cmp(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  function best(list, algo) {
    var key = KEYS[algo];
    var m = list[0];
    for (var i = 1; i < list.length; i++) if (cmp(key(list[i]), key(m)) < 0) m = list[i];
    return m;
  }

  function removeFrom(list, item) {
    var i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }

  /**
   * @param {Array<{id:number, arrival:number, burst:number}>} input
   * @param {'fcfs'|'sjf'|'srtn'|'rr'} algo
   * @param {{quantum?:number, switchCost?:number}} opts
   */
  function simulate(input, algo, opts) {
    if (!ALGORITHMS[algo]) throw new Error('Unknown algorithm: ' + algo);
    opts = opts || {};
    var quantum = Math.max(1, Math.floor(opts.quantum) || 1);
    var cost = Math.max(0, Math.floor(opts.switchCost) || 0);

    var procs = input.map(function (p, i) {
      return {
        id: p.id, name: 'P' + p.id, arrival: p.arrival, burst: p.burst,
        idx: i, remaining: p.burst, firstRun: null, completion: null
      };
    });
    var n = procs.length;

    var events = [];
    var ticks = [];
    function log(t, type, text, idx) { events.push({ t: t, type: type, text: text, idx: idx == null ? null : idx }); }

    var sumBurst = procs.reduce(function (s, p) { return s + p.burst; }, 0);
    var maxArrival = procs.reduce(function (m, p) { return Math.max(m, p.arrival); }, 0);
    var guard = maxArrival + sumBurst * (cost + 1) + 50;

    var ready = [];
    var t = 0, done = 0, switches = 0, busy = 0;
    var current = null, lastRun = null, pending = null, expired = null;
    var csLeft = 0, qLeft = 0, prevIdle = false;

    function reason(p) {
      if (algo === 'fcfs') return 'arrived first';
      if (algo === 'sjf') return 'shortest burst: ' + p.burst;
      if (algo === 'srtn') return 'least time left: ' + p.remaining;
      return 'its turn in line';
    }

    while (done < n && t < guard) {
      var i;
      for (i = 0; i < n; i++) {
        if (procs[i].arrival === t) {
          ready.push(procs[i]);
          log(t, 'arrive', procs[i].name + ' arrives (burst ' + procs[i].burst + ')', i);
        }
      }
      if (expired) { ready.push(expired); expired = null; }

      if (csLeft === 0) {
        if (algo === 'srtn' && current && ready.length) {
          var cand = best(ready, 'srtn');
          if (cand.remaining < current.remaining) {
            log(t, 'preempt', cand.name + ' has ' + cand.remaining + ' left, less than ' + current.name + ' with ' + current.remaining + '. ' + current.name + ' is paused and ' + cand.name + ' goes first', cand.idx);
            ready.push(current);
            current = null;
          }
        }
        if (!current && ready.length) {
          var next = algo === 'rr' ? ready.shift() : best(ready, algo);
          if (algo !== 'rr') removeFrom(ready, next);
          if (algo === 'rr') qLeft = quantum;
          var prev = lastRun;
          lastRun = next;
          if (prev && prev !== next) {
            switches++;
            if (cost > 0) {
              pending = next;
              csLeft = cost;
              log(t, 'switch', 'The CPU switches from ' + prev.name + ' to ' + next.name + ' (' + cost + ' unit' + (cost > 1 ? 's' : '') + ')', next.idx);
            }
          }
          if (csLeft === 0) {
            current = next;
            if (prev !== next) log(t, 'dispatch', next.name + ' gets the CPU (' + reason(next) + ')', next.idx);
          }
        }
      }

      var queueView = algo === 'rr'
        ? ready.slice()
        : ready.slice().sort(function (a, b) { return cmp(KEYS[algo](a), KEYS[algo](b)); });
      var snap = {
        t: t, kind: 'idle', run: null, next: null,
        queue: queueView.map(function (p) { return p.idx; }),
        remaining: procs.map(function (p) { return p.remaining; }),
        quantumLeft: algo === 'rr' ? qLeft : null
      };

      if (csLeft > 0) {
        snap.kind = 'cs';
        snap.next = pending.idx;
        csLeft--;
        prevIdle = false;
        if (csLeft === 0) {
          current = pending;
          log(t + 1, 'dispatch', pending.name + ' gets the CPU (' + reason(pending) + ')', pending.idx);
          pending = null;
        }
      } else if (current) {
        snap.kind = 'run';
        snap.run = current.idx;
        prevIdle = false;
        if (current.firstRun === null) current.firstRun = t;
        current.remaining--;
        busy++;
        if (algo === 'rr') qLeft--;
        if (current.remaining === 0) {
          current.completion = t + 1;
          done++;
          log(t + 1, 'complete', current.name + ' finishes', current.idx);
          current = null;
        } else if (algo === 'rr' && qLeft === 0) {
          log(t + 1, 'preempt', current.name + ' used its turn of ' + quantum + ' and goes to the back of the line (' + current.remaining + ' left)', current.idx);
          expired = current;
          current = null;
        }
      } else {
        if (!prevIdle) log(t, 'idle', 'The CPU is idle until the next process arrives', null);
        prevIdle = true;
        lastRun = null;
      }

      ticks.push(snap);
      t++;
    }

    // Merge ticks into Gantt segments.
    var segments = [];
    ticks.forEach(function (s) {
      var last = segments[segments.length - 1];
      var pid = s.kind === 'run' ? s.run : null;
      if (last && last.kind === s.kind && last.run === pid) last.end = s.t + 1;
      else segments.push({ kind: s.kind, run: pid, start: s.t, end: s.t + 1 });
    });

    var total = t;
    var rows = procs.map(function (p) {
      var turnaround = p.completion - p.arrival;
      return {
        idx: p.idx, id: p.id, name: p.name, arrival: p.arrival, burst: p.burst,
        completion: p.completion, turnaround: turnaround,
        waiting: turnaround - p.burst, response: p.firstRun - p.arrival
      };
    });

    function avg(key) {
      return rows.length ? rows.reduce(function (s, r) { return s + r[key]; }, 0) / rows.length : 0;
    }

    return {
      algo: algo, quantum: quantum, switchCost: cost,
      rows: rows, segments: segments, ticks: ticks, events: events, total: total,
      metrics: {
        avgTurnaround: avg('turnaround'),
        avgWaiting: avg('waiting'),
        avgResponse: avg('response'),
        utilization: total ? (busy / total) * 100 : 0,
        throughput: total ? n / total : 0,
        switches: switches,
        busy: busy,
        idle: total - busy
      }
    };
  }

  return { LIMITS: LIMITS, ALGORITHMS: ALGORITHMS, ORDER: ORDER, simulate: simulate };
});
