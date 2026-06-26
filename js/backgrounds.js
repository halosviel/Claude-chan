// ===========================================================================
//  backgrounds.js
//
//  The background-scene selector, shown as a list in the right panel. Choosing
//  one sets the scene BEHIND the transparent avatar so Claude-chan appears
//  inside it, plays a chime, and highlights the active scene.
// ===========================================================================

import { qs, fetchJson } from "./util/dom.js";
import { playSound } from "./util/sound.js";
import { dlog } from "./log.js";

const BG_KEY = "claudechan.background";

// The scene shown when nothing has been chosen yet.
const DEFAULT_BG = "_blank.png";

// Preloaded Image objects (kept referenced) so switching scenes never flickers.
const preloaded = [];

//
// Persist the chosen background so it can be restored on the next startup.
//
function rememberBackground(file) {
  try {
    localStorage.setItem(BG_KEY, file);
  } catch (error) {
    // storage unavailable; the choice just won't persist
  }
}

//
// The remembered background, or null.
//
function savedBackground() {
  try {
    return localStorage.getItem(BG_KEY);
  } catch (error) {
    return null;
  }
}

//
// Set the desktop scene behind the avatar to a background file, mark the
// matching list entry selected, and remember the choice. Exported so
// Claude-chan can change it herself.
//
export function setScene(file) {
  const portraitBody = qs(".portrait-body");

  if (portraitBody) {
    portraitBody.style.backgroundImage =
      'url("assets/backgrounds/' + encodeURI(file) + '")';
  }

  const list = qs("#bg-list");

  if (list) {
    list.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("selected", button.textContent === file);
    });
  }

  rememberBackground(file);
  dlog("scene ->", file);
}

//
// Load the background list from the server and render one clickable button per
// file. Clicking sets the scene, plays the chime, and marks it selected. Called
// at startup.
//
export async function initBackgrounds() {
  const list = qs("#bg-list");

  if (!list) {
    return;
  }

  try {
    const data = await fetchJson("/backgrounds");
    const files = data.backgrounds || [];

    list.innerHTML = "";

    files.forEach((file) => {
      const item = document.createElement("li");
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = file;
      button.title = file;

      button.addEventListener("click", () => {
        setScene(file);
        playSound("click");
      });

      item.appendChild(button);
      list.appendChild(item);

      // preload the image so the first switch to it has no white flicker
      const img = new Image();

      img.src = "assets/backgrounds/" + encodeURI(file);
      preloaded.push(img);
    });

    dlog("backgrounds loaded:", files.length);

    // Restore the remembered scene, else fall back to the default — but only if
    // the file still exists in the list.
    const saved = savedBackground();
    const initial = saved && files.includes(saved) ? saved : DEFAULT_BG;

    if (files.includes(initial)) {
      setScene(initial);
    }
  } catch (error) {
    dlog("/backgrounds error:", error);
  }
}
