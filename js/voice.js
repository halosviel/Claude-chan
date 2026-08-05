// ===========================================================================
//  voice.js
//
//  Server-rendered speech (AivisSpeech). There is no browser fallback: if the
//  engine is not running the app stays silent and shows a hint. Audio is fully
//  decoded up front (prepareSpeech) so it can begin in sync with the typed-out
//  reply, and only one clip plays at a time. Rendered clips are kept in a
//  small cache, so a line she has already said can be replayed for free (the
//  backlog does exactly that).
// ===========================================================================

import { qs, fetchJson } from "./util/dom.js";
import { dlog } from "./log.js";
import { t, onChange } from "./i18n.js";
import { getAudioContext } from "./util/sound.js";
import { getMaster, getVoiceLevel, getVoiceId } from "./settings.js";

// Whether the server reported a working speech engine, and the clip currently
// playing (so a new reply can interrupt an old one).
let serverVoiceReady = false;
let currentAudio = null;

//
// True when the server has a speech engine available.
//
export function isVoiceEnabled() {
  return serverVoiceReady;
}

//
// Show or clear the "engine isn't running" hint under the input.
//
function updateVoiceNote() {
  const voiceNote = qs("#voice-note");

  if (!voiceNote) {
    return;
  }

  const message = serverVoiceReady ? "" : t("voice.note");

  voiceNote.textContent = message;
  voiceNote.classList.toggle("hidden", !message);
}

//
// Stop and discard any currently playing voice clip.
//
export function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

//
// Ask the server whether the speech engine is available and update the hint.
// The engine can still be warming up (~25s cold start) when the page loads, so
// poll instead of deciding once -- the hint clears the moment it answers.
//
export async function initVoice() {
  onChange(updateVoiceNote);
  pollEngineReady();
}

//
// Poll /tts until the engine reports ready (or ~90s passes), refreshing the
// hint each time. Runs detached so it never blocks page startup.
//
async function pollEngineReady() {
  const deadline = Date.now() + 90000;

  for (;;) {
    let ready = false;

    try {
      const data = await fetchJson("/tts");

      ready = !!data.server;
      dlog("/tts ->", data);
    } catch (error) {
      dlog("/tts error", error);
    }

    serverVoiceReady = ready;
    updateVoiceNote();

    if (ready || Date.now() > deadline) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

// Rendered clips, keyed by the voice that spoke them plus the Japanese line, so
// a line she has already said can be played again without paying for another
// synthesis. The BLOB is what is kept -- not the Audio element, whose object URL
// is revoked the moment it finishes -- and the least recently used clip is
// dropped once the cache is full. The server keeps its own copy on disk, so a
// reload only costs the download, never a re-render.
const clipCache = new Map();
const CLIP_CACHE_MAX = 50;

//
// Key a clip by the voice that rendered it, so switching voices re-synthesizes
// rather than replaying the old voice's take.
//
function clipKey(text) {
  return getVoiceId() + "|" + text;
}

//
// Remember a rendered clip, evicting the least recently used once full.
//
function cacheClip(text, blob) {
  const key = clipKey(text);

  clipCache.delete(key);
  clipCache.set(key, blob);

  if (clipCache.size > CLIP_CACHE_MAX) {
    clipCache.delete(clipCache.keys().next().value);
  }
}

//
// Wrap a cached clip in a fresh Audio element, freeing its object URL when the
// clip ends. A new element is built per playback because that URL is one-shot.
//
function audioFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  audio.onended = audio.onerror = () => URL.revokeObjectURL(url);

  return audio;
}

//
// Fetch and fully decode a clip for `text` so it can start the instant the
// reply appears (no lag while the server synthesizes). Returns a ready Audio
// element, or null when muted / unavailable / failed. A cached clip is reused
// as-is, which is what makes replaying a line instant -- and keeps it working
// even after the engine has gone away.
//
export async function prepareSpeech(text) {
  if (!text) {
    dlog("prepareSpeech: skipped (empty text)");
    return null;
  }

  const cached = clipCache.get(clipKey(text));

  if (cached) {
    dlog("prepareSpeech: cache hit,", text.length, "chars");
    return audioFromBlob(cached);
  }

  if (!serverVoiceReady) {
    dlog("prepareSpeech: skipped (no server voice)");
    return null;
  }

  try {
    dlog("prepareSpeech: fetching /speak,", text.length, "chars");

    const voiceId = getVoiceId();
    const speakerParam = voiceId ? "&speaker=" + encodeURIComponent(voiceId) : "";
    const response = await fetch("/speak?text=" + encodeURIComponent(text) + speakerParam);

    dlog("prepareSpeech: /speak status", response.status);

    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();

    cacheClip(text, blob);

    return audioFromBlob(blob);
  } catch (error) {
    dlog("prepareSpeech: error", error);
    return null;
  }
}

//
// Play a previously prepared clip, interrupting any current one. onEnd fires
// once when the clip finishes, errors, or cannot start, so callers can sequence
// follow-up actions (such as revealing a permission prompt) after she speaks.
//
export function playPrepared(audio, options = {}) {
  const onEnd = options.onEnd || (() => {});

  stopAudio();
  currentAudio = audio;

  // Route through a Web Audio gain node so her voice can exceed 100% (the bare
  // <audio>.volume is capped at 1). Falls back to a clamped element volume if the
  // context/source can't be set up.
  const level = getVoiceLevel() * getMaster();

  try {
    const context = getAudioContext();

    if (context.state === "suspended") {
      context.resume();
    }

    if (!audio.gainNode) {
      const source = context.createMediaElementSource(audio);

      audio.gainNode = context.createGain();
      source.connect(audio.gainNode).connect(context.destination);
    }

    audio.gainNode.gain.value = level;
    audio.volume = 1;
  } catch (error) {
    audio.volume = Math.min(1, level);
  }

  audio.addEventListener("ended", onEnd, { once: true });
  audio.addEventListener("error", onEnd, { once: true });
  audio.play().then(() => {
    // Watchdog: if it's still at 0s a moment later (and not deliberately muted),
    // she isn't actually speaking even though we tried -- log it.
    setTimeout(() => {
      if (currentAudio === audio && !audio.ended && audio.currentTime === 0 && audio.volume > 0) {
        dlog("voice: clip did not start playing (still 0s) -- she may be silent");
      }
    }, 500);
  }).catch((error) => {
    dlog("audio.play() REJECTED -- she did not speak:", error);
    onEnd();
  });
}
