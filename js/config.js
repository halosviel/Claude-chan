// ===========================================================================
//  config.js
//
//  Hand-editable settings for Claude-chan. Tweak the values below and reload —
//  nothing else needs to change. (This file holds plain constants only; no
//  logic lives here.)
// ===========================================================================

// --- Sound effect volumes -------------------------------------------------
// One entry per sound file in assets/sounds/ (without the .mp3). The value is a
// percentage of the file's ORIGINAL volume: 100 = full/original, 0 = silent.
// (This does NOT affect Claude-chan's spoken voice.)
export const SOUND_VOLUMES = {
  "app-open": 100,
  "app-close": 100,
  "app-minimize": 100,
  "app-fullscreen": 100,
  "ask-permission": 100,
  "click": 100,
  "message-sent": 100,
  "type": 100,
};

// Volume (same 0-100 scale) used for any sound not listed above, plus the
// synthesized background-select chime (which isn't a file in assets/sounds/).
export const DEFAULT_SOUND_VOLUME = 100;

// --- Theme colors ---------------------------------------------------------
// PRIMARY is used for window title bars, the taskbar, and the section headers
// in the Claude-chan app. SECONDARY is used for selected
// list items (background / model / language) and user backlog messages.
export const PRIMARY_COLOR = "#e8893a";
export const SECONDARY_COLOR = "#f18d8d";

// HOVER_COLOR is the background of a list option (a model, language, background,
// or voice) while your mouse hovers over it — before it's actually selected.
export const HOVER_COLOR = "#e9b2b2";

// --- Dialogue typing speed ------------------------------------------------
// Milliseconds between characters as Claude-chan types out her reply in the

// dialogue box. Lower = faster (e.g. 18 is brisk, 40 is slow, 0 is instant).
export const DIALOGUE_TYPE_MS = 18;

// --- Auto-reset on inactivity ---------------------------------------------
// How long (milliseconds) to wait with no interaction after Claude-chan's last
// dialogue section before the box and her portrait reset to the fresh idle
// state. 20000 = 20s; raise for more patience, lower to reset sooner.
export const IDLE_RESET_MS = 15000;
