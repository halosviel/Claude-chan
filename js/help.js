// ===========================================================================
//  help.js
//
//  The Help section's "Open" button toggles a small popup window listing the
//  keyboard shortcuts for talking to Claude-chan.
// ===========================================================================

import { qs } from "./util/dom.js";
import { showWindowCentered, hideWindow } from "./windowing.js";

//
// True when the help popup is currently open.
//
function isOpen(win) {
  return win && getComputedStyle(win).display !== "none";
}

//
// Wire the Help "Open" button to toggle the help popup. Called once at startup.
//
export function initHelp() {
  const button = qs("#help-view");
  const win = qs("#win-help");

  if (!button || !win) {
    return;
  }

  button.addEventListener("click", () => {
    if (isOpen(win)) {
      hideWindow(win, "min");
    } else {
      showWindowCentered(win);
    }
  });
}
