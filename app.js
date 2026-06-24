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
// Voice: server-only (AivisSpeech). The 🔊/🔇 button toggles `muted`. The
// voice-note <p id="voice-note"> shows a hint when /tts says no engine.
// ============================================================================
const avatar = document.getElementById("avatar");
const bubble = document.getElementById("bubble");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const muteBtn = document.getElementById("mute");
const voiceNote = document.getElementById("voice-note");

// --- voice ---
// The voice comes entirely from the server (AivisSpeech). No browser fallback:
// if the engine isn't running the app stays silent and the server logs why.
let serverVoice = false;
let muted = false;
let currentAudio = null;

function updateVoiceNote() {
  if (!voiceNote) return;
  const msg = serverVoice ? "" :
    "🔇 the AivisSpeech engine isn't running — start it, then reload (see README).";
  voiceNote.textContent = muted ? "" : msg;
  voiceNote.classList.toggle("hidden", muted || !msg);
}

// Ask the server whether the speech engine is available.
fetch("/tts")
  .then((r) => r.json())
  .then((d) => { serverVoice = !!d.server; updateVoiceNote(); })
  .catch(() => updateVoiceNote());

function stopAudio() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

// Fetch and fully decode the audio up front so it can start the instant the
// text appears (no lag while the server synthesizes). Returns a ready-to-play
// Audio element, or null if muted / unavailable / failed.
async function prepareSpeech(text) {
  if (muted || !serverVoice || !text) return null;
  try {
    const resp = await fetch("/speak?text=" + encodeURIComponent(text));
    if (!resp.ok) return null;
    const url = URL.createObjectURL(await resp.blob());
    const audio = new Audio(url);
    audio.onended = audio.onerror = () => URL.revokeObjectURL(url);
    return audio;
  } catch (err) {
    return null;
  }
}

if (muteBtn) {
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    if (muted) stopAudio();
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.title = muted ? "Voice off" : "Voice on";
    updateVoiceNote();
  });
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
  setEmotion("thinking");
  showBubble("...");

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    // Synthesize first, then reveal image + text + play together, all in sync.
    // (The "thinking" picture stays up until the audio is ready.)
    const audio = await prepareSpeech(data.speech || data.text || "");
    showImage(data.image);
    showBubble(data.text || "...");
    if (audio) {
      stopAudio();
      currentAudio = audio;
      audio.play().catch(() => {});
    }
  } catch (err) {
    setEmotion("sad");
    showBubble("i couldn't reach the server... is server.py still running?");
  } finally {
    input.disabled = false;
    input.focus();
  }
});

// Pick a fresh picture on load.
setEmotion("happy");
