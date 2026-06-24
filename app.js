// ============================================================================
// Claude_chan frontend.  NOTES FOR FUTURE CLAUDE (see CLAUDE.md for full map):
//
// Flow on submit (form):
//   1. setEmotion("thinking") + bubble "..."  while waiting on the server.
//   2. POST /chat -> {emotion, text, speech, image}.
//   3. prepareSpeech() FETCHES + fully decodes the WAV from /speak FIRST.
//   4. Only once audio is ready: showImage + showBubble + audio.play() fire
//      TOGETHER, so image, text, and voice are in sync (no 1s audio lag).
//      The "thinking" picture stays up during synthesis. If muted / engine
//      down / synth fails, text+image just appear instantly (nothing to wait
//      for). This sync behavior was specifically requested by the user.
//
// Image selection is OWNED BY THE SERVER: it scans images/<emotion>/, picks a
// random non-repeating PNG, falls back to images/thinking/ when empty. To add
// pictures the user just drops PNGs into the matching folder -- no code changes.
//
// Voice: server-only (AivisSpeech), played at a fixed 70% volume
// (VOICE_VOLUME). The voice-note <p id="voice-note"> shows a hint when /tts
// reports no engine.
// ============================================================================
// Verbose debug logging -> browser console (F12). Flip DEBUG to false to mute.
const DEBUG = true;
function dlog(...args) {
  if (DEBUG) console.log("%c[claude-chan]", "color:#e8893a;font-weight:bold", ...args);
}
dlog("app.js loaded");

const avatar = document.getElementById("avatar");
const bubble = document.getElementById("bubble");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const voiceNote = document.getElementById("voice-note");

// --- draggable XP-style windows ---
// Grab a window by its titlebar to move it. On first drag the window switches
// to fixed positioning at its current spot (so it leaves the centered layout).
// The _ button minimizes (to the taskbar); □ / ✕ are decorative.
let topZ = 10;
function makeDraggable(win) {
  const bar = win.querySelector(".titlebar");
  if (!bar) return;
  let offX = 0, offY = 0, dragging = false;
  bar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".win-buttons")) return; // don't drag from the buttons
    const r = win.getBoundingClientRect();
    win.style.position = "fixed";
    win.style.margin = "0";
    win.style.width = r.width + "px";
    win.style.left = r.left + "px";
    win.style.top = r.top + "px";
    win.style.zIndex = String(++topZ);
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    dragging = true;
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    win.style.left = (e.clientX - offX) + "px";
    win.style.top = (e.clientY - offY) + "px";
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    document.body.style.userSelect = "";
  });
}
// --- resizable windows (drag a corner handle) ---
function makeResizable(win) {
  const MIN_W = 280, MIN_H = 260;
  win.querySelectorAll(".rh").forEach((h) => {
    const dir = h.className.match(/rh-(nw|ne|sw|se)/)[1];
    h.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't start a titlebar drag
      const r = win.getBoundingClientRect();
      win.style.position = "fixed";
      win.style.margin = "0";
      win.style.left = r.left + "px";
      win.style.top = r.top + "px";
      win.style.width = r.width + "px";
      win.style.height = r.height + "px";
      win.style.zIndex = String(++topZ);
      const sx = e.clientX, sy = e.clientY;
      const sw = r.width, sh = r.height, sl = r.left, st = r.top;
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (dir.includes("e")) win.style.width = Math.max(MIN_W, sw + dx) + "px";
        if (dir.includes("s")) win.style.height = Math.max(MIN_H, sh + dy) + "px";
        if (dir.includes("w")) {
          const nw = Math.max(MIN_W, sw - dx);
          win.style.width = nw + "px";
          win.style.left = (sl + (sw - nw)) + "px";
        }
        if (dir.includes("n")) {
          const nh = Math.max(MIN_H, sh - dy);
          win.style.height = nh + "px";
          win.style.top = (st + (sh - nh)) + "px";
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

document.querySelectorAll(".window").forEach((w) => {
  makeDraggable(w);
  makeResizable(w);
});

// --- minimize / taskbar ---
const winApp = document.getElementById("win-app");
const taskBtn = document.getElementById("task-claude");
function setMinimized(min) {
  winApp.style.display = min ? "none" : "";
  if (taskBtn) taskBtn.classList.toggle("active", !min);
}
const minBtn = winApp && winApp.querySelector(".win-min");
if (minBtn) minBtn.addEventListener("click", () => setMinimized(true));
if (taskBtn) {
  taskBtn.addEventListener("click", () => {
    setMinimized(getComputedStyle(winApp).display !== "none");
  });
}

// --- taskbar clock ---
const clock = document.getElementById("clock");
function tickClock() {
  if (!clock) return;
  const d = new Date();
  clock.textContent = d.toTimeString().slice(0, 5);
}
tickClock();
setInterval(tickClock, 1000);

// --- voice ---
// The voice comes entirely from the server (AivisSpeech). No browser fallback:
// if the engine isn't running the app stays silent and the server logs why.
// Playback volume is fixed at 70% (30% quieter than full).
const VOICE_VOLUME = 0.7;
let serverVoice = false;
let currentAudio = null;

function updateVoiceNote() {
  if (!voiceNote) return;
  const msg = serverVoice ? "" :
    "🔇 the AivisSpeech engine isn't running — start it, then reload (see README).";
  voiceNote.textContent = msg;
  voiceNote.classList.toggle("hidden", !msg);
}

// Ask the server whether the speech engine is available.
fetch("/tts")
  .then((r) => r.json())
  .then((d) => { serverVoice = !!d.server; dlog("/tts ->", d); updateVoiceNote(); })
  .catch((e) => { dlog("/tts error", e); updateVoiceNote(); });

function stopAudio() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

// Fetch and fully decode the audio up front so it can start the instant the
// text appears (no lag while the server synthesizes). Returns a ready-to-play
// Audio element, or null if muted / unavailable / failed.
async function prepareSpeech(text) {
  if (!serverVoice) { dlog("prepareSpeech: skipped (no server voice)"); return null; }
  if (!text) { dlog("prepareSpeech: skipped (empty text)"); return null; }
  try {
    dlog("prepareSpeech: fetching /speak,", text.length, "chars");
    const resp = await fetch("/speak?text=" + encodeURIComponent(text));
    dlog("prepareSpeech: /speak status", resp.status);
    if (!resp.ok) return null;
    const url = URL.createObjectURL(await resp.blob());
    const audio = new Audio(url);
    audio.onended = audio.onerror = () => URL.revokeObjectURL(url);
    return audio;
  } catch (err) {
    dlog("prepareSpeech: error", err);
    return null;
  }
}

function showImage(src) {
  if (!src) return;
  avatar.style.opacity = "0";
  setTimeout(() => {
    avatar.src = src;
    avatar.style.opacity = "1";
  }, 120);
}

// Ask the server for an image for a mood (used for the "thinking" wait state).
async function setEmotion(emotion) {
  try {
    const res = await fetch("/image?emotion=" + encodeURIComponent(emotion));
    const data = await res.json();
    showImage(data.image);
  } catch (err) {
    /* leave the current picture as-is */
  }
}

function showBubble(text) {
  bubble.classList.remove("hidden");
  bubble.textContent = text;
  // re-trigger the pop animation
  bubble.style.animation = "none";
  void bubble.offsetWidth;
  bubble.style.animation = "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  input.value = "";
  input.disabled = true;
  dlog("submit:", JSON.stringify(message));
  setEmotion("thinking");
  showBubble("...");

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    dlog("chat response:", { emotion: data.emotion, text: data.text,
      speechLen: (data.speech || "").length, image: data.image });
    // Synthesize first, then reveal image + text + play together, all in sync.
    // (The "thinking" picture stays up until the audio is ready.)
    const audio = await prepareSpeech(data.speech || data.text || "");
    dlog("audio prepared?", !!audio);
    // Synthesize first, then reveal image + text + play together, in sync.
    // (The "thinking" picture stays up until the audio is ready.)
    showImage(data.image);
    showBubble(data.text || "...");
    if (audio) {
      stopAudio();
      currentAudio = audio;
      audio.volume = VOICE_VOLUME; // fixed 70% (30% quieter)
      const p = audio.play();
      if (p) p.then(() => dlog("audio.play() resolved"))
             .catch((err) => dlog("audio.play() REJECTED:", err));
    } else {
      dlog("no audio -> no highlighting (muted / engine down / synth failed)");
    }
  } catch (err) {
    dlog("submit error:", err);
    setEmotion("sad");
    showBubble("i couldn't reach the server... is server.py still running?");
  } finally {
    input.disabled = false;
    input.focus();
  }
});

// Pick a fresh picture on load.
setEmotion("happy");
