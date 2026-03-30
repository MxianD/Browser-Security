/**
 * Shared by main thread and Worker: hex, Stratum prevhash → 32-byte little-endian block header bytes.
 */
(function (g) {
  function hexToBytes(hex) {
    const h = String(hex).replace(/\s+/g, "");
    if (h.length % 2 !== 0) throw new Error("hex length must be even");
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

  /** Stratum prevhash (big-endian display order, 32-byte hex) → prevhash byte order inside block header */
  function stratumPrevhashToLE(hex64) {
    const b = hexToBytes(hex64);
    if (b.length !== 32) throw new Error("prevhash must be 32 bytes");
    const c = new Uint8Array(b);
    c.reverse();
    return c;
  }

  g.StratumUtils = { hexToBytes, bytesToHex, stratumPrevhashToLE };
})(typeof self !== "undefined" ? self : this);
