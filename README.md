# ElevatorMeet (POC)

Plays elevator music during silent stretches of a Google Meet call, and stops
the instant someone starts talking again.

## How it works

- `chrome.tabCapture` grabs the audio stream of the active Google Meet tab.
- An **offscreen document** (required in Manifest V3 — service workers can't
  touch `AudioContext`/`MediaStream`) runs a Web Audio `AnalyserNode` on that
  stream, computing an RMS volume level ~60 times/sec.
- If the level stays below your sensitivity threshold for N seconds
  (adjustable), it fades in your selected track on a loop.
- As soon as volume spikes above the threshold (someone talks), the music
  fades out and pauses.
- The captured audio is also reconnected to the speakers (`audioContext.destination`),
  since capturing a tab otherwise mutes it for the person running the extension.

## Setup

1. **Add your own audio files.** Drop three mp3s into the `tracks/` folder,
   named exactly:
   - `tracks/track-1.mp3`
   - `tracks/track-2.mp3`
   - `tracks/track-3.mp3`

   These show up in the popup's track dropdown as "Classic Elevator",
   "Smooth Jazz Hold", and "Corporate Hum" (rename them in `popup.js` /
   `offscreen.js`'s `PRELOADED_TRACKS` if you want different labels).
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open a Google Meet call, click the ElevatorMeet toolbar icon, pick a
   track, adjust sliders if you want, and click **Start**.

## Settings

| Control | What it does |
|---|---|
| Track | Choose from the 3 tracks bundled in the `tracks/` folder |
| Silence before music | How many seconds of quiet trigger the music (2–15s) |
| Sensitivity | RMS threshold below which audio counts as "silence" — lower = more sensitive (picks up on quieter background noise as "talking") |
| Music volume | Playback volume of the elevator music |
| Fade in speed | How long the music takes to fade in when silence starts (0–5s; 0 = instant) |
| Fade out speed | How long the music takes to fade out when talking resumes (0–2s; 0 = instant) |

## Known limitations (this is a POC)

- **Tab must stay active/focused when you click Start**, since `tabCapture`
  targets the currently active tab. Once running it keeps capturing even if
  you switch tabs.
- Only detects volume, not "is this actually speech" — a loud fan or
  keyboard clatter could count as talking. A more robust version could add
  simple voice-activity-detection (VAD) instead of raw RMS.
- Only one tab can be captured at a time.
- If you reload the Meet tab, you'll need to click Start again.
- Tested for the "listen to sound levels + play/stop mp3" mechanic — polish
  like icons, error states, and multi-tab support are left for a v2.

## File overview

```
manifest.json     – MV3 extension manifest
background.js     – service worker: creates offscreen doc, gets tabCapture stream id
offscreen.html/js – audio analysis + play/pause + track loading logic
popup.html/js     – toolbar popup UI (track picker, sliders, start/stop)
tracks/           – 🔊 you provide 3 preloaded mp3s here
```
