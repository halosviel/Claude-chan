// ===========================================================================
//  windowing.js
//
//  The retro "desktop": draggable, resizable, minimizable windows plus the
//  taskbar that toggles them. Windows start in a centered flex layout and pin
//  to fixed positioning the moment they are dragged, resized, or raised. A
//  single z-index counter (exposed via bringToFront) keeps stacking sane.
// ===========================================================================

import { qs, qsa } from "./util/dom.js";
import { playSound } from "./util/sound.js";

// Minimum drag-resize dimensions, and the running top-most z-index.
const MIN_WIDTH = 280;
const MIN_HEIGHT = 260;
let topZ = 10;

//
// Raise a window above all others by giving it the next z-index. Returned value
// is the z-index used, for callers that want it.
//
export function bringToFront(win) {
  topZ += 1;
  win.style.zIndex = String(topZ);
  return topZ;
}

//
// True when a window is currently collapsed to the taskbar (display:none).
//
export function isHidden(win) {
  return getComputedStyle(win).display === "none";
}

//
// Pin a window to fixed positioning at a given bounding rect. Shared by the
// layout freeze and the start of any drag/resize.
//
function pinFixed(win, rect) {
  win.style.position = "fixed";
  win.style.margin = "0";
  win.style.width = rect.width + "px";
  win.style.left = rect.left + "px";
  win.style.top = rect.top + "px";
}

//
// Pin every visible, not-yet-moved window to its current spot before one of
// them leaves the centered flow. Otherwise popping a single window out of the
// flex layout would make the others re-center and jump. Rects are read first,
// then applied, so freezing one does not reflow the next.
//
function freezeWindowLayout() {
  const flow = [];

  qsa(".desktop > .window").forEach((win) => {
    if (getComputedStyle(win).display === "none") {
      return;
    }

    if (win.style.position === "fixed") {
      return;
    }

    flow.push([win, win.getBoundingClientRect()]);
  });

  flow.forEach(([win, rect]) => pinFixed(win, rect));
}

//
// Make a window draggable by its titlebar. The titlebar buttons are excluded so
// clicking minimize/close does not also start a drag. Exported because the
// permission window wires itself up separately.
//
export function makeDraggable(win) {
  const bar = win.querySelector(".titlebar");

  if (!bar) {
    return;
  }

  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;

  bar.addEventListener("mousedown", (event) => {
    if (event.target.closest(".win-buttons")) {
      return;
    }

    freezeWindowLayout();

    const rect = win.getBoundingClientRect();

    pinFixed(win, rect);
    bringToFront(win);

    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    dragging = true;
    document.body.style.userSelect = "none";
    event.preventDefault();
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }

    win.style.left = (event.clientX - offsetX) + "px";
    win.style.top = (event.clientY - offsetY) + "px";
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    document.body.style.userSelect = "";
  });
}

//
// Make a window resizable by dragging any of its four corner handles.
//
export function makeResizable(win) {
  win.querySelectorAll(".rh").forEach((handle) => {
    const dir = handle.className.match(/rh-(nw|ne|sw|se)/)[1];

    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      freezeWindowLayout();

      const rect = win.getBoundingClientRect();

      pinFixed(win, rect);
      win.style.height = rect.height + "px";
      bringToFront(win);

      const startX = event.clientX;
      const startY = event.clientY;
      const startW = rect.width;
      const startH = rect.height;
      const startL = rect.left;
      const startT = rect.top;

      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        if (dir.includes("e")) {
          win.style.width = Math.max(MIN_WIDTH, startW + dx) + "px";
        }

        if (dir.includes("s")) {
          win.style.height = Math.max(MIN_HEIGHT, startH + dy) + "px";
        }

        if (dir.includes("w")) {
          const newW = Math.max(MIN_WIDTH, startW - dx);

          win.style.width = newW + "px";
          win.style.left = (startL + (startW - newW)) + "px";
        }

        if (dir.includes("n")) {
          const newH = Math.max(MIN_HEIGHT, startH - dy);

          win.style.height = newH + "px";
          win.style.top = (startT + (startH - newH)) + "px";
        }
      };

      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
      };

      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  });
}

//
// Find the taskbar button that toggles a given window.
//
function taskButtonFor(win) {
  return qs('.task-app[data-window="' + win.id + '"]');
}

//
// Reflect a window's open/closed state on its taskbar button.
//
function setTaskActive(win, active) {
  const button = taskButtonFor(win);

  if (button) {
    button.classList.toggle("active", active);
  }
}

//
// Hide a window with an animation ("min" or "close"), then collapse it to the
// taskbar. Child element animations are ignored so only the window's own
// animation triggers the collapse.
//
export function hideWindow(win, mode) {
  if (isHidden(win)) {
    return;
  }

  playSound(mode === "close" ? "app-close" : "app-minimize");

  const cls = mode === "close" ? "win-anim-close" : "win-anim-min";

  win.classList.add(cls);

  const done = (event) => {
    if (event.target !== win) {
      return;
    }

    win.classList.remove(cls);
    win.style.display = "none";
    win.removeEventListener("animationend", done);
  };

  win.addEventListener("animationend", done);
  setTaskActive(win, false);
}

//
// Reveal a window from the taskbar, bring it to front, and play the open sound.
//
export function showWindow(win) {
  playSound("app-open");

  win.style.display = "";
  bringToFront(win);
  win.classList.add("win-anim-open");

  const done = (event) => {
    if (event.target !== win) {
      return;
    }

    win.classList.remove("win-anim-open");
    win.removeEventListener("animationend", done);
  };

  win.addEventListener("animationend", done);
  setTaskActive(win, true);
}

//
// Reveal a window as a fixed, centered overlay ON TOP of everything, instead of
// joining the centered flex flow (which would tile it beside the other windows).
// Used for popups like Memory that should just appear over the desktop.
//
export function showWindowCentered(win) {
  playSound("app-open");

  win.dataset.fs = "";
  win.style.position = "fixed";
  win.style.margin = "0";
  win.style.display = "";

  const width = win.offsetWidth;
  const height = win.offsetHeight;

  win.style.left = Math.max(8, (innerWidth - width) / 2) + "px";
  win.style.top = Math.max(8, (innerHeight - height) / 2 - 20) + "px";
  bringToFront(win);
  win.classList.add("win-anim-open");

  const done = (event) => {
    if (event.target !== win) {
      return;
    }

    win.classList.remove("win-anim-open");
    win.removeEventListener("animationend", done);
  };

  win.addEventListener("animationend", done);
  setTaskActive(win, true);
}

//
// Toggle a window between its normal size and filling the desktop (never the
// taskbar, which always sits on top). The previous inline style is restored.
//
export function toggleFullscreen(win) {
  playSound("app-fullscreen");

  if (win.dataset.fs === "1") {
    win.style.cssText = win.dataset.prevStyle || "";
    win.dataset.fs = "";
    document.body.classList.remove("has-fullscreen");
    return;
  }

  win.dataset.prevStyle = win.style.cssText;
  win.dataset.fs = "1";
  document.body.classList.add("has-fullscreen");
  win.style.position = "fixed";
  win.style.left = "0";
  win.style.top = "0";
  win.style.margin = "0";
  win.style.width = "100vw";
  win.style.height = "calc(100vh - var(--taskbar-h))";
  win.style.zIndex = "9999";
}

//
// Wire drag, resize, and titlebar controls for every window except the
// permission window (which manages its own buttons), plus the taskbar buttons
// that toggle each window. Called once at startup.
//
export function initWindowing() {
  qsa(".window:not(#perm-window)").forEach((win) => {
    makeDraggable(win);
    makeResizable(win);

    const min = win.querySelector(".win-min");
    const max = win.querySelector(".win-max");
    const close = win.querySelector(".win-close");

    if (min) {
      min.addEventListener("click", () => hideWindow(win, "min"));
    }

    if (close) {
      close.addEventListener("click", () => hideWindow(win, "close"));
    }

    if (max) {
      max.addEventListener("click", () => toggleFullscreen(win));
    }
  });

  qsa(".task-app").forEach((button) => {
    const win = qs("#" + button.dataset.window);

    if (!win) {
      return;
    }

    button.addEventListener("click", () => {
      if (isHidden(win)) {
        showWindow(win);
      } else {
        hideWindow(win, "min");
      }
    });
  });
}
