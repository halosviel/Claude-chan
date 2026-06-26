// ===========================================================================
//  models.js
//
//  The chat-model picker, shown as a list of every available model in the left
//  panel. The server (GET /models) is the source of truth for which models
//  exist and the default; the user's pick is remembered in localStorage and
//  sent with every message, so it survives a reload.
// ===========================================================================

import { qs, fetchJson } from "./util/dom.js";
import { dlog } from "./log.js";
import { playSound } from "./util/sound.js";

const MODEL_KEY = "claudechan.model";

// The currently selected model id, seeded from localStorage.
let currentModel = localStorage.getItem(MODEL_KEY) || "";

//
// The model id to send with the next message.
//
export function getCurrentModel() {
  return currentModel;
}

//
// Render the model list from the server, restore the remembered pick (falling
// back to the server default), and persist + re-highlight on click. Called once
// at startup.
//
export async function initModels() {
  const list = qs("#model-list");
  let models = [];
  let fallback = "";

  try {
    const data = await fetchJson("/models");

    models = data.models || [];
    fallback = data.default || "";
    dlog("/models ->", { count: models.length });
  } catch (error) {
    dlog("/models error:", error);
  }

  const ids = models.map((model) => model.id);

  if (!ids.includes(currentModel)) {
    currentModel = fallback || ids[0] || "";
  }

  if (!list) {
    return;
  }

  list.innerHTML = "";

  models.forEach((model) => {
    const item = document.createElement("li");
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = model.label || model.id;
    button.dataset.id = model.id;
    button.classList.toggle("selected", model.id === currentModel);

    button.addEventListener("click", () => {
      currentModel = model.id;
      localStorage.setItem(MODEL_KEY, currentModel);
      playSound("click");

      list.querySelectorAll("button").forEach((other) => {
        other.classList.toggle("selected", other.dataset.id === currentModel);
      });

      dlog("model ->", currentModel);
    });

    item.appendChild(button);
    list.appendChild(item);
  });
}
