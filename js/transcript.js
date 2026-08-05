// ===========================================================================
//  transcript.js
//
//  Keeps a log of the conversation and shows it in a messaging-app style popup.
//  Your messages sit on the left, Claude-chan's on the right, each labelled. The
//  log is rendered only when the popup opens (and rebuilt from a DocumentFragment
//  in one pass), so recording a turn costs nothing until then.
//
//  The log SURVIVES RELOADS (localStorage), so it spans sessions: every turn
//  remembers which session it belongs to and a "Session started" pill is drawn
//  wherever that changes. Her messages also carry the Japanese line she spoke and
//  the mood she spoke it in, so each one gets a play button that says it again --
//  instantly while a clip is cached, re-rendered by the server otherwise.
// ===========================================================================

import { qs } from "./util/dom.js";
import { playSound } from "./util/sound.js";
import { formatClock, formatRelativeTime } from "./util/time.js";
import { buildHtml } from "./markdown.js";
import { showWindow, hideWindow } from "./windowing.js";
import { t, onChange } from "./i18n.js";
import { prepareSpeech, playPrepared, stopAudio } from "./voice.js";

// Where the backlog is kept between runs. STORE_VERSION guards the shape of it:
// bump it when a turn gains or loses fields and stale logs are dropped instead
// of being half-read by newer code. STORE_MAX caps how much is carried over.
const STORE_KEY = "claudechan.transcript";
const STORE_VERSION = 1;
const STORE_MAX = 300;

// The conversation so far, and when this run began (turns record it, so restored
// ones keep pointing at the session they were said in). winEl/logEl are the popup
// window and its log, resolved at init so live updates can target them.
const turns = [];
const sessionStart = new Date();
const sessionStamp = sessionStart.getTime();
let winEl = null;
let logEl = null;

// The turn being replayed and the button lit for it (tracked apart so a
// re-render can light the rebuilt button), plus a token that retires an
// in-flight synthesis once a newer click supersedes it.
let playingTurn = null;
let playingButton = null;
let replayToken = 0;

//
// Load the stored backlog, dropping it if it was written by another version.
// Times come back as Dates; anything unreadable just starts an empty log.
//
function loadTurns() {
  let stored = null;

  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  } catch (error) {
    stored = null;
  }

  if (!stored || stored.v !== STORE_VERSION || !Array.isArray(stored.turns)) {
    return;
  }

  stored.turns.forEach((turn) => {
    turns.push(Object.assign({}, turn, { time: new Date(turn.time) }));
  });
}

//
// Persist the backlog (most recent STORE_MAX turns), tolerating storage being
// unavailable or full -- the log still works for this run, it just won't carry.
//
function saveTurns() {
  const payload = {
    v: STORE_VERSION,
    turns: turns.slice(-STORE_MAX).map((turn) => Object.assign({}, turn, {
      time: turn.time ? turn.time.getTime() : Date.now(),
    })),
  };

  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
  } catch (error) {
    // storage unavailable or over quota; this run's log is unaffected
  }
}

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
  turn.session = sessionStamp;
  turns.push(turn);
  saveTurns();

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
  saveTurns();

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
// speaks for it and the mood she says it in -- that pair is what the replay
// button hands back to the server, so a replay sounds exactly like the original.
//
export function recordClaude(text, speech, mood) {
  pushTurn({ role: "claude", text, speech: (speech || "").trim(), mood: mood || "" });
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

  const audio = await prepareSpeech(turn.speech, turn.mood);

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
// Label a session pill: just the clock time for today, and the day as well for
// the older sessions the backlog now keeps.
//
function sessionLabel(date) {
  const relative = formatRelativeTime(date);
  const clock = formatClock(date);

  return relative === clock ? clock : relative + " · " + clock;
}

//
// Build a "Session started <time>" pill, shown centered wherever the log crosses
// from one session into the next.
//
function buildSessionMarker(stamp) {
  const marker = document.createElement("div");
  const time = document.createElement("span");

  marker.className = "transcript-start";
  marker.textContent = t("transcript.start") + " ";
  time.className = "t-time";
  time.textContent = sessionLabel(new Date(stamp));
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
// Rebuild the whole transcript into the log element in a single DOM insertion,
// starting a new session pill whenever the turns cross into another run. This
// run's pill is drawn last when it has nothing in it yet, so the first live
// message of the session lands under a marker that is already there.
//
function render(log) {
  const fragment = document.createDocumentFragment();
  let session = null;

  playingButton = null;

  turns.forEach((turn) => {
    if (turn.session !== session) {
      session = turn.session;
      fragment.appendChild(buildSessionMarker(session || turn.time.getTime()));
    }

    fragment.appendChild(buildMessage(turn));
  });

  if (session !== sessionStamp) {
    fragment.appendChild(buildSessionMarker(sessionStamp));
  }

  log.innerHTML = "";
  log.appendChild(fragment);
  log.scrollTop = log.scrollHeight;
}

//
// Empty the backlog for good: this run's turns and everything carried over.
//
function clearTurns() {
  playSound("click");
  stopAudio();
  clearPlaying();
  turns.length = 0;

  try {
    localStorage.removeItem(STORE_KEY);
  } catch (error) {
    // storage unavailable; the in-memory log is cleared either way
  }

  if (logEl) {
    render(logEl);
  }
}

//
// Restore the stored backlog and wire the Transcripts "View" button to TOGGLE
// the popup: open (and render) it when closed, hide it when open. The titlebar's
// clear button empties the log. Called once at startup.
//
export function initTranscript() {
  const button = qs("#transcript-view");
  const clear = qs("#transcript-clear");

  winEl = qs("#win-transcript");
  logEl = qs("#transcript-log");

  loadTurns();

  if (!button || !winEl || !logEl) {
    return;
  }

  if (clear) {
    clear.addEventListener("click", clearTurns);
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
