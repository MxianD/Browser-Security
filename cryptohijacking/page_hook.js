(() => {
  console.log("[DEMO] page_hook.js injected", {
    href: location.href,
    inFrame: window.self !== window.top
  });

  const state = {
    score: 0,
    status: "benign",
    reason: "none",

    // ---- compute / execution ----
    workerCreateCount: 0,
    liveWorkerCount: 0,
    workerChurnCount: 0,
    lastWorkerCreateTs: 0,

    wasmCount: 0,
    websocketCount: 0,
    highDriftCount: 0,

    // ---- network / communication ----
    fetchCount: 0,
    xhrCount: 0,
    networkAfterCompute: false,

    // ---- last seen artifacts ----
    lastWorkerSource: "",
    lastWebSocket: "",
    lastFetchUrl: "",
    lastXhrUrl: "",

    // ---- context ----
    originClass: location.origin,
    frameUrl: location.href,
    inFrame: window.self !== window.top,

    // ---- mitigation ----
    blockedWorkers: false,
    blockedWebSocket: false,
    mitigationApplied: false
  };

  // Keep references to live workers so we can actively terminate them
  const liveWorkers = new Set();

  function terminateAllWorkers() {
    for (const w of liveWorkers) {
      try {
        w.terminate();
      } catch (_) {}
    }
    liveWorkers.clear();
    state.liveWorkerCount = 0;
    console.warn("[DEMO] terminated all active workers", { frame: location.href });
  }

  function recomputeStatus(reason = "none") {
    let score = 0;

    const heavyCompute =
      state.liveWorkerCount >= 4 || state.workerCreateCount >= 4;

    const repeatedNetwork =
      state.fetchCount >= 2 || state.xhrCount >= 2 || state.websocketCount >= 1;

    // ---- Stage 1: compute is only weak evidence ----
    if (heavyCompute) score += 1;
    if (state.workerChurnCount >= 2) score += 1;

    // ---- Context matters more than raw compute ----
    if (state.inFrame && heavyCompute) score += 2;

    // ---- Supporting signals ----
    if (state.highDriftCount >= 1) score += 1;
    if (state.wasmCount >= 1) score += 1;

    // ---- Escalate only when repeated communication appears after compute ----
    if (heavyCompute && repeatedNetwork) score += 2;
    if (state.networkAfterCompute && repeatedNetwork) score += 1;

    // ---- Soft hint only ----
    if (state.lastWorkerSource && state.lastWorkerSource.includes("worker")) {
      score += 1;
    }

    state.score = score;
    state.status = score >= 6 ? "suspicious" : "benign";
    state.reason = state.status === "suspicious" ? reason : "none";

    // Higher threshold for mitigation than for alerting
    state.blockedWorkers = score >= 8;
    state.blockedWebSocket = score >= 9;

    // Apply mitigation once: stop existing workers
    if (state.blockedWorkers && !state.mitigationApplied) {
      terminateAllWorkers();
      state.mitigationApplied = true;
    }

    window.postMessage(
      {
        source: "cryptojack-demo",
        state: { ...state }
      },
      "*"
    );
  }

  // ---- Worker hook (live + cumulative + churn) ----
  const OriginalWorker = window.Worker;
  if (OriginalWorker) {
    window.Worker = function (...args) {
      const workerSource = String(args[0] || "");
      state.lastWorkerSource = workerSource;

      if (state.blockedWorkers) {
        console.warn("[DEMO] blocked new Worker:", workerSource, "frame =", location.href);
        throw new Error("Blocked suspicious Worker creation");
      }

      const w = new OriginalWorker(...args);
      liveWorkers.add(w);

      state.workerCreateCount += 1;
      state.liveWorkerCount += 1;

      const now = performance.now();
      if (state.lastWorkerCreateTs > 0 && (now - state.lastWorkerCreateTs) < 5000) {
        state.workerChurnCount += 1;
        console.log("[DEMO] Worker churn detected", {
          churn: state.workerChurnCount,
          frame: location.href
        });
      }
      state.lastWorkerCreateTs = now;

      console.log("[DEMO] Worker created:", {
        live: state.liveWorkerCount,
        total: state.workerCreateCount,
        source: workerSource,
        frame: location.href
      });

      recomputeStatus("parallel compute observed");

      const originalTerminate = w.terminate;
      w.terminate = function (...targs) {
        liveWorkers.delete(w);
        state.liveWorkerCount = Math.max(0, state.liveWorkerCount - 1);

        console.log("[DEMO] Worker terminated:", {
          live: state.liveWorkerCount,
          frame: location.href
        });

        recomputeStatus("worker terminated");
        return originalTerminate.apply(this, targs);
      };

      return w;
    };

    window.Worker.prototype = OriginalWorker.prototype;
  }

  // ---- Main-thread blocking / drift ----
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const drift = now - last - 1000;
    last = now;

    if (drift > 500) {
      state.highDriftCount += 1;
      console.log("[DEMO] High drift =", drift.toFixed(1), "ms", "frame =", location.href);
      recomputeStatus("persistent heavy computation");
    }
  }, 1000);

  // ---- WebAssembly hook ----
  if (window.WebAssembly && window.WebAssembly.instantiate) {
    const originalInstantiate = window.WebAssembly.instantiate;
    window.WebAssembly.instantiate = async function (...args) {
      state.wasmCount += 1;
      console.log("[DEMO] WebAssembly.instantiate called", "frame =", location.href);
      recomputeStatus("WebAssembly activity");
      return originalInstantiate.apply(this, args);
    };
  }

  if (window.WebAssembly && window.WebAssembly.instantiateStreaming) {
    const originalInstantiateStreaming = window.WebAssembly.instantiateStreaming;
    window.WebAssembly.instantiateStreaming = async function (...args) {
      state.wasmCount += 1;
      console.log("[DEMO] WebAssembly.instantiateStreaming called", "frame =", location.href);
      recomputeStatus("WebAssembly activity");
      return originalInstantiateStreaming.apply(this, args);
    };
  }

  // ---- WebSocket hook ----
  const OriginalWebSocket = window.WebSocket;
  if (OriginalWebSocket) {
    window.WebSocket = function (...args) {
      const url = String(args[0] || "");
      state.lastWebSocket = url;

      if (state.blockedWebSocket) {
        console.warn("[DEMO] blocked WebSocket:", url, "frame =", location.href);
        throw new Error("Blocked suspicious WebSocket");
      }

      state.websocketCount += 1;

      if (state.workerCreateCount >= 4 || state.liveWorkerCount >= 4) {
        state.networkAfterCompute = true;
      }

      console.log("[DEMO] WebSocket opened:", url, "frame =", location.href);
      recomputeStatus("network activity after compute");
      return new OriginalWebSocket(...args);
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
  }

  // ---- fetch hook ----
  const OriginalFetch = window.fetch;
  if (OriginalFetch) {
    window.fetch = async function (...args) {
      let url = "";
      try {
        const input = args[0];
        if (typeof input === "string") {
          url = input;
        } else if (input && typeof input.url === "string") {
          url = input.url;
        }
      } catch (_) {}

      let absUrl = "";
      try {
        absUrl = url ? new URL(url, location.href).href : "";
      } catch (_) {
        absUrl = String(url || "");
      }

      state.fetchCount += 1;
      state.lastFetchUrl = absUrl;

      if (state.workerCreateCount >= 4 || state.liveWorkerCount >= 4) {
        state.networkAfterCompute = true;
      }

      console.log("[DEMO] fetch observed", {
        url: absUrl,
        frame: location.href,
        count: state.fetchCount
      });

      recomputeStatus("network activity after compute");
      return OriginalFetch.apply(this, args);
    };
  }

  // ---- XHR hook ----
  const OriginalXHROpen = XMLHttpRequest.prototype.open;
  const OriginalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__demoUrl = "";
    try {
      this.__demoUrl = new URL(String(url || ""), location.href).href;
    } catch (_) {
      this.__demoUrl = String(url || "");
    }
    return OriginalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    state.xhrCount += 1;
    state.lastXhrUrl = this.__demoUrl || "";

    if (state.workerCreateCount >= 4 || state.liveWorkerCount >= 4) {
      state.networkAfterCompute = true;
    }

    console.log("[DEMO] xhr observed", {
      url: state.lastXhrUrl,
      frame: location.href,
      count: state.xhrCount
    });

    recomputeStatus("network activity after compute");
    return OriginalXHRSend.apply(this, args);
  };

  recomputeStatus();
})();