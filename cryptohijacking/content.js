(() => {
  console.log("[DEMO] content.js loaded", {
    href: location.href,
    inFrame: window.self !== window.top
  });

  function injectScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page_hook.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  function showWarning(state) {
    let box = document.getElementById("cryptojack-warning-box");
    if (!box) {
      box = document.createElement("div");
      box.id = "cryptojack-warning-box";
      box.style.position = "fixed";
      box.style.top = "16px";
      box.style.right = "16px";
      box.style.zIndex = "2147483647";
      box.style.background = "#b00020";
      box.style.color = "white";
      box.style.padding = "12px 14px";
      box.style.borderRadius = "8px";
      box.style.fontSize = "14px";
      box.style.fontFamily = "Arial, sans-serif";
      box.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
      box.style.maxWidth = "360px";
      document.documentElement.appendChild(box);
    }

    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">Possible cryptojacking detected</div>
      <div style="font-size:13px;"><b>Frame:</b> ${state.inFrame ? "iframe" : "top"}</div>
      <div style="font-size:13px;"><b>Reason:</b> ${state.reason}</div>
      <div style="font-size:13px;"><b>Score:</b> ${state.score}</div>
      <div style="font-size:13px;"><b>Live workers:</b> ${state.liveWorkerCount ?? 0}</div>
      <div style="font-size:13px;"><b>WebSocket:</b> ${state.lastWebSocket || "none"}</div>
      <div style="font-size:13px;"><b>Worker source:</b> ${state.lastWorkerSource || "unknown"}</div>
      <div style="font-size:12px; margin-top:6px;">Open popup for full details.</div>
    `;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "cryptojack-demo") return;

    const state = event.data.state;

    chrome.runtime.sendMessage({
      type: "UPDATE_STATE",
      state
    });

    if (state.status === "suspicious") {
      showWarning(state);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATE") {
      chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
        sendResponse(state);
      });
      return true;
    }
  });

  injectScript();
})();