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
import { makeDraggable, bringToFront, toggleFullscreen } from "./windowing.js";

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
    return;
  }

  onAccept = handlers.onAccept || (() => {});
  onReject = handlers.onReject || (() => {});

  qs("#perm-text").textContent = summary;
  win.dataset.fs = "";
  win.style.cssText = "";
  win.style.display = "";

  const width = win.offsetWidth;
  const height = win.offsetHeight;
  const portrait = qs(".portrait-body");
  let left;
  let top;

  if (portrait) {
    const rect = portrait.getBoundingClientRect();

    top = rect.top + (rect.height - height) / 2;
    left = rect.right + 12;

    if (left + width > innerWidth - 8) {
      left = rect.left - width - 12;
    }
  } else {
    left = (innerWidth - width) / 2;
    top = (innerHeight - height) / 2 - 20;
  }

  left = Math.max(8, Math.min(left, innerWidth - width - 8));
  top = Math.max(8, Math.min(top, innerHeight - height - 8));

  win.style.position = "fixed";
  win.style.left = left + "px";
  win.style.top = top + "px";
  bringToFront(win);
  playSound("ask-permission");
  dlog("permission requested:", summary);
}

//
// Accept the current prompt: hide it and run the accept handler.
//
function accept() {
  hide();
  onAccept();
}

//
// Reject the current prompt: hide it and run the reject handler.
//
function reject() {
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
