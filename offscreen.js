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

// Local microphone — captured separately from the tab, since Google Meet
// doesn't loop your own voice back into the tab's audio output. Without
// this, the extension can only "hear" other participants, so the music
// would keep playing over you if you're the only one talking.
let micStream = null;
let micSourceNode = null;
let micAnalyser = null;
let micDataArray = null;
let micAvailable = false;

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
    const volumeChanged =
      newSettings.musicVolume != null &&
      newSettings.musicVolume !== settings.musicVolume;
    settings = { ...settings, ...newSettings };
    if (trackChanged) loadTrack(settings.trackId);
    // Apply immediately, even mid-playback — not just at the next fade.
    // Also cancel any fade in progress, since its old target volume is now
    // stale and would otherwise fight the slider on its next tick.
    if (volumeChanged) {
      clearInterval(fadeIntervalId);
      musicEl.volume = settings.musicVolume;
    }
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

  // Also listen to the local microphone. This relies on
  // microphone permission already having been granted for the extension's
  // origin — popup.js requests it once via a real user gesture on Start,
  // since this hidden offscreen document can't prompt for it itself.
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micSourceNode = audioContext.createMediaStreamSource(micStream);
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 2048;
    micAnalyser.smoothingTimeConstant = 0.8;
    // Analysis only — deliberately NOT connected to audioContext.destination,
    // or you'd hear your own voice echoed back.
    micSourceNode.connect(micAnalyser);
    micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
    micAvailable = true;
  } catch (err) {
    micAvailable = false;
    console.warn(
      '[ElevatorMeet] Microphone unavailable — silence detection will only account for other participants, not your own voice. Grant microphone access and click Start again to enable this.',
      err
    );
  }

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

// RMS (root-mean-square) volume of an analyser's current waveform, scaled
// to roughly 0-100. Shared by both the tab-audio and microphone channels.
function getRmsLevel(analyserNode, buffer) {
  analyserNode.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const norm = (buffer[i] - 128) / 128; // normalize to -1.0 – +1.0
    sumSquares += norm * norm;
  }
  return Math.sqrt(sumSquares / buffer.length) * 100;
}

function monitorTick() {
  const tabLevel = getRmsLevel(analyser, dataArray);
  const micLevel = micAvailable ? getRmsLevel(micAnalyser, micDataArray) : 0;

  // "Someone is talking" if EITHER channel is loud — another participant
  // (heard through the tab) or you (heard through the mic).
  const level = Math.max(tabLevel, micLevel);

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
  if (micSourceNode) micSourceNode.disconnect();
  if (audioContext) audioContext.close();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (micStream) micStream.getTracks().forEach((t) => t.stop());

  audioContext = null;
  sourceNode = null;
  analyser = null;
  mediaStream = null;
  micSourceNode = null;
  micAnalyser = null;
  micStream = null;
  micAvailable = false;
}
