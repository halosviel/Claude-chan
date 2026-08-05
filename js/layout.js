// ===========================================================================
//  layout.js
//
//  Remembers the desktop between runs: where each window sits, how big it is,
//  and whether it is open, collapsed to the taskbar, or filling the screen.
//  Each window is stored by id with the inline style it carries (windowing.js
//  switches a window to fixed positioning the moment it is dragged or resized),
//  so restoring is just putting that style back -- clamped, so a window saved
//  near the edge of a larger screen still comes back somewhere clickable.
//
//  Only the desktop's own windows are tracked; the popups that live outside it
//  (permission, credits, downloads) are transient and always start closed.
// ===========================================================================

import { qsa } from "./util/dom.js";
import { setTaskActive } from "./windowing.js";

// Where the layout is kept, and the shape guard for it: bump STORE_VERSION when
// a snapshot gains or loses fields so stale layouts are dropped, not half-read.
const STORE_KEY = "claudechan.layout";
const STORE_VERSION = 1;

// How long to wait after the last mouse release before writing (a drag ends in
// one mouseup, but resizing fires a stream of them), and the margin a restored
// window is kept inside the viewport by.
const SAVE_DELAY = 400;
const EDGE = 8;

let saveTimer = null;

//
// The windows whose layout is remembered.
//
function panes() {
  return qsa(".desktop > .window");
}

//
// Snapshot one window: its inline style, whether it is collapsed to the taskbar,
// and the fullscreen bookkeeping windowing.js keeps on the element itself.
//
function snapshot(win) {
  return {
    style: win.style.cssText,
    hidden: getComputedStyle(win).display === "none",
    fs: win.dataset.fs || "",
    prevStyle: win.dataset.prevStyle || "",
  };
}

//
// Nudge a restored window back inside the viewport, in case it was saved on a
// larger screen (or one that has since been resized).
//
function clampIntoView(win) {
  const left = parseFloat(win.style.left);
  const top = parseFloat(win.style.top);

  if (!Number.isNaN(left)) {
    win.style.left = Math.max(EDGE, Math.min(left, innerWidth - win.offsetWidth - EDGE)) + "px";
  }

  if (!Number.isNaN(top)) {
    win.style.top = Math.max(EDGE, Math.min(top, innerHeight - win.offsetHeight - EDGE)) + "px";
  }
}

//
// Put one window back the way it was left, without the open/close animation or
// its sound -- this is a restore, not the user opening something.
//
function apply(win, state) {
  win.style.cssText = state.style || "";

  if (state.prevStyle) {
    win.dataset.prevStyle = state.prevStyle;
  }

  if (state.fs) {
    win.dataset.fs = state.fs;
    document.body.classList.add("has-fullscreen");
  }

  win.style.display = state.hidden ? "none" : "";

  if (!state.hidden && win.style.position === "fixed") {
    clampIntoView(win);
  }

  setTaskActive(win, !state.hidden);
}

//
// Write the current layout, tolerating storage being unavailable -- the desktop
// still works, it just won't come back the same way next time.
//
export function saveLayout() {
  const windows = {};

  panes().forEach((win) => {
    if (win.id) {
      windows[win.id] = snapshot(win);
    }
  });

  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: STORE_VERSION, windows }));
  } catch (error) {
    // storage unavailable or over quota; nothing else depends on this
  }
}

//
// Coalesce the saves that a drag or resize would otherwise fire.
//
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLayout, SAVE_DELAY);
}

//
// Read the stored layout, or null when there is none (or another version's).
//
function loadLayout() {
  let stored = null;

  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  } catch (error) {
    return null;
  }

  if (!stored || stored.v !== STORE_VERSION || !stored.windows) {
    return null;
  }

  return stored.windows;
}

//
// Restore the last layout and keep it up to date from then on: after every
// drag/resize/toggle (mouse-driven, so one debounced mouseup hook catches them
// all) and once more on the way out, which also covers keyboard-driven changes.
// Called once at startup, after initWindowing.
//
export function initLayout() {
  const stored = loadLayout();

  if (stored) {
    panes().forEach((win) => {
      if (stored[win.id]) {
        apply(win, stored[win.id]);
      }
    });
  }

  window.addEventListener("mouseup", scheduleSave);
  window.addEventListener("beforeunload", saveLayout);
}
