const PRELOADED_TRACKS = [
  {
    id: 'track:1',
    name: 'Smooth Jazz',
    path: 'tracks/track-1.mp3',
  },
  {
    id: 'track:2',
    name: 'Bossa Nova',
    path: 'tracks/track-2.mp3',
  },
  { id: 'track:3', name: 'LoFi', path: 'tracks/track-3.mp3' },
];

const silenceRange = document.getElementById('silenceRange');
const volRange = document.getElementById('volRange');
const musicVolRange = document.getElementById('musicVolRange');
const fadeInRange = document.getElementById('fadeInRange');
const fadeOutRange = document.getElementById('fadeOutRange');
const silenceVal = document.getElementById('silenceVal');
const volVal = document.getElementById('volVal');
const musicVolVal = document.getElementById('musicVolVal');
const fadeInVal = document.getElementById('fadeInVal');
const fadeOutVal = document.getElementById('fadeOutVal');
const trackSelect = document.getElementById('trackSelect');
const toggleBtn = document.getElementById('toggleBtn');
const statusEl = document.getElementById('status');
const statusIndicatorEl = document.getElementById('statusIndicator');

function currentSettings() {
  return {
    silenceThreshold: Number(silenceRange.value),
    volumeThreshold: Number(volRange.value),
    musicVolume: Number(musicVolRange.value) / 100,
    fadeInMs: Number(fadeInRange.value) * 1000,
    fadeOutMs: Number(fadeOutRange.value) * 1000,
    trackId: trackSelect.value,
  };
}

function refreshLabels() {
  silenceVal.textContent = `${silenceRange.value}s`;
  volVal.textContent = volRange.value;
  musicVolVal.textContent = `${musicVolRange.value}%`;
  fadeInVal.textContent = `${Number(fadeInRange.value).toFixed(1)}s`;
  fadeOutVal.textContent = `${Number(fadeOutRange.value).toFixed(1)}s`;
}

function populateTrackSelect(selectedId) {
  trackSelect.innerHTML = '';
  PRELOADED_TRACKS.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    trackSelect.appendChild(opt);
  });

  const validIds = PRELOADED_TRACKS.map((t) => t.id);
  trackSelect.value = validIds.includes(selectedId)
    ? selectedId
    : PRELOADED_TRACKS[0].id;
}

async function init() {
  const stored = await chrome.storage.local.get([
    'silenceThreshold',
    'volumeThreshold',
    'musicVolume',
    'fadeInMs',
    'fadeOutMs',
    'trackId',
    'running',
    'musicPlaying',
    'micGranted',
  ]);

  if (stored.silenceThreshold) silenceRange.value = stored.silenceThreshold;
  if (stored.volumeThreshold) volRange.value = stored.volumeThreshold;
  if (stored.musicVolume != null)
    musicVolRange.value = stored.musicVolume * 100;
  if (stored.fadeInMs != null) fadeInRange.value = stored.fadeInMs / 1000;
  if (stored.fadeOutMs != null) fadeOutRange.value = stored.fadeOutMs / 1000;

  populateTrackSelect(stored.trackId);
  refreshLabels();
  setRunningUI(!!stored.running);
  updateStatusUI({
    running: !!stored.running,
    musicPlaying: !!stored.musicPlaying,
    micGranted: stored.micGranted,
  });
}

function setRunningUI(running) {
  toggleBtn.textContent = running ? 'Stop' : 'Start';
  toggleBtn.classList.toggle('running', running);
  toggleBtn.ariaPressed = running ? 'true' : 'false';
}

// Drives the footer text + indicator dot from the state that matters: is
// capture running at all, is music actually audible right now, and was mic
// access granted. musicPlaying is written by offscreen.js off the real
// <audio> element's playing/pause events, so this stays correct even if
// music starts/stops while the popup happens to be closed.
function updateStatusUI({ running, musicPlaying, micGranted }) {
  if (!running) {
    statusEl.textContent = 'Standby';
    statusIndicatorEl.style.backgroundColor = '#dc2626';
    statusIndicatorEl.style.boxShadow = '0px 0px 3px 2px #dc2626';
  } else if (musicPlaying) {
    statusEl.textContent = 'Playing music';
    statusIndicatorEl.style.backgroundColor = '#22c55e';
    statusIndicatorEl.style.boxShadow = '0px 0px 3px 2px #22c55e';
  } else {
    statusEl.textContent =
      micGranted === false
        ? 'Listening (mic access denied)'
        : 'Listening for silence';
    statusIndicatorEl.style.backgroundColor = '#ff7000';
    statusIndicatorEl.style.boxShadow = '0px 0px 3px 2px #ff7000';
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.running || changes.musicPlaying || changes.micGranted) {
    chrome.storage.local
      .get(['running', 'musicPlaying', 'micGranted'])
      .then(updateStatusUI);
  }
});

async function pushSettingsUpdate() {
  const settings = currentSettings();
  await chrome.storage.local.set(settings);
  chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
}

[silenceRange, volRange, musicVolRange, fadeInRange, fadeOutRange].forEach(
  (el) => {
    el.addEventListener('input', () => {
      refreshLabels();
      pushSettingsUpdate();
    });
  }
);

trackSelect.addEventListener('change', () => {
  pushSettingsUpdate();
});

// Chrome will not display the microphone permission prompt from inside an
// extension's action popup — it needs a real, focusable top-level tab to
// attach to. So: check the current permission state first (no prompt
// involved), and only open a dedicated tab to request it when it hasn't
// been decided yet. Once granted there, the permission applies to the
// whole extension origin, so offscreen.js's own getUserMedia call succeeds
// silently on every future Start — this only has to happen once.
async function ensureMicPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });

    if (status.state === 'granted') return true;
    if (status.state === 'denied') return false; // already decided — don't re-prompt

    // status.state === 'prompt' — never been asked. Open a real tab so
    // Chrome can actually show the permission UI, then proceed with Start
    // using tab-audio-only for now; the mic will be picked up automatically
    // the next time Start is clicked, once permission has been granted.
    chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
    return false;
  } catch (err) {
    // navigator.permissions.query({name:'microphone'}) isn't guaranteed to
    // be supported everywhere — fall back to the direct approach.
    console.warn(
      '[ElevatorMeet] Permission query unsupported, falling back:',
      err
    );
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }
}

toggleBtn.addEventListener('click', async () => {
  const { running } = await chrome.storage.local.get('running');

  if (!running) {
    statusEl.textContent = 'Starting…';
    const micGranted = await ensureMicPermission();
    const response = await chrome.runtime.sendMessage({
      type: 'START',
      settings: currentSettings(),
    });
    if (response && response.ok) {
      setRunningUI(true);
      await chrome.storage.local.set({
        running: true,
        musicPlaying: false,
        micGranted,
      });
    } else {
      statusEl.textContent = response?.error || 'Could not start.';
    }
  } else {
    await chrome.runtime.sendMessage({ type: 'STOP' });
    setRunningUI(false);
    await chrome.storage.local.set({ running: false, musicPlaying: false });
  }
});

init();
