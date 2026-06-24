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
// Voice: server-only (AivisSpeech). The #volume dropdown sets `volume` (0-100,
// persisted in localStorage; 0 = mute). The voice-note <p id="voice-note">
// shows a hint when /tts says no engine.
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
const volumeSel = document.getElementById("volume");
const voiceNote = document.getElementById("voice-note");

// --- voice ---
// The voice comes entirely from the server (AivisSpeech). No browser fallback:
// if the engine isn't running the app stays silent and the server logs why.
// Volume is 0-100, chosen via the dropdown and persisted in localStorage.
// volume === 0 acts as mute (no synthesis, no playback).
let serverVoice = false;
let currentAudio = null;
let volume = parseInt(localStorage.getItem("claudechan_volume"), 10);
if (isNaN(volume)) volume = 100;

function updateVoiceNote() {
  if (!voiceNote) return;
  const silent = volume === 0;
  const msg = serverVoice ? "" :
    "🔇 the AivisSpeech engine isn't running — start it, then reload (see README).";
  voiceNote.textContent = silent ? "" : msg;
  voiceNote.classList.toggle("hidden", silent || !msg);
}

if (volumeSel) {
  volumeSel.value = String(volume);
  volumeSel.addEventListener("change", () => {
    volume = parseInt(volumeSel.value, 10) || 0;
    localStorage.setItem("claudechan_volume", String(volume));
    if (currentAudio) currentAudio.volume = volume / 100;
    if (volume === 0) stopAudio();
    updateVoiceNote();
    dlog("volume set to", volume + "%");
  });
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
  if (volume === 0) { dlog("prepareSpeech: skipped (volume 0)"); return null; }
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
      audio.volume = volume / 100; // apply the chosen volume
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
