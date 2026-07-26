# ElevatorMeet

ElevatorMeet plays a background track during silent stretches of a Google
Meet call, and stops the instant someone starts talking again — the audio
equivalent of hold music, without anyone having to remember to turn it on
or off.

## How it works

ElevatorMeet listens to the audio of the active Google Meet tab and
measures its volume about 20 times per second. If the call stays quieter
than your chosen sensitivity for a set number of seconds, it fades in one
of three background tracks on a loop. As soon as someone starts talking
again, the track fades out and stops.

The extension only ever reads volume levels from the tab's audio — it does
not record, store, transmit, or otherwise process anything you say. Nothing
about a call is saved anywhere, on your device or elsewhere.

## Permissions

Chrome extensions must declare upfront what they can access. Here is what
ElevatorMeet requests and why:

| Permission | Why it's needed |
|---|---|
| `tabCapture` | Reads the audio of the active Meet tab so ElevatorMeet can measure silence. This is the only way the extension "hears" the call. |
| `offscreen` | Manifest V3 extensions require a hidden offscreen document to run audio analysis and playback, since the background service worker cannot use audio APIs directly. |
| `storage` | Saves your settings (sensitivity, fade timing, chosen track, volume) locally so they persist between sessions. |
| `activeTab` | Lets the extension act on the Meet tab you're currently viewing when you click Start. |
| Host permission for `meet.google.com` | Restricts ElevatorMeet to only operating on Google Meet pages. |

ElevatorMeet does not request access to your browsing history, other
websites, or any account data, and has no network permissions — it cannot
send anything anywhere.

## Settings

| Control | What it does |
|---|---|
| Track | Choose from three background tracks |
| Silence before music | How many seconds of quiet trigger the music (2-15s) |
| Threshold | Sensitivity of silence detection — lower values pick up on quieter sounds as "talking" |
| Volume | Playback volume of the background track |
| Fade in | How long the music takes to fade in when silence starts (0-5s; 0 is instant) |
| Fade out | How long the music takes to fade out when talking resumes (0-2s; 0 is instant) |

## Privacy

ElevatorMeet does not collect, store, or transmit any personal data, call
content, or audio recordings. All processing happens locally in your
browser. Your settings are saved only to your own device via Chrome's
local storage and are never sent anywhere.

## Current limitations

- The Meet tab must be the active tab when you click Start, since audio
  capture targets the currently focused tab. Once running, it keeps
  listening even if you switch to another tab.
- Detection is based on volume, not speech recognition — a loud fan or
  typing noise can register as "talking."
- Only one call can be monitored at a time.
- If you reload the Meet tab, click Start again to resume.

## Feedback

Found a bug or have a feature request? Use the feedback link on the
extension's Chrome Web Store listing page or visit the [GitHub repo](https://github.com/mandicOfisl/elevator-meet)