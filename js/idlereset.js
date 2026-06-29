// ===========================================================================
//  idlereset.js
//
//  Auto-reset after inactivity. Once Claude-chan has played out her LAST
//  dialogue section and is sitting idle, a 20s countdown is armed; if the user
//  doesn't interact for that long, the dialogue box and her portrait reset to
//  the fresh idle state (as at boot). Any interaction -- a key, a pointer move
//  or press, a wheel -- restarts the countdown; starting a new turn or stepping
//  into typing disarms it. The actual reset work is injected from chat.js, so
//  the only thing this module pulls in is the IDLE_RESET_MS constant.
// ===========================================================================

import { IDLE_RESET_MS } from "./config.js";

// Coalesce high-frequency activity (pointer moves) so the countdown restarts at
// most once a second -- on a 20s timer the lost precision is invisible.
const BUMP_THROTTLE_MS = 1000;

let timer = null;
let lastBump = 0;
let onReset = null;

//
// Stop the countdown if it is running.
//
export function cancelIdleReset() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

//
// Fire the reset and clear the timer.
//
function fire() {
  timer = null;

  if (onReset) {
    onReset();
  }
}

//
// (Re)start the 20s countdown. Called when her last section has been reached.
//
export function armIdleReset() {
  cancelIdleReset();
  lastBump = Date.now();
  timer = setTimeout(fire, IDLE_RESET_MS);
}

//
// Restart the countdown on user activity, but only while it's armed and at most
// once per throttle window.
//
function bump() {
  if (timer === null) {
    return;
  }

  const now = Date.now();

  if (now - lastBump < BUMP_THROTTLE_MS) {
    return;
  }

  lastBump = now;
  clearTimeout(timer);
  timer = setTimeout(fire, IDLE_RESET_MS);
}

//
// Remember the reset callback and listen for user activity. Called once at
// startup.
//
export function initIdleReset(resetFn) {
  onReset = resetFn;

  for (const event of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]) {
    document.addEventListener(event, bump, { passive: true });
  }
}
