importScripts("sha256.min.js", "stratum-utils.js");

const sha256 = self.sha256;
const U = self.StratumUtils;

function dsha256(u8) {
  const mid = sha256.arrayBuffer(u8);
  return new Uint8Array(sha256.arrayBuffer(new Uint8Array(mid)));
}

/** Bitcoin Stratum: difficulty 1 target */
const DIFF1_TARGET =
  0x00000000ffff0000000000000000000000000000000000000000000000000000n;

function shareTargetFromDifficulty(difficulty) {
  let d = Number(difficulty);
  if (!Number.isFinite(d) || d <= 0) d = 1;
  const SCALE = 1000000000n;
  if (d * 1e9 <= Number.MAX_SAFE_INTEGER && d * 1e9 >= 1) {
    const scaled = BigInt(Math.max(1, Math.round(d * 1e9)));
    return (DIFF1_TARGET * SCALE) / scaled;
  }
  const dInt = BigInt(Math.max(1, Math.trunc(d)));
  return DIFF1_TARGET / dInt;
}

function hashBelowTarget(hash, target) {
  let h = 0n;
  for (let i = 0; i < 32; i++) h = (h << 8n) | BigInt(hash[i]);
  return h < target;
}

/** throttle 1–10: max nonces per batch + sleep between batches to avoid pinning a core */
function batchSizeFromThrottle(t) {
  const x = Math.max(1, Math.min(10, t | 0));
  return Math.min(500, 40 + x * 48);
}

function yieldMsFromThrottle(t) {
  const x = Math.max(1, Math.min(10, t | 0));
  if (x >= 9) return 0;
  return (11 - x) * 4;
}

let active = false;

self.onmessage = function (e) {
  if (e.data.cmd === "startStratum") {
    const job = e.data.job;
    const workerId = e.data.workerId | 0;
    const numWorkers = Math.max(1, e.data.numWorkers | 1);
    const throttle = Math.max(1, Math.min(10, e.data.throttle | 0));
    const batch = batchSizeFromThrottle(throttle);
    const yieldMs = yieldMsFromThrottle(throttle);
    const shareTarget = shareTargetFromDifficulty(e.data.difficulty);
    active = true;

    const coinb1 = U.hexToBytes(job.coinb1);
    const extranonce1 = U.hexToBytes(job.extranonce1);
    const extranonce2 = U.hexToBytes(job.extranonce2Hex);
    const coinb2 = U.hexToBytes(job.coinb2);
    const branches = job.merkleBranches.map(function (h) {
      return U.hexToBytes(h);
    });
    const prevLE = U.stratumPrevhashToLE(job.prevhash);

    const coinbase = new Uint8Array(
      coinb1.length + extranonce1.length + extranonce2.length + coinb2.length
    );
    let o = 0;
    coinbase.set(coinb1, o);
    o += coinb1.length;
    coinbase.set(extranonce1, o);
    o += extranonce1.length;
    coinbase.set(extranonce2, o);
    o += extranonce2.length;
    coinbase.set(coinb2, o);

    let merkle = dsha256(coinbase);
    for (let bi = 0; bi < branches.length; bi++) {
      const pair = new Uint8Array(64);
      pair.set(merkle, 0);
      pair.set(branches[bi], 32);
      merkle = dsha256(pair);
    }

    const header = new Uint8Array(80);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, parseInt(job.version, 16) >>> 0, true);
    header.set(prevLE, 4);
    header.set(merkle, 36);
    dv.setUint32(68, parseInt(job.ntime, 16) >>> 0, true);
    dv.setUint32(72, parseInt(job.nbits, 16) >>> 0, true);

    const jobId = job.jobId || "";
    const extranonce2Hex = job.extranonce2Hex;
    const ntimeHex = job.ntime;

    let nonce = workerId >>> 0;
    let total = 0;
    let shares = 0;
    let lastT = performance.now();
    let lastTotal = 0;

    function tickSt() {
      if (!active) return;
      for (let i = 0; i < batch; i++) {
        dv.setUint32(76, nonce, true);
        const hash = dsha256(header);
        total++;
        if (hashBelowTarget(hash, shareTarget)) {
          shares++;
          self.postMessage({
            type: "stratum_share",
            workerId: workerId,
            jobId: jobId,
            extranonce2: extranonce2Hex,
            ntime: ntimeHex,
            nonce: (nonce >>> 0).toString(16).padStart(8, "0"),
          });
        }
        nonce = (nonce + numWorkers) >>> 0;
      }
      const now = performance.now();
      if (now - lastT >= 280) {
        const dt = (now - lastT) / 1000;
        const rate = (total - lastTotal) / dt;
        self.postMessage({ type: "stats", total: total, rate: rate, shares: shares, workerId: workerId });
        lastTotal = total;
        lastT = now;
      }
      setTimeout(tickSt, yieldMs);
    }
    tickSt();
  } else if (e.data.cmd === "stop") {
    active = false;
  }
};
