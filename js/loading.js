// ===========================================================================
//  loading.js
//
//  Full-screen boot gate. Claude-chan is voice-first, and AivisSpeech needs a
//  few seconds to bind its port and load the voice models after the server
//  launches it, so the desktop stays hidden behind a spinner until /tts reports
//  the engine ready. main() awaits waitForEngine() before wiring the rest of the
//  UI, then calls hideLoading() to fade the overlay away.
// ===========================================================================

import { qs, fetchJson } from "./util/dom.js";
import { t } from "./i18n.js";

// How often to re-check /tts, and how long to wait before admitting the engine
// is taking longer than usual (so a stuck-looking spinner gets an explanation).
const POLL_INTERVAL = 2000;
const SLOW_AFTER = 20000;

//
// Resolve once /tts reports a working speech engine, or when the user clicks
// "enter anyway". Polls indefinitely -- the server starts the engine itself, so
// it normally appears within seconds -- and after SLOW_AFTER reveals a hint and
// the skip button so a slow or broken engine never looks frozen or locks you out.
//
export function waitForEngine() {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;

    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    const skip = qs("#loading-skip");

    if (skip) {
      skip.addEventListener("click", finish, { once: true });
    }

    const poll = async () => {
      if (done) {
        return;
      }

      try {
        const data = await fetchJson("/tts");

        if (data.server) {
          finish();
          return;
        }
      } catch (error) {
        // server not answering yet; keep waiting
      }

      if (done) {
        return;
      }

      if (Date.now() - started > SLOW_AFTER) {
        revealSlow();
      }

      setTimeout(poll, POLL_INTERVAL);
    };

    poll();
  });
}

//
// Fade the overlay out and remove it once the app is ready to show.
//
export function hideLoading() {
  const overlay = qs("#loading");

  if (!overlay) {
    return;
  }

  overlay.classList.add("loading-done");
  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
}

// Reveal the "taking longer than usual" line and the "enter anyway" button once
// the engine is slow, so the spinner never looks frozen and you can bypass it.
function revealSlow() {
  const hint = qs("#loading-hint");
  const skip = qs("#loading-skip");

  if (hint && hint.classList.contains("hidden")) {
    hint.textContent = t("loading.slow");
    hint.classList.remove("hidden");
  }

  if (skip && skip.classList.contains("hidden")) {
    skip.textContent = t("loading.skip");
    skip.classList.remove("hidden");
  }
}
