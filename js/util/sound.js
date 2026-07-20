// ===========================================================================
//  sound.js
//
//  Every sound in the app passes through here so a single master scale governs
//  volume. Exposes file-based sound effects (assets/sounds/<name>.mp3) and a
//  generic Web Audio tone player, with a ready-made two-note chime built on it.
// ===========================================================================

import { SOUND_VOLUMES, DEFAULT_SOUND_VOLUME } from "../config.js";
import { getMaster, getSfxLevel } from "../settings.js";

//
// The 0..1 playback gain for a named sound: its per-sound config weight, scaled
// by the SFX-volume and Master-volume settings.
//
function sfxGain(name) {
  const percent = name in SOUND_VOLUMES ? SOUND_VOLUMES[name] : DEFAULT_SOUND_VOLUME;
  const weight = Math.max(0, Math.min(100, percent)) / 100;

  return weight * getSfxLevel() * getMaster();
}

// A single lazily-created AudioContext, reused by every synthesized tone.
let audioContext = null;

//
// Return the shared AudioContext, creating it on first use. Browsers only allow
// it to start after a user gesture, so creation is deferred until a sound plays.
//
export function getAudioContext() {
  if (!audioContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctor();
  }

  return audioContext;
}

// Every UI sound effect file (assets/sounds/<name>.mp3). Each is decoded once
// into an AudioBuffer and replayed from memory: fetching per play would
// re-download the clip every time (the server sends Cache-Control: no-store), so
// the first press would lag -- decoding up front makes every play instant.
const SFX_FILES = [
  "type", "click", "message-sent",
  "app-open", "app-close", "app-minimize", "app-fullscreen",
  "ask-permission",
];

// name -> decoded AudioBuffer (null while a load is in flight, absent if never
// requested).
const buffers = new Map();
let preloadArmed = false;

//
// Fetch and decode one sound file into the buffer cache (once). Needs the
// AudioContext, which browsers only allow after a user gesture -- so this runs
// from a real gesture (preloadSounds' hook or a play call), never at page load.
//
async function loadBuffer(name) {
  if (buffers.has(name)) {
    return;
  }

  buffers.set(name, null); // reserve so concurrent calls don't double-fetch

  try {
    const context = getAudioContext();
    const response = await fetch("assets/sounds/" + name + ".mp3");
    const bytes = await response.arrayBuffer();

    buffers.set(name, await context.decodeAudioData(bytes));
  } catch (error) {
    buffers.delete(name); // let a later play retry
  }
}

//
// Decode every UI sound into memory on the first user gesture, so no effect ever
// has to fetch/decode mid-interaction. Safe to call at startup: it only arms a
// one-shot listener (the AudioContext cannot start before a gesture). Called once
// from main().
//
export function preloadSounds() {
  const arm = () => {
    if (preloadArmed) {
      return;
    }

    preloadArmed = true;
    SFX_FILES.forEach(loadBuffer);
  };

  window.addEventListener("pointerdown", arm, { once: true });
  window.addEventListener("keydown", arm, { once: true });
}

//
// Play a decoded buffer through a gain node (honouring >100% volume), with an
// optional random detune in cents. Returns false when the buffer isn't ready.
//
function playBuffer(name, detuneCents = 0) {
  const buffer = buffers.get(name);

  if (!buffer) {
    return false;
  }

  try {
    const context = getAudioContext();
    const source = context.createBufferSource();
    const gain = context.createGain();

    source.buffer = buffer;
    source.detune.value = detuneCents;
    gain.gain.value = sfxGain(name);
    source.connect(gain).connect(context.destination);
    source.start();
  } catch (error) {
    // a dropped sound effect is harmless
  }

  return true;
}

//
// Play a named UI sound effect. Uses the preloaded buffer when available
// (instant, no re-fetch, no 100% volume cap); before the cache is warm it falls
// back to a plain <audio> fetch and warms the buffer for next time. Failures
// (missing file, autoplay block) are swallowed on purpose.
//
export function playSound(name) {
  if (playBuffer(name)) {
    return;
  }

  loadBuffer(name);

  try {
    const audio = new Audio("assets/sounds/" + name + ".mp3");

    audio.volume = Math.min(1, sfxGain(name));
    audio.play().catch(() => {});
  } catch (error) {
    // A sound effect failing to load is never worth interrupting the app for.
  }
}

//
// Play the keystroke sound with a small random pitch shift (+/- ~120 cents), so
// rapid typing doesn't sound mechanically identical. Replays the preloaded
// buffer; before it's warm the first press just kicks the load and stays silent.
//
export function playKey() {
  if (!playBuffer("type", (Math.random() * 2 - 1) * 120)) {
    loadBuffer("type");
  }
}

//
// Play a sequence of short synthesized tones. Each note is { freq, at, dur },
// where `at` is an offset in seconds from now and `dur` defaults to 0.3s. This
// is the reusable primitive behind every in-app jingle.
//
export function playTones(notes) {
  try {
    const context = getAudioContext();
    const now = context.currentTime;

    notes.forEach((note) => {
      const start = now + (note.at || 0);
      const duration = note.dur || 0.3;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = note.type || "triangle";
      oscillator.frequency.value = note.freq;

      // exponential ramps can't target exactly 0, so clamp to a tiny floor
      const peak = Math.max(0.0001, (DEFAULT_SOUND_VOLUME / 100) * getSfxLevel() * getMaster());

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration - 0.02);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    });
  } catch (error) {
    // Web Audio can be unavailable; a missing chime is harmless.
  }
}

//
// Play the app's signature two-note ascending chime (used when a background
// scene is chosen). A thin preset over playTones.
//
export function playChime() {
  playTones([
    { freq: 880, at: 0 },
    { freq: 1318.5, at: 0.09 },
  ]);
}
