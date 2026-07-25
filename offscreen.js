// offscreen.js — the actual audio analysis + elevator-music logic.
// Runs in a hidden offscreen document because MV3 service workers cannot
// create AudioContext / MediaStream / <audio> elements themselves.

const musicEl = document.getElementById('music');

// Must mirror PRELOADED_TRACKS in popup.js.
const PRELOADED_TRACKS = {
  'track:1': 'tracks/track-1.mp3',
  'track:2': 'tracks/track-2.mp3',
  'track:3': 'tracks/track-3.mp3',
};

let audioContext = null;
let sourceNode = null;
let passthroughGain = null;
let analyser = null;
let dataArray = null;
let monitorIntervalId = null;
let mediaStream = null;

let silenceStartedAt = null; // ms timestamp, or null if currently "talking"
let musicIsPlaying = false;
let fadeIntervalId = null;
let currentTrackId = null;

// Defaults — overwritten by settings sent from the popup.
let settings = {
  silenceThreshold: 5, // seconds of silence before music starts
  volumeThreshold: 6, // 0-100 RMS-ish level below which we count as "quiet"
  musicVolume: 0.5, // 0-1
  fadeInMs: 400, // fade-in duration when music starts
  fadeOutMs: 400, // fade-out duration when music stops
  trackId: 'track:1',
};

// chrome.storage isn't reachable directly from this offscreen document in
// some environments, even though the "storage" permission is declared and
// chrome.storage works fine in background.js/popup.js. Rather than doing
// the write here, relay playback state to the background service worker
// (chrome.runtime messaging is already proven to work from this document —
// that's how STOP_CAPTURE/UPDATE_SETTINGS get delivered) and let it do the write.
function notifyPlaybackState(playing) {
  chrome.runtime
    .sendMessage({ type: 'PLAYBACK_STATE', playing })
    .catch((err) =>
      console.warn('[ElevatorMeet] Could not notify playback state:', err)
    );
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'STOP_CAPTURE') {
    stopCapture();
  } else if (message.type === 'UPDATE_SETTINGS') {
    const newSettings = message.settings || {};
    const trackChanged =
      newSettings.trackId && newSettings.trackId !== settings.trackId;
    settings = { ...settings, ...newSettings };
    if (trackChanged) loadTrack(settings.trackId);
  }
});

// Loads one of the 3 bundled tracks (tracks/track-N.mp3) by trackId.
function loadTrack(trackId) {
  if (!PRELOADED_TRACKS[trackId]) {
    console.error(
      '[ElevatorMeet] Unknown trackId, falling back to first preloaded track:',
      trackId
    );
    trackId = 'track:1';
  }

  currentTrackId = trackId;
  const wasPlaying = musicIsPlaying;

  musicEl.src = chrome.runtime.getURL(PRELOADED_TRACKS[trackId]);
  musicEl.loop = true;
  musicEl.volume = settings.musicVolume;

  if (wasPlaying) {
    musicEl
      .play()
      .catch((err) => console.warn('ElevatorMeet play() failed:', err));
  }
}

// This document is (re)created fresh by background.js every time Start is
// clicked, with the stream id and initial settings baked into the URL —
// avoids the race where a message arrives before this script has loaded.
(function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const streamId = params.get('streamId');
  if (!streamId) return; // opened with no params, e.g. dev preview — no-op

  settings = {
    ...settings,
    silenceThreshold:
      Number(params.get('silenceThreshold')) || settings.silenceThreshold,
    volumeThreshold:
      Number(params.get('volumeThreshold')) || settings.volumeThreshold,
    musicVolume: params.has('musicVolume')
      ? Number(params.get('musicVolume'))
      : settings.musicVolume,
    fadeInMs: params.has('fadeInMs')
      ? Number(params.get('fadeInMs'))
      : settings.fadeInMs,
    fadeOutMs: params.has('fadeOutMs')
      ? Number(params.get('fadeOutMs'))
      : settings.fadeOutMs,
    trackId: params.get('trackId') || settings.trackId,
  };

  startCapture(streamId);
})();

async function startCapture(streamId) {
  // Clean up any previous run first.
  stopCapture();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });
  } catch (err) {
    console.error(
      '[ElevatorMeet] getUserMedia failed — capture never started:',
      err
    );
    return;
  }

  audioContext = new AudioContext();
  sourceNode = audioContext.createMediaStreamSource(mediaStream);

  // Capturing the tab mutes its normal output, so pipe it straight back to
  // the speakers or the meeting would go silent for everyone using this
  // extension.
  passthroughGain = audioContext.createGain();
  passthroughGain.gain.value = 1;
  sourceNode.connect(passthroughGain);
  passthroughGain.connect(audioContext.destination);

  // Separate tap for analysis.
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  sourceNode.connect(analyser);
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  musicEl.loop = true;
  musicEl.volume = settings.musicVolume;
  loadTrack(settings.trackId);

  silenceStartedAt = null;
  musicIsPlaying = false;
  notifyPlaybackState(false);

  monitorLoop();
}

musicEl.addEventListener('error', () => {
  console.error(
    "[ElevatorMeet] Failed to load the selected track — if it's a preloaded slot, make sure a real mp3 exists at that path in the tracks/ folder.",
    currentTrackId,
    musicEl.error
  );
});

// Reflect the *actual* audio element state (not just our intent) so the
// popup's footer can show "playing" vs "listening" correctly — including
// when it was closed and gets reopened later.
musicEl.addEventListener('playing', () => {
  notifyPlaybackState(true);
});
musicEl.addEventListener('pause', () => {
  notifyPlaybackState(false);
});

function monitorLoop() {
  monitorIntervalId = setInterval(monitorTick, 50); // ~20 checks/sec
}

function monitorTick() {
  analyser.getByteTimeDomainData(dataArray);

  // RMS of the waveform, roughly 0-100.
  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i++) {
    // normalize to -1.0 - +1.0
    const norm = (dataArray[i] - 128) / 128;
    sumSquares += norm * norm;
  }
  const level = Math.sqrt(sumSquares / dataArray.length) * 100;

  const now = performance.now();

  if (level > settings.volumeThreshold) {
    // Someone is talking.
    silenceStartedAt = null;
    if (musicIsPlaying) fadeOutAndPause();
  } else {
    // Quiet right now.
    if (silenceStartedAt === null) silenceStartedAt = now;
    const silentSeconds = (now - silenceStartedAt) / 1000;
    if (silentSeconds >= settings.silenceThreshold && !musicIsPlaying) {
      fadeInAndPlay();
    }
  }
}

function fadeInAndPlay() {
  musicIsPlaying = true;
  clearInterval(fadeIntervalId);
  musicEl.currentTime = 0;

  const target = settings.musicVolume;

  if (settings.fadeInMs <= 0) {
    musicEl.volume = target;
    musicEl
      .play()
      .catch((err) => console.warn('ElevatorMeet play() failed:', err));
    return;
  }

  musicEl.volume = 0;
  musicEl
    .play()
    .catch((err) => console.warn('ElevatorMeet play() failed:', err));

  const steps = 20;
  const stepTime = settings.fadeInMs / steps;
  let i = 0;
  fadeIntervalId = setInterval(() => {
    i++;
    musicEl.volume = Math.min(target, (target * i) / steps);
    if (i >= steps) clearInterval(fadeIntervalId);
  }, stepTime);
}

function fadeOutAndPause() {
  musicIsPlaying = false;
  clearInterval(fadeIntervalId);

  if (settings.fadeOutMs <= 0) {
    musicEl.pause();
    return;
  }

  const startVolume = musicEl.volume;
  const steps = 20;
  const stepTime = settings.fadeOutMs / steps;
  let i = 0;
  fadeIntervalId = setInterval(() => {
    i++;
    musicEl.volume = Math.max(0, startVolume * (1 - i / steps));
    if (i >= steps) {
      clearInterval(fadeIntervalId);
      musicEl.pause();
    }
  }, stepTime);
}

function stopCapture() {
  clearInterval(monitorIntervalId);
  clearInterval(fadeIntervalId);
  musicEl.pause();
  musicIsPlaying = false;
  silenceStartedAt = null;

  if (sourceNode) sourceNode.disconnect();
  if (audioContext) audioContext.close();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());

  audioContext = null;
  sourceNode = null;
  analyser = null;
  mediaStream = null;
}
