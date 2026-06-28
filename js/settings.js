// ===========================================================================
//  settings.js
//
//  The user-settings STORE (no UI): Master / Voice / SFX volume (0-100) and the
//  chosen voice id, persisted to localStorage. sound.js and voice.js read the
//  levels here; settings-ui.js edits them. Kept dependency-free so the audio
//  modules can import it without a cycle.
// ===========================================================================

const KEY = "claudechan.settings";
// All sliders run 0-200% with 100% as the neutral default. typeSpeed is a speed
// percent (100% = baseline pace); getTypeMs() maps it to ms-per-character.
const DEFAULTS = { master: 100, voice: 100, sfx: 100, voiceId: "", typeSpeed: 100 };

let settings = load();
const listeners = [];

//
// Load saved settings merged over the defaults.
//
function load() {
  try {
    const raw = localStorage.getItem(KEY);

    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch (error) {
    // ignore corrupt/unavailable storage
  }

  return { ...DEFAULTS };
}

//
// Persist the current settings (best effort).
//
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (error) {
    // storage unavailable; settings just won't persist
  }
}

//
// A copy of the raw settings (percent values + voiceId), for the UI.
//
export function getSettings() {
  return { ...settings };
}

// Level getters (0..1) and the chosen voice id, for the audio modules.
export function getMaster() {
  return settings.master / 100;
}

export function getVoiceLevel() {
  return settings.voice / 100;
}

export function getSfxLevel() {
  return settings.sfx / 100;
}

export function getVoiceId() {
  return settings.voiceId;
}

// Milliseconds between typed characters, from the typeSpeed percent: 100% is the
// ~18ms baseline, 200% is instant, 0% is ~36ms (slow).
export function getTypeMs() {
  const speed = Math.max(0, Math.min(200, settings.typeSpeed));

  return Math.max(0, Math.round(18 * (2 - speed / 100)));
}

//
// Register a callback run whenever a setting changes (so volumes apply live).
//
export function onSettingsChange(callback) {
  listeners.push(callback);
}

//
// Update one setting, persist, and notify listeners.
//
export function setSetting(key, value) {
  settings[key] = value;
  save();
  listeners.forEach((callback) => callback(settings));
}
