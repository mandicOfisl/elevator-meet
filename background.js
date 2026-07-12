// background.js — MV3 service worker
// Responsible for: getting a tabCapture stream id for the active Meet tab,
// and spinning up the offscreen document (service workers can't touch
// AudioContext/MediaStream themselves).
//
// IMPORTANT: chrome.offscreen.createDocument() resolves as soon as the
// document *starts* loading, not once its script has finished running and
// registered a message listener. Sending it a message right after creation
// is a race condition ("Could not establish connection. Receiving end does
// not exist."). To avoid that entirely, we pass the stream id + settings as
// URL query params, which offscreen.js reads synchronously on load — no
// messaging handshake required to get started.

async function getOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return existing[0] || null;
}

async function closeOffscreenDocumentIfExists() {
  if (await getOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

function safeSendMessage(message) {
  // Fire-and-forget to the offscreen doc. If it isn't there (e.g. settings
  // changed before Start was ever clicked), swallow the "no receiver" error
  // instead of letting it surface as an uncaught rejection.
  chrome.runtime.sendMessage(message).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages coming from the popup (they won't have a `target`
  // field the offscreen doc sets, so we can tell them apart).
  if (message.target === 'offscreen') return false;

  (async () => {
    try {
      if (message.type === 'START') {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        if (!tab || !tab.url || !tab.url.includes('meet.google.com')) {
          sendResponse({
            ok: false,
            error: 'Open a Google Meet tab and make it active first.',
          });
          return;
        }

        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tab.id,
        });

        // Always start from a clean offscreen document so there's no stale
        // AudioContext/listener state from a previous run.
        await closeOffscreenDocumentIfExists();

        const settings = message.settings || {};
        const params = new URLSearchParams({
          streamId,
          silenceThreshold: settings.silenceThreshold ?? 5,
          volumeThreshold: settings.volumeThreshold ?? 6,
          musicVolume: settings.musicVolume ?? 0.5,
          fadeInMs: settings.fadeInMs ?? 400,
          fadeOutMs: settings.fadeOutMs ?? 400,
          trackId: settings.trackId ?? 'track:1',
        });

        await chrome.offscreen.createDocument({
          url: `offscreen.html?${params.toString()}`,
          reasons: ['USER_MEDIA'],
          justification:
            'Analyze Google Meet tab audio levels and play elevator music during silence.',
        });

        await chrome.storage.local.set({ running: true, tabId: tab.id });
        sendResponse({ ok: true });
      } else if (message.type === 'STOP') {
        // Closing the offscreen document tears down its AudioContext and
        // media stream automatically — more reliable than messaging it.
        await closeOffscreenDocumentIfExists();
        await chrome.storage.local.set({ running: false });
        sendResponse({ ok: true });
      } else if (message.type === 'UPDATE_SETTINGS') {
        if (await getOffscreenDocument()) {
          safeSendMessage({
            target: 'offscreen',
            type: 'UPDATE_SETTINGS',
            settings: message.settings,
          });
        }
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
    'tabId',
    'running',
  ]);
  if (running && tabId === capturedTabId) {
    await closeOffscreenDocumentIfExists();
    await chrome.storage.local.set({ running: false });
  }
});
