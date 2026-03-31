const tabState = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;

  if (message.type === "UPDATE_STATE" && tabId !== undefined) {
    if (!tabState[tabId]) tabState[tabId] = {};

    tabState[tabId][frameId] = {
      tabUrl: sender.tab?.url || "",
      frameUrl: sender.url || "",
      frameId,
      ...message.state
    };

    console.log("[DEMO] state updated for tab/frame", tabId, frameId, tabState[tabId][frameId]);
  }

  if (message.type === "GET_STATE" && tabId !== undefined) {
    sendResponse(tabState[tabId] || {});
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabState[tabId];
});