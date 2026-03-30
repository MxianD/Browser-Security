/**
 * Embedded mining worker for attack lab (local PoW, no pool).
 * For authorized cryptojacking demos only.
 */
importScripts("../sha256.min.js");

const sha256 = self.sha256;

function dsha256(header80) {
  const mid = sha256.arrayBuffer(header80);
  return new Uint8Array(sha256.arrayBuffer(new Uint8Array(mid)));
}

function leadingZeroBits(hash) {
  let bits = 0;
  for (let i = 0; i < 32; i++) {
    const b = hash[i];
    if (b === 0) {
      bits += 8;
      continue;
    }
    for (let j = 7; j >= 0; j--) {
      if ((b >> j) & 1) return bits;
      bits++;
    }
    break;
  }
  return bits;
}

let active = false;

self.onmessage = function (e) {
  if (e.data.cmd === "start") {
    const intensity = Math.max(1, Math.min(8, e.data.intensity | 0));
    const workerId = e.data.workerId | 0;
    active = true;

    const header = new Uint8Array(80);
    const dv = new DataView(header.buffer);
    crypto.getRandomValues(header.subarray(0, 72));
    dv.setUint32(72, workerId, true);

    const targetBits = Math.min(24, intensity + 6);
    let nonce = 0;
    let total = 0;
    let lastT = performance.now();
    let lastTotal = 0;
    const inner = 120 * intensity;
    const yieldMs = Math.max(0, 12 - intensity);

    function tick() {
      if (!active) return;
      for (let i = 0; i < inner; i++) {
        dv.setUint32(76, nonce, true);
        dsha256(header);
        total++;
        nonce = (nonce + 1) >>> 0;
      }
      const now = performance.now();
      if (now - lastT >= 400) {
        const dt = (now - lastT) / 1000;
        const rate = (total - lastTotal) / dt;
        self.postMessage({ type: "tick", total, rate, workerId });
        lastTotal = total;
        lastT = now;
      }
      setTimeout(tick, yieldMs);
    }
    tick();
  } else if (e.data.cmd === "stop") {
    active = false;
  }
};
