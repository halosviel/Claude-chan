// ===========================================================================
//  download.js
//
//  The voice-downloads window: a normal draggable desktop window (not a blocking
//  overlay) that shows one progress row per active download. Several voices can
//  download at once, each with its own bar; the app stays fully usable meanwhile
//  and keeps using the currently selected voice. settings-ui.js drives it.
// ===========================================================================

import { qs } from "./util/dom.js";
import { showWindowBeside, bringToFront, isHidden } from "./windowing.js";

// uuid -> { row, fill, status, dismiss } elements for its progress row.
const rows = new Map();

//
// Open the downloads window (beside Claude-chan) if hidden, else just raise it.
//
function ensureWindow() {
  const win = qs("#win-download");

  if (!win) {
    return;
  }

  if (isHidden(win)) {
    showWindowBeside(win);
  } else {
    bringToFront(win);
  }
}

//
// Hide the window once nothing is downloading (no rows left).
//
function hideIfEmpty() {
  const win = qs("#win-download");

  if (win && rows.size === 0) {
    win.style.display = "none";
  }
}

//
// Add (or reuse) a progress row for a voice and reveal the window. Returns the
// row's element bundle.
//
export function addDownload(uuid, name) {
  ensureWindow();

  let entry = rows.get(uuid);

  if (!entry) {
    const list = qs("#download-list");
    const row = document.createElement("div");
    const head = document.createElement("div");
    const label = document.createElement("span");
    const dismiss = document.createElement("button");
    const bar = document.createElement("div");
    const fill = document.createElement("div");
    const status = document.createElement("div");

    row.className = "dl-row";
    head.className = "dl-head";
    label.className = "dl-name";
    label.textContent = name;
    dismiss.className = "dl-dismiss hidden";
    dismiss.type = "button";
    dismiss.textContent = "✕";
    dismiss.title = "dismiss";
    dismiss.addEventListener("click", () => removeDownload(uuid));
    bar.className = "dl-bar";
    fill.className = "dl-fill";
    status.className = "dl-status";

    head.appendChild(label);
    head.appendChild(dismiss);
    bar.appendChild(fill);
    row.appendChild(head);
    row.appendChild(bar);
    row.appendChild(status);

    if (list) {
      list.appendChild(row);
    }

    entry = { row, fill, status, dismiss };
    rows.set(uuid, entry);
  }

  setDownload(uuid, 0, "starting…");

  return entry;
}

//
// Set a row's bar to a 0-100 percent and its caption text.
//
export function setDownload(uuid, percent, text) {
  const entry = rows.get(uuid);

  if (!entry) {
    return;
  }

  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));

  entry.fill.style.width = pct + "%";
  entry.status.textContent = text != null ? text : pct + "%";
}

//
// Mark a row failed and reveal its dismiss button so the user can clear it.
//
export function failDownload(uuid, message) {
  const entry = rows.get(uuid);

  if (!entry) {
    return;
  }

  entry.row.classList.add("dl-error");
  entry.status.textContent = message || "download failed";
  entry.dismiss.classList.remove("hidden");
}

//
// Remove a row (after it finishes or is dismissed); close the window if it was
// the last one.
//
export function removeDownload(uuid) {
  const entry = rows.get(uuid);

  if (entry && entry.row.parentNode) {
    entry.row.parentNode.removeChild(entry.row);
  }

  rows.delete(uuid);
  hideIfEmpty();
}
