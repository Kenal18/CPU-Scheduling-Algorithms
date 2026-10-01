# Schedulr

An interactive CPU scheduling visualizer for **FCFS, SJF, SRTN (preemptive SJF) and Round Robin**.

- Add, edit and remove processes (arrival and burst time), or load a ready-made scenario
- Play, pause, scrub and single-step the Gantt chart
- See the CPU, ready queue, not-yet-arrived and finished processes at every tick
- Decision log explaining each choice the scheduler made
- Average turnaround, waiting and response time, CPU utilization, throughput, context switches
- Optional context-switch cost and adjustable Round Robin quantum
- "Compare all four" table on the same workload
- Shareable links, CSV export, keyboard controls, responsive layout; a quiet light design with flat pastel colours

No build step and no dependencies: plain HTML, CSS and JavaScript.

## Run locally

Open `public/index.html` in a browser, or serve the folder:

    npx serve public

## Test the scheduling engine

    npm test

The tests check hand-computed textbook results (including the classic SRTN example with average waiting time 6.5) and verify invariants on 2000 random workloads for every algorithm.

## Deploy to Vercel

**Dashboard:** push this folder to a GitHub repo, then on vercel.com choose *Add New, Project*, import the repo and press *Deploy*. `vercel.json` already sets the output directory to `public` and skips the build.

**CLI:**

    npm i -g vercel
    vercel          # preview
    vercel --prod   # production

## Project layout

    public/
      index.html          page
      css/styles.css      all styling
      js/scheduler.js     scheduling engine (pure functions, also used by the tests)
      js/app.js           UI, playback and rendering
      404.html, favicon.svg, robots.txt
    tests/scheduler.test.js
    vercel.json           output dir, security headers

## Rules the simulator follows

- Time advances in whole units. Ties are broken by arrival time, then by process number.
- SRTN preempts only when a ready job has strictly less time left than the running job.
- Round Robin: a process arriving at the same moment a quantum expires queues ahead of the preempted one.
- A context switch (costing the configured units) is charged whenever the CPU changes from one process to a different one. A lone process, or one resuming after CPU idle time, pays nothing.
- Turnaround = completion - arrival, waiting = turnaround - burst, response = first run - arrival.
- CPU utilization = busy time / total time until the last process finishes (idle gaps and switch time count against it).

To put your name in the footer, edit the `<footer class="foot">` block in `public/index.html`.
