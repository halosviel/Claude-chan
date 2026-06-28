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

//
// Play a named UI sound effect from assets/sounds/<name>.mp3 at the accent
// volume. Failures (missing file, autoplay block) are swallowed on purpose.
//
export function playSound(name) {
  try {
    const audio = new Audio("assets/sounds/" + name + ".mp3");

    // <audio> volume is capped at 1 by the browser, so a file SFX can't exceed
    // 100%; the synthesized tones below (Web Audio) do honour >100%.
    audio.volume = Math.min(1, sfxGain(name));
    audio.play().catch(() => {});
  } catch (error) {
    // A sound effect failing to load is never worth interrupting the app for.
  }
}

// Decoded keystroke sample, loaded lazily on first use.
let keyBuffer = null;
let keyLoading = false;

//
// Load and decode assets/sounds/type.mp3 into a buffer (once). Needs the
// AudioContext, which is only allowed after a user gesture, so this is kicked
// off from the first keystroke.
//
async function ensureKeyBuffer() {
  if (keyBuffer || keyLoading) {
    return;
  }

  keyLoading = true;

  try {
    const context = getAudioContext();
    const response = await fetch("assets/sounds/type.mp3");
    const bytes = await response.arrayBuffer();

    keyBuffer = await context.decodeAudioData(bytes);
  } catch (error) {
    // missing/undecodable sample: typing just stays silent
  }

  keyLoading = false;
}

//
// Play the keystroke sound with a small random pitch shift (+/- ~120 cents), so
// rapid typing doesn't sound mechanically identical. Cheap: replays one decoded
// buffer per press.
//
export function playKey() {
  ensureKeyBuffer();

  if (!keyBuffer) {
    return;
  }

  try {
    const context = getAudioContext();
    const source = context.createBufferSource();
    const gain = context.createGain();

    source.buffer = keyBuffer;
    source.detune.value = (Math.random() * 2 - 1) * 120;
    gain.gain.value = sfxGain("type");
    source.connect(gain).connect(context.destination);
    source.start();
  } catch (error) {
    // a dropped keystroke sound is harmless
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
