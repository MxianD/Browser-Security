/**
 * 主线程与 Worker 共用：hex、Stratum prevhash → 区块头小端序 32 字节。
 */
(function (g) {
  function hexToBytes(hex) {
    const h = String(hex).replace(/\s+/g, "");
    if (h.length % 2 !== 0) throw new Error("hex 长度须为偶数");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function bytesToHex(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i++) {
      s += u8[i].toString(16).padStart(2, "0");
    }
    return s;
  }

  /** Stratum 的 prevhash（大端展示序 32 字节 hex）→ 区块头内的 prevhash 字节序 */
  function stratumPrevhashToLE(hex64) {
    const b = hexToBytes(hex64);
    if (b.length !== 32) throw new Error("prevhash 须为 32 字节");
    const c = new Uint8Array(b);
    c.reverse();
    return c;
  }

  g.StratumUtils = { hexToBytes, bytesToHex, stratumPrevhashToLE };
})(typeof self !== "undefined" ? self : this);
