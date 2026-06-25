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
// Image selection is OWNED BY THE SERVER: it scans assets/emotions/<emotion>/,
// picks a random non-repeating PNG, falls back to assets/emotions/thinking/ when
// empty. To add pictures the user just drops PNGs into the matching folder.
//
// Voice: server-only (AivisSpeech), played at a fixed 70% volume
// (VOICE_VOLUME). The voice-note <p id="voice-note"> shows a hint when /tts
// reports no engine.
// ============================================================================
// Verbose debug logging -> browser console (F12) AND the in-app terminal window.
// Flip DEBUG to false to mute. The terminal NEVER scrolls: it shows only as many
// of the most-recent lines as fit, dropping older ones (re-rendered on resize).
const DEBUG = true;
const LOG_MAX = 500;       // in-memory backlog cap
const logBuffer = [];

// Render the most recent lines that fit the terminal (oldest at top), no scroll.
function renderTerm() {
  const termLog = document.getElementById("term-log");
  if (!termLog) return;
  termLog.innerHTML = "";
  for (let i = logBuffer.length - 1; i >= 0; i--) {
    const div = document.createElement("div");
    div.textContent = logBuffer[i];
    termLog.appendChild(div);
    if (termLog.scrollHeight > termLog.clientHeight && termLog.children.length > 1) {
      termLog.removeChild(div); // this oldest-visible line no longer fits
      break;
    }
  }
  // we appended newest-first; flip to chronological order (oldest top)
  Array.from(termLog.children).reverse().forEach((k) => termLog.appendChild(k));
}

function dlog(...args) {
  if (!DEBUG) return;
  console.log("%c[claude-chan]", "color:#e8893a;font-weight:bold", ...args);
  logBuffer.push("[" + new Date().toTimeString().slice(0, 8) + "] " +
    args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
  if (logBuffer.length > LOG_MAX) logBuffer.shift();
  renderTerm();
}

// Re-fit the terminal whenever its size changes (window resize, drag-resize,
// fullscreen, open/close) so messages are added/removed to match the size.
(function () {
  const termLog = document.getElementById("term-log");
  if (termLog && window.ResizeObserver) {
    new ResizeObserver(() => renderTerm()).observe(termLog);
  }
})();

dlog("app.js loaded");

// Master sound volume: every sound in the app (voice, chime, permission, ...)
// is multiplied by this, so one knob lowers everything. 0.7 = 30% quieter.
const SOUND_SCALE = 0.7;

const avatar = document.getElementById("avatar");
const bubble = document.getElementById("bubble");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const voiceNote = document.getElementById("voice-note");

// --- chat model selector ---
// The dropdown is filled from /models (the server is the source of truth). The
// pick is remembered in localStorage and sent with every /chat request, so it
// also survives a reload. Falls back to the server's default if unset/unknown.
const modelSelect = document.getElementById("model-select");
const MODEL_KEY = "claudechan.model";
let currentModel = localStorage.getItem(MODEL_KEY) || "";

fetch("/models")
  .then((r) => r.json())
  .then((d) => {
    const models = d.models || [];
    if (modelSelect) {
      modelSelect.innerHTML = "";
      models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label || m.id;
        modelSelect.appendChild(opt);
      });
    }
    const ids = models.map((m) => m.id);
    if (!ids.includes(currentModel)) currentModel = d.default || ids[0] || "";
    if (modelSelect) modelSelect.value = currentModel;
    dlog("/models ->", { count: models.length, selected: currentModel });
  })
  .catch((e) => dlog("/models error:", e));

if (modelSelect) {
  modelSelect.addEventListener("change", () => {
    currentModel = modelSelect.value;
    localStorage.setItem(MODEL_KEY, currentModel);
    dlog("model ->", currentModel);
  });
}

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

// --- window controls: minimize, close, fullscreen, taskbar ---
function taskBtnFor(win) {
  return document.querySelector('.task-app[data-window="' + win.id + '"]');
}
function setTaskActive(win, active) {
  const btn = taskBtnFor(win);
  if (btn) btn.classList.toggle("active", active);
}
function isHidden(win) { return getComputedStyle(win).display === "none"; }

// hide with an animation ("min" or "close"), then collapse to the taskbar
function hideWindow(win, mode) {
  if (isHidden(win)) return;
  const cls = mode === "close" ? "win-anim-close" : "win-anim-min";
  win.classList.add(cls);
  const done = (e) => {
    if (e.target !== win) return; // ignore child (e.g. bubble) animations
    win.classList.remove(cls);
    win.style.display = "none";
    win.removeEventListener("animationend", done);
  };
  win.addEventListener("animationend", done);
  setTaskActive(win, false);
}
function showWindow(win) {
  win.style.display = "";
  win.style.zIndex = String(++topZ); // bring to front
  win.classList.add("win-anim-open");
  const done = (e) => {
    if (e.target !== win) return;
    win.classList.remove("win-anim-open");
    win.removeEventListener("animationend", done);
  };
  win.addEventListener("animationend", done);
  setTaskActive(win, true);
}
function toggleFullscreen(win) {
  if (win.dataset.fs === "1") {
    win.style.cssText = win.dataset.prevStyle || "";
    win.dataset.fs = "";
  } else {
    win.dataset.prevStyle = win.style.cssText;
    win.dataset.fs = "1";
    // cover the desktop but never the taskbar; sit on top (taskbar z is higher)
    win.style.position = "fixed";
    win.style.left = "0";
    win.style.top = "0";
    win.style.margin = "0";
    win.style.width = "100vw";
    win.style.height = "calc(100vh - var(--taskbar-h))";
    win.style.zIndex = "9999";
  }
}

// the permission window is wired separately (its min/close reject the request)
document.querySelectorAll(".window:not(#perm-window)").forEach((win) => {
  makeDraggable(win);
  makeResizable(win);
  const min = win.querySelector(".win-min");
  const max = win.querySelector(".win-max");
  const close = win.querySelector(".win-close");
  if (min) min.addEventListener("click", () => hideWindow(win, "min"));
  if (close) close.addEventListener("click", () => hideWindow(win, "close")); // same as minimize
  if (max) max.addEventListener("click", () => toggleFullscreen(win));
});

// taskbar buttons toggle their window
document.querySelectorAll(".task-app").forEach((btn) => {
  const win = document.getElementById(btn.dataset.window);
  if (!win) return;
  btn.addEventListener("click", () => {
    if (isHidden(win)) showWindow(win); else hideWindow(win, "min");
  });
});

// --- start menu (XP-style) ---
// The Start button toggles a tall panel above it. Items open windows or act on
// the app: Memory (opens its window), Restart (reload the page), Power off
// (close the browser tab). Clicking elsewhere / Esc closes it.
const startBtn = document.getElementById("start-btn");
const startMenu = document.getElementById("start-menu");
function isStartOpen() { return startMenu && startMenu.style.display !== "none"; }
function openStartMenu() { if (startMenu) startMenu.style.display = "flex"; }
function closeStartMenu() { if (startMenu) startMenu.style.display = "none"; }

if (startBtn) {
  startBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // don't let the document handler immediately re-close it
    if (isStartOpen()) closeStartMenu(); else openStartMenu();
  });
}
if (startMenu) startMenu.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => { if (isStartOpen()) closeStartMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeStartMenu(); });

const startMemoryBtn = document.getElementById("start-memory");
if (startMemoryBtn) startMemoryBtn.addEventListener("click", () => {
  closeStartMenu();
  const win = document.getElementById("win-memory");
  if (win) showWindow(win);
  dlog("start menu -> memory");
});

const startRestartBtn = document.getElementById("start-restart");
if (startRestartBtn) startRestartBtn.addEventListener("click", () => {
  closeStartMenu();
  dlog("start menu -> restart (reload)");
  location.reload();
});

const startPowerBtn = document.getElementById("start-poweroff");
if (startPowerBtn) startPowerBtn.addEventListener("click", () => {
  closeStartMenu();
  dlog("start menu -> power off (close window)");
  window.close();
  // Browsers refuse to close a tab they didn't open via script; if we're still
  // here a moment later, fall back to the shutdown screen as a graceful end.
  setTimeout(() => {
    const screen = document.getElementById("shutdown-screen");
    if (screen) screen.style.display = "flex";
  }, 150);
});

// --- taskbar clock (12h + AM/PM, day/night glyph) and uptime timer ---
const clock = document.getElementById("clock");
const uptimeEl = document.getElementById("uptime");
const START_TIME = Date.now();
// Nerd Font glyphs (via codepoints so they don't depend on copy/paste).
const GLYPH_DAY = String.fromCodePoint(0xF05A8);   // 󰖨 sun
const GLYPH_NIGHT = String.fromCodePoint(0xF0594); // 󰖔 moon
const GLYPH_UPTIME = String.fromCodePoint(0xF252);  // hourglass

function fmtUptime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return h + "h " + m + "m " + s + "s";
  if (m > 0) return m + "m " + s + "s";
  return s + "s";
}
function tick() {
  const d = new Date();
  if (clock) {
    let h = d.getHours();
    const ampm = h < 12 ? "AM" : "PM";
    const dayTime = h >= 6 && h < 18;
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    const mm = String(d.getMinutes()).padStart(2, "0");
    const glyph = dayTime ? GLYPH_DAY : GLYPH_NIGHT;
    clock.innerHTML = '<span class="ico nf">' + glyph + "</span> " +
      h12 + ":" + mm + " " + ampm;
  }
  if (uptimeEl) {
    const up = fmtUptime(Math.floor((Date.now() - START_TIME) / 1000));
    uptimeEl.innerHTML = '<span class="ico nf">' + GLYPH_UPTIME + "</span> " + up;
  }
}
tick();
setInterval(tick, 1000);

// --- background selector ---
// Lists assets/backgrounds/ as links; clicking one sets the scene BEHIND the
// (transparent) Claude-chan image so she appears in it, and plays a cute chime.
const portraitBody = document.querySelector(".portrait-body");
const bgList = document.getElementById("bg-list");
let audioCtx = null;
function playChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = audioCtx || new AC();
    const now = audioCtx.currentTime;
    [[880, 0], [1318.5, 0.09]].forEach(([freq, t]) => { // two cute ascending notes
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.25 * SOUND_SCALE, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.3);
    });
  } catch (err) { dlog("chime failed:", err); }
}
function setScene(file) {
  if (portraitBody) {
    portraitBody.style.backgroundImage = 'url("assets/backgrounds/' + encodeURI(file) + '")';
  }
  dlog("scene ->", file);
}
function loadBackgrounds() {
  if (!bgList) return;
  fetch("/backgrounds")
    .then((r) => r.json())
    .then((d) => {
      bgList.innerHTML = "";
      (d.backgrounds || []).forEach((file) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = file; // full filename incl. extension
        a.addEventListener("click", (e) => {
          e.preventDefault();
          setScene(file);
          playChime();
        });
        li.appendChild(a);
        bgList.appendChild(li);
      });
      dlog("backgrounds loaded:", (d.backgrounds || []).length);
    })
    .catch((e) => dlog("/backgrounds error:", e));
}
loadBackgrounds();

// --- voice ---
// The voice comes entirely from the server (AivisSpeech). No browser fallback:
// if the engine isn't running the app stays silent and the server logs why.
// Playback volume is fixed at 49%.
const VOICE_VOLUME = 0.49;
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

// Cap the avatar at 1.5x the size it has when the session first loads, so it
// won't blow up when the window is enlarged. (Still also bounded by 100% of its
// box, so it shrinks normally in small windows.)
let avatarCapped = false;
function capAvatarSize() {
  if (avatarCapped) return;
  const r = avatar.getBoundingClientRect();
  if (!r.width || !r.height) return;
  avatar.style.maxWidth = "min(100%, " + (r.width * 1.5) + "px)";
  avatar.style.maxHeight = "min(100%, " + (r.height * 1.5) + "px)";
  avatarCapped = true;
  dlog("avatar capped at 1.5x:",
    Math.round(r.width * 1.5) + "x" + Math.round(r.height * 1.5));
}
avatar.addEventListener("load", capAvatarSize);
if (avatar.complete) requestAnimationFrame(capAvatarSize);

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

async function sendMessage(message) {
  message = (message || "").trim();
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
      body: JSON.stringify({ message, model: currentModel }),
    });
    const data = await res.json();
    dlog("chat response:", { emotion: data.emotion, text: data.text,
      speechLen: (data.speech || "").length, permission: data.permission,
      image: data.image });
    // Synthesize first, then reveal image + text + play together, in sync.
    // (The "thinking" picture stays up until the audio is ready.)
    const audio = await prepareSpeech(data.speech || data.text || "");
    showImage(data.image);
    showBubble(data.text || "...");
    // If she's proposing an action, hold the permission window until she has
    // finished speaking (or, with no voice, a short beat to read) so she can
    // explain what she wants to do first. Fire once, no matter which path hits.
    let permShown = false;
    const revealPerm = () => {
      if (permShown || !data.permission) return;
      permShown = true;
      showPermission(data.permission);
    };
    if (audio) {
      stopAudio();
      currentAudio = audio;
      audio.volume = VOICE_VOLUME * SOUND_SCALE; // fixed 49%, scaled by master
      audio.addEventListener("ended", revealPerm, { once: true });
      audio.addEventListener("error", revealPerm, { once: true });
      audio.play().catch((err) => { dlog("audio.play() REJECTED:", err); revealPerm(); });
    } else if (data.permission) {
      setTimeout(revealPerm, 900);
    }
  } catch (err) {
    dlog("submit error:", err);
    setEmotion("sad");
    showBubble("i couldn't reach the server... is server.py still running?");
  } finally {
    input.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(input.value);
});

// --- permission prompt: a real draggable window ---
// Yes accepts; No / minimize / close all reject. Fullscreen just toggles.
const permWindow = document.getElementById("perm-window");
const permText = document.getElementById("perm-text");

function showPermission(summary) {
  if (!permWindow) return;
  permText.textContent = summary;
  permWindow.dataset.fs = "";
  permWindow.style.cssText = "";   // clear any leftover drag/fullscreen styles
  permWindow.style.display = "";    // -> .window flex
  const w = permWindow.offsetWidth, h = permWindow.offsetHeight;
  permWindow.style.position = "fixed";
  permWindow.style.left = Math.max(8, (innerWidth - w) / 2) + "px";
  permWindow.style.top = Math.max(8, (innerHeight - h) / 2 - 20) + "px";
  permWindow.style.zIndex = String(++topZ);
  try {
    const a = new Audio("/permission-sound");
    a.volume = SOUND_SCALE;
    a.play().catch(() => {});
  } catch (e) { /* */ }
  dlog("permission requested:", summary);
}
function hidePermission() { if (permWindow) permWindow.style.display = "none"; }
function acceptPermission() { hidePermission(); sendMessage("yes, go ahead!"); }
function rejectPermission() { hidePermission(); sendMessage("no, please don't."); }

if (permWindow) {
  makeDraggable(permWindow);
  const pMin = permWindow.querySelector(".win-min");
  const pMax = permWindow.querySelector(".win-max");
  const pClose = permWindow.querySelector(".win-close");
  if (pMin) pMin.addEventListener("click", rejectPermission);   // minimize = reject
  if (pClose) pClose.addEventListener("click", rejectPermission); // close = reject
  if (pMax) pMax.addEventListener("click", () => toggleFullscreen(permWindow));
  const permYes = document.getElementById("perm-yes");
  const permNo = document.getElementById("perm-no");
  if (permYes) permYes.addEventListener("click", acceptPermission);
  if (permNo) permNo.addEventListener("click", rejectPermission);
}

// Pick a fresh picture on load.
setEmotion("happy");
