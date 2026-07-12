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
const toggleBtn = document.getElementById('toggleBtn');
const statusEl = document.getElementById('status');

function currentSettings() {
  return {
    silenceThreshold: Number(silenceRange.value),
    volumeThreshold: Number(volRange.value),
    musicVolume: Number(musicVolRange.value) / 100,
    fadeInMs: Number(fadeInRange.value) * 1000,
    fadeOutMs: Number(fadeOutRange.value) * 1000,
  };
}

function refreshLabels() {
  silenceVal.textContent = `${silenceRange.value}s`;
  volVal.textContent = volRange.value;
  musicVolVal.textContent = `${musicVolRange.value}%`;
  fadeInVal.textContent = `${Number(fadeInRange.value).toFixed(1)}s`;
  fadeOutVal.textContent = `${Number(fadeOutRange.value).toFixed(1)}s`;
}

async function init() {
  const stored = await chrome.storage.local.get([
    'silenceThreshold',
    'volumeThreshold',
    'musicVolume',
    'fadeInMs',
    'fadeOutMs',
    'running',
  ]);

  if (stored.silenceThreshold) silenceRange.value = stored.silenceThreshold;
  if (stored.volumeThreshold) volRange.value = stored.volumeThreshold;
  if (stored.musicVolume != null)
    musicVolRange.value = stored.musicVolume * 100;
  if (stored.fadeInMs != null) fadeInRange.value = stored.fadeInMs / 1000;
  if (stored.fadeOutMs != null) fadeOutRange.value = stored.fadeOutMs / 1000;

  refreshLabels();
  setRunningUI(!!stored.running);
}

function setRunningUI(running) {
  toggleBtn.textContent = running ? 'Stop' : 'Start';
  toggleBtn.classList.toggle('running', running);
}

[silenceRange, volRange, musicVolRange, fadeInRange, fadeOutRange].forEach(
  (el) => {
    el.addEventListener('input', async () => {
      refreshLabels();
      const settings = currentSettings();
      await chrome.storage.local.set(settings);
      chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
    });
  }
);

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
      statusEl.textContent = 'Listening for silence.';
    } else {
      statusEl.textContent = response?.error || 'Could not start.';
    }
  } else {
    await chrome.runtime.sendMessage({ type: 'STOP' });
    setRunningUI(false);
    statusEl.textContent = 'Stopped.';
  }
});

init();
