// ===========================================================================
//  permission.js
//
//  The permission prompt: a real draggable window Claude-chan raises when she
//  wants to do something concrete in the desktop. Yes accepts; No, minimize,
//  and close all reject. The accept/reject handlers are supplied per prompt by
//  the chat flow, so this module never needs to know what a decision means.
// ===========================================================================

import { qs } from "./util/dom.js";
import { playSound } from "./util/sound.js";
import { dlog } from "./log.js";
import { makeDraggable, bringToFront, toggleFullscreen, placeNearAppCenter } from "./windowing.js";

// The callbacks for the prompt currently on screen.
let onAccept = () => {};
let onReject = () => {};

//
// Hide the permission window.
//
function hide() {
  const win = qs("#perm-window");

  if (win) {
    win.style.display = "none";
  }
}

//
// Show the permission window with a summary of the action, and remember the
// accept/reject handlers. It spawns BESIDE the portrait (to the right of
// Claude-chan, or her left if there's no room) so it never covers her — it may
// still overlap the app's panels. Falls back to screen-center if no portrait.
//
export function showPermission(summary, handlers = {}) {
  const win = qs("#perm-window");

  if (!win) {
    dlog("permission: FAILED to show (no #perm-window in the page)");
    return;
  }

  if (!summary) {
    dlog("permission: FAILED to show (empty summary)");
    return;
  }

  onAccept = handlers.onAccept || (() => {});
  onReject = handlers.onReject || (() => {});

  qs("#perm-text").textContent = summary;
  win.dataset.fs = "";
  win.style.cssText = "";
  win.style.display = "";
  win.style.position = "fixed";

  placeNearAppCenter(win);
  bringToFront(win);
  playSound("ask-permission");
  dlog("permission: shown ->", summary);

  // Verify it actually became visible on screen; log if something hid it.
  requestAnimationFrame(() => {
    const rect = win.getBoundingClientRect();
    const visible = getComputedStyle(win).display !== "none" &&
      win.offsetParent !== null &&
      rect.width > 0 && rect.height > 0 &&
      rect.right > 0 && rect.bottom > 0 &&
      rect.left < innerWidth && rect.top < innerHeight;

    if (!visible) {
      dlog("permission: FAILED to become visible (display/size/offscreen)", {
        display: getComputedStyle(win).display,
        w: Math.round(rect.width), h: Math.round(rect.height),
        left: Math.round(rect.left), top: Math.round(rect.top),
      });
    }
  });
}

//
// Accept the current prompt: hide it and run the accept handler.
//
function accept() {
  dlog("permission: accepted");
  hide();
  onAccept();
}

//
// Reject the current prompt: hide it and run the reject handler.
//
function reject() {
  dlog("permission: rejected");
  hide();
  onReject();
}

//
// Wire the permission window's controls. Minimize and close both reject, since
// dismissing the prompt is a "no". Called once at startup.
//
export function initPermission() {
  const win = qs("#perm-window");

  if (!win) {
    return;
  }

  makeDraggable(win);

  const min = win.querySelector(".win-min");
  const max = win.querySelector(".win-max");
  const close = win.querySelector(".win-close");
  const yes = qs("#perm-yes");
  const no = qs("#perm-no");

  if (min) {
    min.addEventListener("click", reject);
  }

  if (close) {
    close.addEventListener("click", reject);
  }

  if (max) {
    max.addEventListener("click", () => toggleFullscreen(win));
  }

  if (yes) {
    yes.addEventListener("click", accept);
  }

  if (no) {
    no.addEventListener("click", reject);
  }
}
