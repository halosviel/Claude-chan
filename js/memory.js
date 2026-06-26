// ===========================================================================
//  memory.js
//
//  The Memory window's contents: a persistent list of Claude-chan-related
//  memories shown under the intro text. The list survives reloads (localStorage)
//  and can be added to by Claude-chan herself (see actions.js / "remember ..."),
//  which is what the intro means by "simply tell her".
// ===========================================================================

import { qs } from "./util/dom.js";

const MEMORY_KEY = "claudechan.memories";

// The memories a fresh install starts with (facts about Claude-chan).
const SEED = [
  "I'm Claude-chan, your local desktop companion. ♡",
  "I speak my replies out loud in Japanese.",
  "My portrait shows my mood as we talk.",
  "I live entirely on your computer — no cloud, no API key.",
];

let memories = load();

//
// Load saved memories, falling back to the seed list.
//
function load() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);

    if (raw) {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    // ignore corrupt/unavailable storage
  }

  return SEED.slice();
}

//
// Persist the current memories (best effort).
//
function save() {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
  } catch (error) {
    // storage unavailable; memories just won't persist
  }
}

//
// Re-render the memory list into the Memory window.
//
function render() {
  const list = qs("#memory-list");

  if (!list) {
    return;
  }

  const fragment = document.createDocumentFragment();

  // Present the memories as prose paragraphs (not a bulleted list).
  memories.forEach((memory) => {
    const para = document.createElement("p");

    para.textContent = memory;
    fragment.appendChild(para);
  });

  list.innerHTML = "";
  list.appendChild(fragment);
}

//
// The current memories (a copy).
//
export function getMemories() {
  return memories.slice();
}

//
// Add a memory (used when Claude-chan is told to remember something), persist,
// and refresh the window.
//
export function addMemory(text) {
  const memory = (text || "").trim();

  if (!memory) {
    return;
  }

  memories.push(memory);
  save();
  render();
}

//
// Render the memory list at startup.
//
export function initMemory() {
  render();
}
