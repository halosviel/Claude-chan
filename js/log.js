// ===========================================================================
//  log.js
//
//  Debug logging that fans out to the browser console AND the in-app terminal
//  window. The terminal never scrolls: it shows only as many of the most-recent
//  lines as fit and is re-rendered whenever its size changes.
// ===========================================================================

import { qs } from "./util/dom.js";

// Flip DEBUG to false to mute all logging. LOG_MAX caps the in-memory backlog.
const DEBUG = true;
const LOG_MAX = 500;
const logBuffer = [];

//
// Repaint the terminal window with the most-recent lines that fit, oldest at
// the top, dropping any that overflow. Safe to call when no terminal exists.
//
function renderTerminal() {
  const termLog = qs("#term-log");

  if (!termLog) {
    return;
  }

  termLog.innerHTML = "";

  for (let i = logBuffer.length - 1; i >= 0; i--) {
    const line = document.createElement("div");

    line.textContent = logBuffer[i];
    termLog.appendChild(line);

    if (termLog.scrollHeight > termLog.clientHeight && termLog.children.length > 1) {
      termLog.removeChild(line);
      break;
    }
  }

  Array.from(termLog.children)
    .reverse()
    .forEach((line) => termLog.appendChild(line));
}

//
// Log a debug line to the console and the terminal backlog. Objects are
// JSON-stringified so the terminal shows something readable. No-op when DEBUG
// is off.
//
export function dlog(...args) {
  if (!DEBUG) {
    return;
  }

  console.log("%c[claude-chan]", "color:#e8893a;font-weight:bold", ...args);

  const stamp = "[" + new Date().toTimeString().slice(0, 8) + "] ";
  const body = args
    .map((value) => (typeof value === "object" ? JSON.stringify(value) : String(value)))
    .join(" ");

  logBuffer.push(stamp + body);

  if (logBuffer.length > LOG_MAX) {
    logBuffer.shift();
  }

  renderTerminal();
}

//
// Wire the terminal so it re-fits its contents whenever it is resized (window
// resize, drag-resize, fullscreen, open/close). Called once at startup.
//
export function initTerminal() {
  const termLog = qs("#term-log");

  if (termLog && window.ResizeObserver) {
    new ResizeObserver(() => renderTerminal()).observe(termLog);
  }

  dlog("app loaded");
}
