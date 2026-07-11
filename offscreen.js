// offscreen.js — the actual audio analysis + elevator-music logic.
// Runs in a hidden offscreen document because MV3 service workers cannot
// create AudioContext / MediaStream / <audio> elements themselves.

const musicEl = document.getElementById('music');

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

// Defaults — overwritten by settings sent from the popup.
let settings = {
  silenceThreshold: 5, // seconds of silence before music starts
  volumeThreshold: 6, // 0-100 RMS-ish level below which we count as "quiet"
  musicVolume: 0.5, // 0-1
  fadeMs: 400, // fade in/out duration
};

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'STOP_CAPTURE') {
    stopCapture();
  } else if (message.type === 'UPDATE_SETTINGS') {
    settings = { ...settings, ...(message.settings || {}) };
  }
});

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

  silenceStartedAt = null;
  musicIsPlaying = false;

  monitorLoop();
}

musicEl.addEventListener('error', () => {
  console.error(
    "[ElevatorMeet] Failed to load elevator-music.mp3 — make sure a real mp3 file named exactly 'elevator-music.mp3' exists at the extension's root folder.",
    musicEl.error
  );
});

function monitorLoop() {
  // setInterval, not requestAnimationFrame — offscreen documents are never
  // actually painted to screen, so rAF callbacks never fire here.
  monitorIntervalId = setInterval(monitorTick, 50); // ~20 checks/sec
}

function monitorTick() {
  analyser.getByteTimeDomainData(dataArray);

  // RMS of the waveform, roughly 0-100.
  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i++) {
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
  musicEl.volume = 0;
  musicEl
    .play()
    .catch((err) => console.warn('ElevatorMeet play() failed:', err));

  const target = settings.musicVolume;
  const steps = 20;
  const stepTime = settings.fadeMs / steps;
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
  const startVolume = musicEl.volume;
  const steps = 20;
  const stepTime = settings.fadeMs / steps;
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
