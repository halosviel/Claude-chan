// ===========================================================================
//  clock.js
//
//  The taskbar clock (12-hour or 24-hour with a day/night glyph) and the uptime
//  timer that counts how long this session has been open. Both update once a
//  second from a single tick. Clicking the clock toggles 12h/24h, remembered in
//  localStorage.
// ===========================================================================

import { qs } from "./util/dom.js";
import { playSound } from "./util/sound.js";

// Nerd Font glyphs referenced by codepoint so they do not depend on copy/paste.
const GLYPH_DAY = String.fromCodePoint(0xF05A8);
const GLYPH_NIGHT = String.fromCodePoint(0xF0594);
const GLYPH_UPTIME = String.fromCodePoint(0xF252);

// When this session started, for the uptime readout.
const START_TIME = Date.now();

// Clock format: true = 24-hour, false = 12-hour with AM/PM. Persisted so the
// choice survives a reload.
const CLOCK_KEY = "claudechan.clock24";
let use24h = readClockPref();

//
// Read the saved 12h/24h preference (defaults to 12-hour), tolerating storage
// being unavailable.
//
function readClockPref() {
  try {
    return localStorage.getItem(CLOCK_KEY) === "1";
  } catch (error) {
    return false;
  }
}

//
// Persist the 12h/24h preference (best effort).
//
function saveClockPref() {
  try {
    localStorage.setItem(CLOCK_KEY, use24h ? "1" : "0");
  } catch (error) {
    // storage unavailable; the choice just won't persist
  }
}

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
    const isDay = hours >= 6 && hours < 18;
    const glyph = isDay ? GLYPH_DAY : GLYPH_NIGHT;
    const minutes = String(now.getMinutes()).padStart(2, "0");
    let time;

    if (use24h) {
      time = String(hours).padStart(2, "0") + ":" + minutes;
    } else {
      let hours12 = hours % 12;

      if (hours12 === 0) {
        hours12 = 12;
      }

      time = hours12 + ":" + minutes + " " + (hours < 12 ? "AM" : "PM");
    }

    clock.innerHTML = '<span class="ico nf">' + glyph + "</span> " + time;
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

  if (clock) {
    clock.style.cursor = "pointer";
    clock.title = "Click to switch 12h / 24h";
    clock.addEventListener("click", () => {
      use24h = !use24h;
      saveClockPref();
      playSound("click");
      tick(clock, uptime);
    });
  }

  tick(clock, uptime);
  setInterval(() => tick(clock, uptime), 1000);
}
