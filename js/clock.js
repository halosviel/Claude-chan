// ===========================================================================
//  clock.js
//
//  The taskbar clock (12-hour with AM/PM and a day/night glyph) and the uptime
//  timer that counts how long this session has been open. Both update once a
//  second from a single tick.
// ===========================================================================

import { qs } from "./util/dom.js";

// Nerd Font glyphs referenced by codepoint so they do not depend on copy/paste.
const GLYPH_DAY = String.fromCodePoint(0xF05A8);
const GLYPH_NIGHT = String.fromCodePoint(0xF0594);
const GLYPH_UPTIME = String.fromCodePoint(0xF252);

// When this session started, for the uptime readout.
const START_TIME = Date.now();

//
// Format a number of seconds as a compact "1h 2m 3s" (omitting leading zero
// units).
//
function formatUptime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return hours + "h " + minutes + "m " + seconds + "s";
  }

  if (minutes > 0) {
    return minutes + "m " + seconds + "s";
  }

  return seconds + "s";
}

//
// Repaint the clock and uptime once. Called every second.
//
function tick(clock, uptime) {
  const now = new Date();

  if (clock) {
    const hours = now.getHours();
    const ampm = hours < 12 ? "AM" : "PM";
    const isDay = hours >= 6 && hours < 18;
    const glyph = isDay ? GLYPH_DAY : GLYPH_NIGHT;
    const minutes = String(now.getMinutes()).padStart(2, "0");

    let hours12 = hours % 12;

    if (hours12 === 0) {
      hours12 = 12;
    }

    clock.innerHTML = '<span class="ico nf">' + glyph + "</span> " +
      hours12 + ":" + minutes + " " + ampm;
  }

  if (uptime) {
    const elapsed = formatUptime(Math.floor((Date.now() - START_TIME) / 1000));

    uptime.innerHTML = '<span class="ico nf">' + GLYPH_UPTIME + "</span> " + elapsed;
  }
}

//
// Start the clock and uptime timers. Called once at startup.
//
export function initClock() {
  const clock = qs("#clock");
  const uptime = qs("#uptime");

  tick(clock, uptime);
  setInterval(() => tick(clock, uptime), 1000);
}
