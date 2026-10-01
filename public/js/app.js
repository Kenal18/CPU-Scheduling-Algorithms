/* Schedulr UI. Depends on window.Scheduler (js/scheduler.js). */
(function () {
  'use strict';

  var S = window.Scheduler;
  var ALGORITHMS = S.ALGORITHMS, ORDER = S.ORDER, L = S.LIMITS, simulate = S.simulate;

  var STORE_KEY = 'schedulr:v1';
  var BASE_RATE = 1.3; // time units per second at 1x

  var PRESETS = {
    sample: { algo: null, procs: [[0, 6], [1, 4], [2, 8], [3, 3], [9, 5]] },
    convoy: { algo: 'fcfs', procs: [[0, 24], [1, 3], [2, 3], [3, 2]] },
    sjf: { algo: 'sjf', procs: [[0, 7], [2, 4], [4, 1], [5, 4]] },
    rr: { algo: 'rr', procs: [[0, 5], [1, 3], [2, 1], [3, 2], [4, 3]] },
    idle: { algo: null, procs: [[0, 3], [8, 2], [15, 4]] },
    tie: { algo: null, procs: [[0, 5], [0, 3], [0, 8], [0, 2]] }
  };
  var DEFAULT = { algo: 'fcfs', quantum: 2, switchCost: 0, procs: PRESETS.sample.procs };

  /* ---------- helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2); }
  var PALETTE = ['#f4b9b9', '#b9d3f4', '#c8e6bf', '#f6e3a4', '#d9c7ee', '#f7cfae', '#b8e2dd', '#efc3dc', '#d3dba3', '#c3c9f0', '#f1d6a8', '#cde0ee'];
  function colorOf(id) { return PALETTE[(id - 1) % PALETTE.length]; }
  function isInt(s, min, max) {
    if (typeof s === 'string' && s.trim() === '') return false;
    var v = Number(s);
    return Number.isInteger(v) && v >= min && v <= max;
  }

  function h(tag, props) {
    var el = document.createElement(tag);
    var key;
    props = props || {};
    for (key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      var v = props[key];
      if (v == null || v === false) continue;
      if (key === 'class') el.className = v;
      else if (key === 'text') el.textContent = v;
      else if (key === 'css') { for (var c in v) el.style.setProperty(c, v[c]); }
      else if (key.indexOf('on') === 0) el.addEventListener(key.slice(2), v);
      else el.setAttribute(key, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- state ---------- */
  var state = { algo: 'fcfs', quantum: 2, switchCost: 0, procs: [], nextId: 1, tab: 'table' };
  var paramBad = { quantum: false, switchCost: false };
  var result = null;
  var all = [];
  var pos = 0, shownCur = -1, playing = false, raf = 0, lastFrame = 0, speed = 1;

  function setProcs(pairs) {
    state.procs = pairs.map(function (p, i) { return { id: i + 1, arrival: p[0], burst: p[1], bad: {} }; });
    state.nextId = pairs.length + 1;
  }

  function normalize(o) {
    if (!o || typeof o !== 'object') return null;
    if (ORDER.indexOf(o.algo) < 0) return null;
    var q = Number(o.quantum), c = Number(o.switchCost);
    if (!Number.isInteger(q) || q < 1 || q > L.maxQuantum) return null;
    if (!Number.isInteger(c) || c < 0 || c > L.maxSwitchCost) return null;
    if (!Array.isArray(o.procs) || o.procs.length > L.maxProcs) return null;
    var procs = [];
    for (var i = 0; i < o.procs.length; i++) {
      var p = o.procs[i];
      if (!Array.isArray(p) || p.length !== 2) return null;
      var a = Number(p[0]), b = Number(p[1]);
      if (!Number.isInteger(a) || a < 0 || a > L.maxArrival) return null;
      if (!Number.isInteger(b) || b < 1 || b > L.maxBurst) return null;
      procs.push([a, b]);
    }
    return { algo: o.algo, quantum: q, switchCost: c, procs: procs };
  }

  function b64urlEncode(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return atob(s);
  }

  function readInitial() {
    try {
      var m = /[#&]s=([A-Za-z0-9_-]+)/.exec(location.hash);
      if (m) {
        var d = JSON.parse(b64urlDecode(m[1]));
        var n = normalize({ algo: d.a, quantum: d.q, switchCost: d.c, procs: d.p });
        if (n) return n;
      }
    } catch (e) { /* ignore bad link */ }
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var n2 = normalize(JSON.parse(raw)); if (n2) return n2; }
    } catch (e) { /* storage unavailable */ }
    return DEFAULT;
  }

  function plain() {
    return { algo: state.algo, quantum: state.quantum, switchCost: state.switchCost,
      procs: state.procs.map(function (p) { return [p.arrival, p.burst]; }) };
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(plain())); } catch (e) { /* ignore */ } }

  /* ---------- algorithm UI ---------- */
  function syncAlgoUI() {
    var a = ALGORITHMS[state.algo];
    $$('#algoTabs button').forEach(function (b) {
      var on = b.getAttribute('data-algo') === state.algo;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $('#algoName').textContent = a.name;
    $('#algoTag').textContent = a.preemptive ? 'Preemptive' : 'Non-preemptive';
    $('#algoRule').textContent = a.rule;
    $('#algoBlurb').textContent = a.blurb;
    $('#quantumField').hidden = state.algo !== 'rr';
  }

  function setAlgo(id) {
    if (ORDER.indexOf(id) < 0) return;
    state.algo = id;
    syncAlgoUI();
    recompute();
  }

  /* ---------- process tickets ---------- */
  function validity() {
    var bad = paramBad.quantum || paramBad.switchCost;
    state.procs.forEach(function (p) { if (p.bad.arrival || p.bad.burst) bad = true; });
    return !bad;
  }

  function fieldInput(p, key, label, min, max) {
    var input = h('input', {
      type: 'number', min: min, max: max, step: 1, inputmode: 'numeric',
      value: p[key], 'aria-label': 'P' + p.id + (key === 'arrival' ? ' arrival time' : ' burst time')
    });
    input.addEventListener('input', function () {
      var ok = isInt(input.value, min, max);
      p.bad[key] = !ok;
      input.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (ok) p[key] = Number(input.value);
      recompute();
    });
    input.addEventListener('change', function () {
      if (p.bad[key]) { p.bad[key] = false; input.value = p[key]; input.setAttribute('aria-invalid', 'false'); recompute(); }
    });
    return h('label', { class: 'field' }, h('span', { text: label }), input);
  }

  function renderTickets() {
    var list = $('#procList');
    clear(list);
    state.procs.forEach(function (p) {
      list.appendChild(
        h('li', { class: 'ticket', css: { '--c': colorOf(p.id) } },
          h('div', { class: 'ticket-body' },
            h('div', { class: 'ticket-head' },
              h('strong', { text: 'P' + p.id }),
              h('button', { type: 'button', class: 'x', 'aria-label': 'Remove P' + p.id, text: '\u00d7',
                onclick: function () { removeProc(p.id); } })),
            h('div', { class: 'ticket-fields' },
              fieldInput(p, 'arrival', 'Arrives at', 0, L.maxArrival),
              fieldInput(p, 'burst', 'Runs for', 1, L.maxBurst))))
      );
    });
    $('#procCount').textContent = '(' + state.procs.length + ' of ' + L.maxProcs + ')';
    $('#emptyState').hidden = state.procs.length > 0;
    $('#addForm button[type="submit"]').disabled = state.procs.length >= L.maxProcs;
  }

  function removeProc(id) {
    state.procs = state.procs.filter(function (p) { return p.id !== id; });
    renderTickets();
    recompute();
  }

  function addProc(arrival, burst) {
    if (state.procs.length >= L.maxProcs) return false;
    state.procs.push({ id: state.nextId++, arrival: arrival, burst: burst, bad: {} });
    renderTickets();
    recompute();
    return true;
  }

  /* ---------- compute + render ---------- */
  function recompute() {
    stop();
    var ok = validity();
    $('#errorBanner').hidden = ok;
    $('#results').classList.toggle('stale', !ok);
    if (!ok) return;

    save();
    var empty = state.procs.length === 0;
    $('#results').hidden = empty;
    if (empty) { result = null; all = []; return; }

    var input = state.procs.map(function (p) { return { id: p.id, arrival: p.arrival, burst: p.burst }; });
    var opts = { quantum: state.quantum, switchCost: state.switchCost };
    result = simulate(input, state.algo, opts);
    all = ORDER.map(function (a) { return { algo: a, res: simulate(input, a, opts) }; });

    pos = result.total;
    shownCur = -1;
    renderGantt();
    renderStats();
    renderTable();
    renderLog();
    renderCompare();
    var scrub = $('#scrub');
    scrub.max = result.total;
    updateCursor(true);
    updateTransport();
    $('#tapeSub').textContent = ALGORITHMS[state.algo].name +
      (state.algo === 'rr' ? ', quantum ' + state.quantum : '') +
      (state.switchCost ? ', switch cost ' + state.switchCost : '') +
      ': finishes at t = ' + result.total;
  }

  function renderGantt() {
    var total = result.total;
    $('#gantt').style.setProperty('--units', total);
    var track = $('#track');
    clear(track);
    result.segments.forEach(function (s) {
      var row = s.kind === 'run' ? result.rows[s.run] : null;
      var label = s.kind === 'run' ? row.name : (s.kind === 'cs' ? 'cs' : 'idle');
      var desc = (s.kind === 'run' ? row.name + ' runs' : s.kind === 'cs' ? 'Context switch' : 'CPU idle') +
        ' from ' + s.start + ' to ' + s.end;
      track.appendChild(h('div', {
        class: 'seg ' + (s.kind === 'run' ? 'run' : s.kind), title: desc, 'aria-label': desc,
        css: Object.assign({ left: (s.start / total * 100) + '%', width: ((s.end - s.start) / total * 100) + '%' },
          row ? { '--c': colorOf(row.id) } : {}),
        text: label
      }));
    });
    var axis = $('#axis');
    clear(axis);
    var step = total <= 34 ? 1 : total <= 70 ? 2 : Math.ceil(total / 34);
    for (var t = 0; t <= total; t += step) axis.appendChild(h('span', { class: 'tick', css: { left: (t / total * 100) + '%' }, text: t }));
    if (total % step !== 0) axis.appendChild(h('span', { class: 'tick', css: { left: '100%' }, text: total }));
  }

  function renderStats() {
    var m = result.metrics;
    var items = [
      ['Average waiting time', fmt(round2(m.avgWaiting)), '', 'Time a process spends in line before and between its turns.'],
      ['Average turnaround time', fmt(round2(m.avgTurnaround)), '', 'From arriving to finishing, on average.'],
      ['Average response time', fmt(round2(m.avgResponse)), '', 'From arriving to getting the CPU for the first time.'],
      ['CPU busy', fmt(round2(m.utilization)), '%', 'Share of the time the CPU was doing real work.'],
      ['Throughput', fmt(round2(m.throughput)), ' jobs per unit', 'How many processes finish per unit of time.'],
      ['Context switches', String(m.switches), '', 'Times the CPU changed from one process to another.']
    ];
    var dl = $('#stats');
    clear(dl);
    items.forEach(function (it) {
      dl.appendChild(h('div', { class: 'stat' },
        h('dd', { class: 'val' }, it[1], it[2] ? h('small', { text: it[2] }) : null),
        h('dt', { text: it[0] }),
        h('dd', { class: 'hint', text: it[3] })));
    });
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  function renderTable() {
    var t = $('#resultTable');
    clear(t);
    var heads = ['Process', 'Arrival', 'Burst', 'Finished at', 'Turnaround', 'Waiting', 'Response'];
    t.appendChild(h('thead', {}, h('tr', {}, heads.map(function (x) { return h('th', { scope: 'col', text: x }); }))));
    var body = h('tbody');
    result.rows.forEach(function (r) {
      body.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'pid', css: { '--c': colorOf(r.id) } }, h('i'), r.name)),
        h('td', { text: r.arrival }), h('td', { text: r.burst }), h('td', { text: r.completion }),
        h('td', { text: r.turnaround }), h('td', { text: r.waiting }), h('td', { text: r.response })));
    });
    t.appendChild(body);
    var m = result.metrics;
    t.appendChild(h('tfoot', {}, h('tr', {},
      h('td', { text: 'Average' }), h('td'), h('td'), h('td'),
      h('td', { text: fmt(round2(m.avgTurnaround)) }), h('td', { text: fmt(round2(m.avgWaiting)) }),
      h('td', { text: fmt(round2(m.avgResponse)) }))));
  }

  var logItems = [];
  function renderLog() {
    var ol = $('#logList');
    clear(ol);
    logItems = result.events.map(function (e) {
      var li = h('li', { class: e.type },
        h('button', { type: 'button', onclick: function () { stop(); seek(e.t); } },
          h('span', { class: 'when', text: 't=' + e.t }),
          h('span', { text: e.text })));
      ol.appendChild(li);
      return { t: e.t, el: li };
    });
  }
  function markLog(cur) {
    var latest = null;
    logItems.forEach(function (it) {
      var past = it.t <= cur;
      it.el.classList.toggle('past', past);
      it.el.classList.remove('latest');
      if (past) latest = it;
    });
    if (latest) latest.el.classList.add('latest');
  }

  function renderCompare() {
    var rows = all;
    var keys = [
      ['avgWaiting', 'Avg waiting', true], ['avgTurnaround', 'Avg turnaround', true],
      ['avgResponse', 'Avg response', true], ['switches', 'Switches', true], ['utilization', 'CPU use %', false]
    ];
    var best = {};
    keys.forEach(function (k) {
      var vals = rows.map(function (r) { return round2(r.res.metrics[k[0]]); });
      best[k[0]] = k[2] ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    });
    var maxOf = {};
    keys.forEach(function (k) { maxOf[k[0]] = Math.max.apply(null, rows.map(function (r) { return r.res.metrics[k[0]]; })) || 1; });

    var t = $('#compareTable');
    clear(t);
    t.appendChild(h('thead', {}, h('tr', {}, [h('th', { scope: 'col', text: 'Algorithm' })].concat(
      keys.map(function (k) { return h('th', { scope: 'col', text: k[1] }); }),
      [h('th', { scope: 'col', text: 'Finishes at' })]))));
    var body = h('tbody');
    rows.forEach(function (r) {
      var tr = h('tr', { class: r.algo === state.algo ? 'current' : '' });
      tr.appendChild(h('td', {}, h('strong', { text: ALGORITHMS[r.algo].short }), r.algo === state.algo ? h('span', { class: 'badge', text: 'selected' }) : null));
      keys.forEach(function (k) {
        var v = r.res.metrics[k[0]];
        var isBest = round2(v) === best[k[0]];
        var share = clamp(v / maxOf[k[0]] * 100, 0, 100);
        tr.appendChild(h('td', { class: isBest ? 'best' : '' }, fmt(round2(v)),
          h('span', { class: 'cell-bar' }, h('i', { css: { width: share + '%' } }))));
      });
      tr.appendChild(h('td', { text: r.res.total }));
      body.appendChild(tr);
    });
    t.appendChild(body);

    $('#compareNote').textContent = 'Same processes, same switch cost' +
      (state.quantum ? ', Round Robin quantum ' + state.quantum : '') + '. Green marks the best value in each column.';

    var v = $('#verdicts');
    clear(v);
    function winners(key, lowest) {
      var target = best[key];
      return rows.filter(function (r) { return round2(r.res.metrics[key]) === target; })
        .map(function (r) { return ALGORITHMS[r.algo].short; }).join(' and ');
    }
    v.appendChild(h('li', { text: 'Lowest average waiting: ' + winners('avgWaiting') + ' (' + fmt(best.avgWaiting) + ').' }));
    v.appendChild(h('li', { text: 'Lowest average response: ' + winners('avgResponse') + ' (' + fmt(best.avgResponse) + ').' }));
    v.appendChild(h('li', { text: 'Fewest context switches: ' + winners('switches') + ' (' + fmt(best.switches) + ').' }));
  }

  /* ---------- live state ---------- */
  function token(row, extra, faded) {
    return h('span', { class: 'token' + (faded ? ' faded' : ''), css: { '--c': colorOf(row.id) } }, row.name,
      extra != null ? h('small', { text: extra }) : null);
  }
  function none(text) { return h('span', { class: 'none', text: text }); }

  function renderLive(cur) {
    var rows = result.rows, total = result.total;
    var snap = cur < total ? result.ticks[cur] : null;
    $('#liveT').textContent = cur;

    var statusText;
    if (!snap) statusText = 'All processes have finished at t = ' + total + '.';
    else if (snap.kind === 'run') statusText = rows[snap.run].name + ' is using the CPU (' + snap.remaining[snap.run] + ' of ' + rows[snap.run].burst + ' units left).';
    else if (snap.kind === 'cs') statusText = 'The CPU is switching to ' + rows[snap.next].name + ', so no work gets done this unit.';
    else statusText = 'The CPU has nothing to run right now.';
    var last = null;
    result.events.forEach(function (e) { if (e.t <= cur) last = e; });
    var nar = $('#narrate');
    clear(nar);
    nar.appendChild(h('span', { text: statusText }));
    nar.appendChild(h('span', { text: last ? 'Latest decision (t = ' + last.t + '): ' + last.text + '.' : 'Press play to start.' }));

    var core = $('#cpuCore');
    clear(core);
    core.className = 'cpu-core';
    core.style.removeProperty('--c');
    if (!snap) {
      core.classList.add('done');
      core.appendChild(h('span', { class: 'cpu-big', text: 'Done' }));
      core.appendChild(h('span', { class: 'cpu-meta', text: 'Nothing left to run.' }));
    } else if (snap.kind === 'run') {
      var r = rows[snap.run];
      core.classList.add('run');
      core.style.setProperty('--c', colorOf(r.id));
      core.appendChild(h('span', { class: 'cpu-big', text: r.name }));
      var meta = h('span', { class: 'cpu-meta' },
        h('span', { text: snap.remaining[snap.run] + ' of ' + r.burst + ' units left' }),
        h('span', { class: 'bar' }, h('i', { css: { width: ((r.burst - snap.remaining[snap.run]) / r.burst * 100) + '%' } })));
      if (snap.quantumLeft != null) meta.appendChild(h('span', { text: 'Turn ends in ' + snap.quantumLeft + (snap.quantumLeft === 1 ? ' unit' : ' units') }));
      core.appendChild(meta);
    } else if (snap.kind === 'cs') {
      core.classList.add('cs');
      core.appendChild(h('span', { class: 'cpu-big', text: 'Switching' }));
      core.appendChild(h('span', { class: 'cpu-meta', text: 'Loading ' + rows[snap.next].name + '.' }));
    } else {
      core.classList.add('idle');
      core.appendChild(h('span', { class: 'cpu-big', text: 'Idle' }));
      core.appendChild(h('span', { class: 'cpu-meta', text: 'Nothing is ready.' }));
    }

    var q = $('#queueLane');
    clear(q);
    if (snap && snap.queue.length) {
      snap.queue.forEach(function (i) { q.appendChild(token(rows[i], snap.remaining[i] + ' left')); });
    } else q.appendChild(none('Empty'));
    $('#queueHint').textContent = state.algo === 'rr' ? 'next up is on the left' :
      state.algo === 'fcfs' ? 'first to arrive goes first' : state.algo === 'sjf' ? 'shortest job goes first' : 'least time left goes first';

    var f = $('#futureLane'), d = $('#doneLane');
    clear(f); clear(d);
    var fut = rows.filter(function (r) { return r.arrival > cur; });
    var fin = rows.filter(function (r) { return r.completion <= cur; });
    if (fut.length) fut.forEach(function (r) { f.appendChild(token(r, 'at ' + r.arrival, true)); }); else f.appendChild(none('None'));
    if (fin.length) fin.forEach(function (r) { d.appendChild(token(r, 'at ' + r.completion)); }); else d.appendChild(none('None'));

    var pg = $('#progress');
    clear(pg);
    rows.forEach(function (r) {
      var rem = snap ? snap.remaining[r.idx] : 0;
      var st;
      if (r.completion <= cur) st = 'finished';
      else if (r.arrival > cur) st = 'not arrived';
      else if (snap && snap.kind === 'run' && snap.run === r.idx) st = 'running';
      else if (snap && snap.kind === 'cs' && snap.next === r.idx) st = 'next up';
      else st = 'waiting';
      pg.appendChild(h('li', { class: st === 'running' ? 'is-run' : '', css: { '--c': colorOf(r.id) } },
        h('b', { text: r.name }),
        h('span', { class: 'bar' }, h('i', { css: { width: ((r.burst - rem) / r.burst * 100) + '%' } })),
        h('span', { class: 'st', text: st })));
    });
  }

  /* ---------- playback ---------- */
  function updateCursor(force) {
    if (!result) return;
    var total = result.total;
    var cur = Math.min(Math.floor(pos + 1e-9), total);
    var pct = (pos / total * 100) + '%';
    $('#playhead').style.left = pct;
    $('#mask').style.left = pct;
    if (force || cur !== shownCur) {
      shownCur = cur;
      renderLive(cur);
      markLog(cur);
      $('#scrub').value = cur;
      $('#clock').textContent = 't = ' + cur + ' of ' + total;
    }
    if (playing) keepVisible();
  }

  function keepVisible() {
    var sc = $('#ganttScroll'), g = $('#gantt');
    var x = pos / result.total * (g.scrollWidth - 36) + 18;
    if (x < sc.scrollLeft + 24 || x > sc.scrollLeft + sc.clientWidth - 48) sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2);
  }

  var ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  function updateTransport() {
    var b = $('#bPlay');
    b.innerHTML = playing ? ICON_PAUSE : ICON_PLAY; // static markup, no user data
    b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    var has = !!result;
    ['bReset', 'bBack', 'bPlay', 'bFwd', 'bEnd', 'scrub'].forEach(function (id) { $('#' + id).disabled = !has; });
  }

  function frame(now) {
    var dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    pos = Math.min(result.total, pos + dt * BASE_RATE * speed);
    updateCursor();
    if (pos >= result.total) { stop(); return; }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (!result) return;
    if (pos >= result.total) { pos = 0; shownCur = -1; }
    playing = true;
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
    updateTransport();
  }
  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    if (result) updateTransport();
  }
  function seek(t) {
    if (!result) return;
    pos = clamp(Math.round(t), 0, result.total);
    updateCursor(true);
    keepVisible();
  }
  function step(d) { stop(); seek(Math.floor(pos + 1e-9) + d); }

  /* ---------- actions ---------- */
  function shareLink() {
    var p = plain();
    var payload = b64urlEncode(JSON.stringify({ a: p.algo, q: p.quantum, c: p.switchCost, p: p.procs }));
    var url = location.href.split('#')[0] + '#s=' + payload;
    function done() { toast('Link copied'); }
    function fallback() {
      var ta = h('textarea', { 'aria-hidden': 'true', readonly: true });
      ta.value = url;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? done() : toast('Copy failed'); } catch (e) { toast('Copy failed'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
    else fallback();
  }

  function downloadCsv() {
    if (!result) { toast('Add a process first'); return; }
    var lines = ['Process,Arrival,Burst,Completion,Turnaround,Waiting,Response'];
    result.rows.forEach(function (r) {
      lines.push([r.name, r.arrival, r.burst, r.completion, r.turnaround, r.waiting, r.response].join(','));
    });
    var m = result.metrics;
    lines.push('');
    lines.push('Algorithm,' + ALGORITHMS[state.algo].name);
    if (state.algo === 'rr') lines.push('Time quantum,' + state.quantum);
    lines.push('Switch cost,' + state.switchCost);
    lines.push('Average turnaround,' + round2(m.avgTurnaround));
    lines.push('Average waiting,' + round2(m.avgWaiting));
    lines.push('Average response,' + round2(m.avgResponse));
    lines.push('CPU utilization %,' + round2(m.utilization));
    lines.push('Throughput,' + round2(m.throughput));
    lines.push('Context switches,' + m.switches);
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'schedulr-' + state.algo + '.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function randomSet() {
    var n = 3 + Math.floor(Math.random() * 5);
    var pairs = [];
    for (var i = 0; i < n; i++) pairs.push([Math.floor(Math.random() * 11), 1 + Math.floor(Math.random() * 9)]);
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    setProcs(pairs);
    renderTickets();
    recompute();
  }

  function setTab(name) {
    state.tab = name;
    $$('#detailTabs [role="tab"]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    ['table', 'log', 'compare'].forEach(function (n) { $('#panel-' + n).hidden = n !== name; });
  }

  /* ---------- wiring ---------- */
  function bindParam(id, key, min, max) {
    var input = $('#' + id);
    input.addEventListener('input', function () {
      var ok = isInt(input.value, min, max);
      paramBad[key] = !ok;
      input.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (ok) state[key] = Number(input.value);
      recompute();
    });
    input.addEventListener('change', function () {
      if (paramBad[key]) { paramBad[key] = false; input.value = state[key]; input.setAttribute('aria-invalid', 'false'); recompute(); }
    });
  }

  function init() {
    var init0 = readInitial();
    state.algo = init0.algo; state.quantum = init0.quantum; state.switchCost = init0.switchCost;
    setProcs(init0.procs);
    $('#quantum').value = state.quantum;
    $('#switchCost').value = state.switchCost;


    var tabs = $$('#algoTabs button');
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { setAlgo(b.getAttribute('data-algo')); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var nb = tabs[(i + d + tabs.length) % tabs.length];
        nb.focus();
        setAlgo(nb.getAttribute('data-algo'));
      });
    });

    var dtabs = $$('#detailTabs [role="tab"]');
    dtabs.forEach(function (b, i) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var nb = dtabs[(i + d + dtabs.length) % dtabs.length];
        nb.focus();
        setTab(nb.getAttribute('data-tab'));
      });
    });

    bindParam('quantum', 'quantum', 1, L.maxQuantum);
    bindParam('switchCost', 'switchCost', 0, L.maxSwitchCost);

    $('#preset').addEventListener('change', function (e) {
      var p = PRESETS[e.target.value];
      if (!p) return;
      setProcs(p.procs);
      if (p.algo) { state.algo = p.algo; syncAlgoUI(); }
      if (p.algo === 'rr') { state.quantum = 2; $('#quantum').value = 2; }
      e.target.value = '';
      renderTickets();
      recompute();
      toast('Scenario loaded');
    });

    $('#addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var a = $('#addArrival'), b = $('#addBurst'), msg = $('#formMsg');
      var okA = isInt(a.value, 0, L.maxArrival), okB = isInt(b.value, 1, L.maxBurst);
      a.setAttribute('aria-invalid', okA ? 'false' : 'true');
      b.setAttribute('aria-invalid', okB ? 'false' : 'true');
      if (!okA || !okB) { msg.textContent = 'Arrival must be a whole number from 0 to 99 and burst from 1 to 99.'; return; }
      if (state.procs.length >= L.maxProcs) { msg.textContent = 'You can add up to ' + L.maxProcs + ' processes.'; return; }
      msg.textContent = '';
      addProc(Number(a.value), Number(b.value));
      b.focus();
      b.select();
    });

    $('#randomBtn').addEventListener('click', randomSet);
    $('#clearBtn').addEventListener('click', function () { state.procs = []; state.nextId = 1; renderTickets(); recompute(); });
    $('#shareBtn').addEventListener('click', shareLink);
    $('#csvBtn').addEventListener('click', downloadCsv);

    $('#bPlay').addEventListener('click', function () { playing ? stop() : play(); });
    $('#bReset').addEventListener('click', function () { stop(); seek(0); });
    $('#bEnd').addEventListener('click', function () { stop(); seek(result.total); });
    $('#bBack').addEventListener('click', function () { step(-1); });
    $('#bFwd').addEventListener('click', function () { step(1); });
    $('#scrub').addEventListener('input', function (e) { stop(); seek(Number(e.target.value)); });
    $('#speed').addEventListener('change', function (e) { speed = Number(e.target.value) || 1; });

    document.addEventListener('keydown', function (e) {
      if (!result || e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.key === ' ') { e.preventDefault(); playing ? stop() : play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); stop(); seek(0); }
      else if (e.key === 'End') { e.preventDefault(); stop(); seek(result.total); }
    });

    syncAlgoUI();
    setTab('table');
    renderTickets();
    recompute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
