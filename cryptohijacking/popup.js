async function loadState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    document.getElementById("content").textContent = "No active tab.";
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "GET_STATE" }, (stateByFrame) => {
    if (chrome.runtime.lastError) {
      document.getElementById("content").innerHTML =
        "<div class='row'>No data for this page yet.</div>";
      return;
    }
    render(stateByFrame);
  });
}

function mitigationText(state) {
  if (state.blockedWebSocket) return "block new WebSocket + Worker";
  if (state.blockedWorkers) return "block new Worker";
  return "none";
}

function render(stateByFrame) {
  const el = document.getElementById("content");

  if (!stateByFrame || Object.keys(stateByFrame).length === 0) {
    el.innerHTML = "<div class='row'>No data for this page yet.</div>";
    return;
  }

  const frames = Object.values(stateByFrame).sort((a, b) => {
    return (a.frameId ?? 0) - (b.frameId ?? 0);
  });

  el.innerHTML = frames
    .map((state) => {
      const statusClass = state.status === "suspicious" ? "bad" : "good";
      return `
        <div class="section">
          <div class="row"><span class="label">Frame ID:</span> ${state.frameId ?? 0}</div>
          <div class="row"><span class="label">Frame URL:</span> <span class="mono">${state.frameUrl || state.tabUrl || ""}</span></div>
          <div class="row"><span class="label">In iframe:</span> ${state.inFrame ? "yes" : "no"}</div>
          <div class="row"><span class="label">Status:</span> <span class="${statusClass}">${state.status}</span></div>
          <div class="row"><span class="label">Reason:</span> ${state.reason}</div>
          <div class="row"><span class="label">Score:</span> ${state.score}</div>

          <div class="section">
            <div class="row"><span class="label">Live workers:</span> ${state.liveWorkerCount ?? 0}</div>
            <div class="row"><span class="label">Total created:</span> ${state.workerCreateCount ?? 0}</div>
            <div class="row"><span class="label">Worker churn:</span> ${state.workerChurnCount ?? 0}</div>
            <div class="row"><span class="label">High drift count:</span> ${state.highDriftCount ?? 0}</div>
            <div class="row"><span class="label">Wasm count:</span> ${state.wasmCount ?? 0}</div>
            <div class="row"><span class="label">WebSocket count:</span> ${state.websocketCount ?? 0}</div>
            <div class="row"><span class="label">Fetch count:</span> ${state.fetchCount ?? 0}</div>
            <div class="row"><span class="label">XHR count:</span> ${state.xhrCount ?? 0}</div>
          </div>

          <div class="section">
            <div class="row"><span class="label">Worker source:</span> <span class="mono">${state.lastWorkerSource || "none"}</span></div>
            <div class="row"><span class="label">WebSocket endpoint:</span> <span class="mono">${state.lastWebSocket || "none"}</span></div>
            <div class="row"><span class="label">Last fetch URL:</span> <span class="mono">${state.lastFetchUrl || "none"}</span></div>
            <div class="row"><span class="label">Last XHR URL:</span> <span class="mono">${state.lastXhrUrl || "none"}</span></div>
            <div class="row"><span class="label">Origin:</span> <span class="mono">${state.originClass || "unknown"}</span></div>
          </div>

          <div class="section">
            <div class="row"><span class="label">Mitigation:</span> ${mitigationText(state)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

loadState();