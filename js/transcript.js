// ===========================================================================
//  transcript.js
//
//  Keeps an in-memory log of the conversation and shows it in a messaging-app
//  style popup. Your messages sit on the left, Claude-chan's on the right, each
//  labelled. The log is rendered only when the popup opens (and rebuilt from a
//  DocumentFragment in one pass), so recording a turn costs nothing until then.
//  Her messages also carry the Japanese line she spoke for them, so each one
//  gets a play button that says it again -- instantly while voice.js still
//  holds the clip, re-synthesized once it has dropped it.
// ===========================================================================

import { qs } from "./util/dom.js";
import { formatClock, formatRelativeTime } from "./util/time.js";
import { buildHtml } from "./markdown.js";
import { showWindow, hideWindow } from "./windowing.js";
import { t, onChange } from "./i18n.js";
import { prepareSpeech, playPrepared, stopAudio } from "./voice.js";

// The conversation so far, and when this session began. winEl/logEl are the
// popup window and its log, resolved at init so live updates can target them.
const turns = [];
const sessionStart = new Date();
let winEl = null;
let logEl = null;

// The turn being replayed and the button lit for it (tracked apart so a
// re-render can light the rebuilt button), plus a token that retires an
// in-flight synthesis once a newer click supersedes it.
let playingTurn = null;
let playingButton = null;
let replayToken = 0;

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
// Record one of Claude-chan's replies, together with the Japanese line she
// speaks for it -- that line is what the replay button plays back.
//
export function recordClaude(text, speech) {
  pushTurn({ role: "claude", text, speech: (speech || "").trim() });
}

//
// Drop the "playing" highlight, unless a newer replay has already taken over.
//
function clearPlaying(turn) {
  if (turn && turn !== playingTurn) {
    return;
  }

  if (playingButton) {
    playingButton.classList.remove("playing");
  }

  playingTurn = null;
  playingButton = null;
}

//
// Click on a replay button: stop the voice if this message is the one speaking,
// otherwise say its line again -- interrupting whatever else is being spoken,
// since only one clip plays at a time.
//
async function toggleReplay(button, turn) {
  const wasPlaying = turn === playingTurn;

  replayToken += 1;
  stopAudio();
  clearPlaying();

  if (wasPlaying) {
    return;
  }

  const token = replayToken;

  playingTurn = turn;
  playingButton = button;
  button.classList.add("playing");

  const audio = await prepareSpeech(turn.speech);

  if (token !== replayToken) {
    return;
  }

  if (!audio) {
    clearPlaying(turn);
    return;
  }

  // "pause" covers being cut off by another clip; onEnd covers finishing.
  audio.addEventListener("pause", () => clearPlaying(turn), { once: true });
  playPrepared(audio, { onEnd: () => clearPlaying(turn) });
}

//
// Build the play button shown beside one of her labels. The icon is drawn in
// CSS (a triangle, a square while it speaks) so no glyph font is involved.
//
function buildReplayButton(turn) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "msg-replay";
  button.title = t("transcript.replay");
  button.setAttribute("aria-label", t("transcript.replay"));

  if (turn === playingTurn) {
    playingButton = button;
    button.classList.add("playing");
  }

  button.addEventListener("click", () => toggleReplay(button, turn));

  return button;
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
// aligned left for you and right for Claude-chan. Her label is followed by a
// replay button whenever the message has a spoken line behind it.
//
function buildMessage(turn) {
  const row = document.createElement("div");
  const head = document.createElement("div");
  const label = document.createElement("div");
  const bubble = document.createElement("div");
  const time = document.createElement("div");

  row.className = "msg msg-" + turn.role;
  head.className = "msg-head";
  label.className = "msg-label";
  label.textContent = turn.role === "you" ? t("transcript.you") : t("transcript.claude");
  head.appendChild(label);

  if (turn.speech) {
    head.appendChild(buildReplayButton(turn));
  }

  bubble.className = "msg-bubble";
  // render markdown (buildHtml escapes its input); markers are hidden via CSS
  bubble.innerHTML = buildHtml(turn.text);
  time.className = "msg-time";
  time.textContent = turn.time ? formatRelativeTime(turn.time) : "";

  row.appendChild(head);
  row.appendChild(bubble);
  row.appendChild(time);

  return row;
}

//
// Rebuild the whole transcript into the log element in a single DOM insertion.
//
function render(log) {
  const fragment = document.createDocumentFragment();

  playingButton = null;
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
