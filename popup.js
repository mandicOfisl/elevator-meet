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
}

function setRunningUI(running) {
  toggleBtn.textContent = running ? 'Stop' : 'Start';
  toggleBtn.classList.toggle('running', running);
  toggleBtn.ariaPressed = running ? 'true' : 'false';
}

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

toggleBtn.addEventListener('click', async () => {
  const { running } = await chrome.storage.local.get('running');

  if (!running) {
    statusEl.textContent = 'Starting…';
    const response = await chrome.runtime.sendMessage({
      type: 'START',
      settings: currentSettings(),
    });
    if (response && response.ok) {
      setRunningUI(true);
      statusEl.textContent = 'Listening for silence';
      statusIndicatorEl.style.backgroundColor = '#ff7000';
      statusIndicatorEl.style.boxShadow = '0px 0px 3px 2px #ff7000';
    } else {
      statusEl.textContent = response?.error || 'Could not start.';
    }
  } else {
    await chrome.runtime.sendMessage({ type: 'STOP' });
    setRunningUI(false);
    statusEl.textContent = 'Standby';
    statusIndicatorEl.style.backgroundColor = '#dc2626';
    statusIndicatorEl.style.boxShadow = '0px 0px 3px 2px #dc2626';
  }
});

init();
