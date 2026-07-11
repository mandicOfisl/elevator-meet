// background.js — MV3 service worker
// Responsible for: getting a tabCapture stream id for the active Meet tab,
// spinning up the offscreen document (service workers can't touch
// AudioContext/MediaStream themselves), and relaying settings changes.

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existing.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification:
      "Analyze Google Meet tab audio levels and play elevator music during silence.",
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages coming from the popup (they won't have a `target`
  // field the offscreen doc sets, so we can tell them apart).
  if (message.target === "offscreen") return false;

  (async () => {
    try {
      if (message.type === "START") {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        if (!tab || !tab.url || !tab.url.includes("meet.google.com")) {
          sendResponse({
            ok: false,
            error: "Open a Google Meet tab and make it active first.",
          });
          return;
        }

        await ensureOffscreenDocument();

        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tab.id,
        });

        chrome.runtime.sendMessage({
          target: "offscreen",
          type: "START_CAPTURE",
          streamId,
          settings: message.settings,
        });

        await chrome.storage.local.set({ running: true, tabId: tab.id });
        sendResponse({ ok: true });
      } else if (message.type === "STOP") {
        chrome.runtime.sendMessage({
          target: "offscreen",
          type: "STOP_CAPTURE",
        });
        await chrome.storage.local.set({ running: false });
        sendResponse({ ok: true });
      } else if (message.type === "UPDATE_SETTINGS") {
        chrome.runtime.sendMessage({
          target: "offscreen",
          type: "UPDATE_SETTINGS",
          settings: message.settings,
        });
        sendResponse({ ok: true });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // keep the message channel open for the async response
});

// If the tab being captured closes/navigates away, stop cleanly.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabId: capturedTabId, running } = await chrome.storage.local.get([
    "tabId",
    "running",
  ]);
  if (running && tabId === capturedTabId) {
    chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_CAPTURE" });
    await chrome.storage.local.set({ running: false });
  }
});
