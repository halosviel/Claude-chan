// ===========================================================================
//  transcript.js
//
//  Keeps an in-memory log of the conversation and shows it in a messaging-app
//  style popup. Your messages sit on the left, Claude-chan's on the right, each
//  labelled. The log is rendered only when the popup opens (and rebuilt from a
//  DocumentFragment in one pass), so recording a turn costs nothing until then.
// ===========================================================================

import { qs } from "./util/dom.js";
import { formatClock, formatRelativeTime } from "./util/time.js";
import { buildHtml } from "./markdown.js";
import { showWindow, hideWindow } from "./windowing.js";
import { t, onChange } from "./i18n.js";

// The conversation so far, and when this session began. winEl/logEl are the
// popup window and its log, resolved at init so live updates can target them.
const turns = [];
const sessionStart = new Date();
let winEl = null;
let logEl = null;

//
// True when the transcript popup is currently open.
//
function isOpen() {
  return winEl && getComputedStyle(winEl).display !== "none";
}

//
// Append a turn to the log, and if the popup is open, show it live.
//
function pushTurn(turn) {
  turn.time = new Date();
  turns.push(turn);

  if (logEl && isOpen()) {
    logEl.appendChild(buildMessage(turn));
    logEl.scrollTop = logEl.scrollHeight;
  }
}

//
// Remove the most recent turn (used when a prompt is cancelled before a reply).
// Also removes its bubble from the log if the popup is open.
//
export function popTurn() {
  if (turns.length === 0) {
    return;
  }

  turns.pop();

  if (logEl && isOpen() && logEl.lastElementChild) {
    logEl.removeChild(logEl.lastElementChild);
  }
}

//
// Record one of your messages.
//
export function recordUser(text) {
  pushTurn({ role: "you", text });
}

//
// Record one of Claude-chan's replies.
//
export function recordClaude(text) {
  pushTurn({ role: "claude", text });
}

//
// Build the "Session started <time>" pill shown centered at the top.
//
function buildSessionMarker() {
  const marker = document.createElement("div");
  const time = document.createElement("span");

  marker.className = "transcript-start";
  marker.textContent = t("transcript.start") + " ";
  time.className = "t-time";
  time.textContent = formatClock(sessionStart);
  marker.appendChild(time);

  return marker;
}

//
// Build one message row: a label ("You" / "Claude-chan") above its bubble,
// aligned left for you and right for Claude-chan.
//
function buildMessage(turn) {
  const row = document.createElement("div");
  const label = document.createElement("div");
  const bubble = document.createElement("div");
  const time = document.createElement("div");

  row.className = "msg msg-" + turn.role;
  label.className = "msg-label";
  label.textContent = turn.role === "you" ? t("transcript.you") : t("transcript.claude");
  bubble.className = "msg-bubble";
  // render markdown (buildHtml escapes its input); markers are hidden via CSS
  bubble.innerHTML = buildHtml(turn.text);
  time.className = "msg-time";
  time.textContent = turn.time ? formatRelativeTime(turn.time) : "";

  row.appendChild(label);
  row.appendChild(bubble);
  row.appendChild(time);

  return row;
}

//
// Rebuild the whole transcript into the log element in a single DOM insertion.
//
function render(log) {
  const fragment = document.createDocumentFragment();

  fragment.appendChild(buildSessionMarker());
  turns.forEach((turn) => fragment.appendChild(buildMessage(turn)));

  log.innerHTML = "";
  log.appendChild(fragment);
  log.scrollTop = log.scrollHeight;
}

//
// Wire the Transcripts "View" button to TOGGLE the popup: open (and render) it
// when closed, hide it when open. Called once at startup.
//
export function initTranscript() {
  const button = qs("#transcript-view");

  winEl = qs("#win-transcript");
  logEl = qs("#transcript-log");

  if (!button || !winEl || !logEl) {
    return;
  }

  // re-render the (translatable) labels if the language changes while open
  onChange(() => {
    if (isOpen()) {
      render(logEl);
    }
  });

  button.addEventListener("click", () => {
    if (isOpen()) {
      hideWindow(winEl, "min");
      return;
    }

    // Show first, THEN render: the scroll-to-bottom in render() only works once
    // the log has layout, so rendering while still display:none would leave a
    // long backlog stuck at the top on first open.
    showWindow(winEl);
    render(logEl);
  });
}
