// ===========================================================================
//  thinktimer.js
//
//  A little "how long is she taking" counter in the dialogue box. It starts at
//  0s the moment you send a message and ticks up every second while she thinks,
//  then disappears the instant she starts replying.
// ===========================================================================

import { qs } from "./util/dom.js";

let el = null;
let timer = null;
let seconds = 0;

//
// Paint the current value.
//
function paint() {
  if (el) {
    el.textContent = seconds + "s";
  }
}

//
// Stop the per-second tick (without hiding the value).
//
function stopTick() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

//
// Start counting from 0 (called when a message is sent).
//
export function startThinkTimer() {
  el = el || qs("#dialogue-timer");
  stopTick();
  seconds = 0;
  paint();

  if (el) {
    el.classList.add("visible");
  }

  timer = setInterval(() => {
    seconds += 1;
    paint();
  }, 1000);
}

//
// Clear and hide it (when she starts replying, or you start typing).
//
export function clearThinkTimer() {
  stopTick();
  seconds = 0;

  if (el) {
    el.classList.remove("visible");
  }
}
