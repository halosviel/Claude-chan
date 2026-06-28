// ===========================================================================
//  credits.js
//
//  A small notice window shown when the claude CLI reports there are no credits
//  left. Claude-chan says so in her reply (the backend flags it); this just pops
//  the heads-up window afterwards. Any of its buttons dismiss it.
// ===========================================================================

import { qs } from "./util/dom.js";
import { showWindowCentered, hideWindow } from "./windowing.js";
import { dlog } from "./log.js";

//
// Pop the "out of credits" notice.
//
export function showCredits() {
  const win = qs("#credits-window");

  if (!win) {
    dlog("credits: notice window missing from the page");
    return;
  }

  showWindowCentered(win);
  dlog("credits: out-of-credits notice shown");
}

//
// Wire the notice's buttons to dismiss it. Called once at startup.
//
export function initCredits() {
  const win = qs("#credits-window");

  if (!win) {
    return;
  }

  const close = win.querySelector(".win-close");
  const ok = qs("#credits-ok");

  if (close) {
    close.addEventListener("click", () => hideWindow(win, "close"));
  }

  if (ok) {
    ok.addEventListener("click", () => hideWindow(win, "close"));
  }
}
