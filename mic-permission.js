// mic-permission.js — requests microphone access from a real tab, since
// Chrome does not display the mic permission prompt from inside an
// extension's action popup. Once granted here, the permission applies to
// the whole extension origin, so offscreen.js's own getUserMedia call
// succeeds silently afterward — this page only needs to run once.

const messageEl = document.getElementById('message');

(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    messageEl.textContent =
      'Microphone access granted. You can close this tab and return to ElevatorMeet — click Start again to pick it up.';
    setTimeout(() => window.close(), 2500);
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      // Once denied, neither this page nor any script can re-trigger the
      // native prompt — only the person can reset it, through Chrome's own
      // UI. Give exact steps rather than a vague "try again" message.
      messageEl.innerHTML = `
        Microphone access was blocked. ElevatorMeet will still work using
        only the meeting audio, but if you'd like to turn it on later:
        <ol style="text-align: left; margin-top: 12px;">
          <li>Go to <code>chrome://settings/content/microphone</code></li>
          <li>Under "Not allowed", find this extension and remove it (or set it to Allow)</li>
          <li>Come back to ElevatorMeet and click Start again</li>
        </ol>
      `;
    } else if (err.name === 'NotFoundError') {
      messageEl.textContent =
        "Microphone access wasn't granted because no microphone input was found. ElevatorMeet will still work using only the meeting audio — you can close this tab.";
    } else {
      messageEl.textContent =
        "Microphone access wasn't granted. ElevatorMeet will still work using only the meeting audio — you can close this tab.";
    }
  }
})();
