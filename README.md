# ElevatorMeet

ElevatorMeet plays a background track during silent stretches of a Google
Meet call, and stops the instant someone starts talking again — the audio
equivalent of hold music, without anyone having to remember to turn it on
or off.

## How it works

ElevatorMeet listens to two audio sources: the active Google Meet tab (to
hear other participants) and your microphone (to hear you). It measures the
volume of both about 20 times per second. If both stay quieter than your
chosen sensitivity for a set number of seconds, it fades in one of three
background tracks on a loop. As soon as either you or another participant
starts talking, the track fades out and stops.

Listening to both sources matters because Google Meet does not play your
own voice back through the tab — only other participants. Without also
checking the microphone, the extension would have no way to tell that you
were talking, and the music would keep playing over you.

The first time you click Start, Chrome may briefly open a new tab to ask
for microphone permission — this happens because Chrome does not allow
that permission prompt to appear from inside the extension's toolbar
popup. Allow it there, close the tab, and click Start again; the
permission is remembered from then on, and the microphone gets used
automatically. If you skip or deny it, ElevatorMeet keeps working — it
just won't be able to tell you personally are talking, and treats you the
same as a silent participant.

## Permissions

Chrome extensions must declare upfront what they can access. Here is what
ElevatorMeet requests and why:

| Permission | Why it's needed |
|---|---|
| `tabCapture` | Reads the audio of the active Meet tab so ElevatorMeet can measure when other participants are talking. |
| Microphone | Reads your own microphone's volume, so ElevatorMeet knows when you're talking too — this is requested through the standard browser permission prompt (not a Chrome extension permission), the first time you click Start. |
| `offscreen` | Manifest V3 extensions require a hidden offscreen document to run audio analysis and playback, since the background service worker cannot use audio APIs directly. |
| `storage` | Saves your settings (sensitivity, fade timing, chosen track, volume) locally so they persist between sessions. |
| `activeTab` | Lets the extension act on the Meet tab you're currently viewing when you click Start. |
| Host permission for `meet.google.com` | Restricts ElevatorMeet to only operating on Google Meet pages. |

ElevatorMeet does not request access to your browsing history, other
websites, or any account data, and has no network permissions — it cannot
send anything anywhere. If microphone access is denied, ElevatorMeet keeps
working using only the tab audio — it just won't be able to tell that you
personally are talking.

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
content, or audio recordings — from either the meeting or your microphone.
All processing happens locally in your browser, in real time, and audio is
never written to disk or sent anywhere. Your settings are saved only to
your own device via Chrome's local storage.

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
extension's Chrome Web Store listing page.
