// ===========================================================================
//  avatar.js
//
//  Claude-chan's portrait: cross-fading the image when her mood changes, and
//  asking the server for a fresh picture for a given emotion. The displayed
//  image is size-capped in CSS (not the container), so enlarging or
//  fullscreening the window never reveals an empty over-sized frame. Image
//  selection itself is owned by the server.
// ===========================================================================

import { qs, fetchJson } from "./util/dom.js";
import { dlog } from "./log.js";

// Preloaded portrait Image objects, kept referenced so a mood swap shows the
// picture instantly instead of fetching/decoding it on first use.
const preloaded = [];

//
// Fetch the full list of mood portraits and load every one into memory, so
// switching moods never has to fetch first (no flicker on a picture's first
// show). Called once at startup; failures just skip the warm-up.
//
export async function preloadPortraits() {
  try {
    const data = await fetchJson("/portraits");

    (data.portraits || []).forEach((src) => {
      const img = new Image();

      img.src = src;
      preloaded.push(img);
    });

    dlog("portraits preloaded:", preloaded.length);
  } catch (error) {
    dlog("/portraits error:", error);
  }
}

//
// Cross-fade the avatar to a new image source. A null/empty source is ignored
// so a failed lookup leaves the current picture in place.
//
export function showImage(src) {
  if (!src) {
    return;
  }

  const avatar = qs("#avatar");

  avatar.style.opacity = "0";

  setTimeout(() => {
    avatar.src = src;
    avatar.style.opacity = "1";
  }, 120);
}

//
// Ask the server for a picture matching a mood and show it. Used for the
// "thinking" wait state and any other direct mood change. Errors leave the
// current picture untouched.
//
export async function setEmotion(emotion) {
  try {
    const data = await fetchJson("/image?emotion=" + encodeURIComponent(emotion));

    showImage(data.image);
  } catch (error) {
    dlog("setEmotion failed for", emotion, "-", error);
  }
}
