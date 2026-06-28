// ===========================================================================
//  settings-ui.js
//
//  The Settings popup (opened from the Start menu): Master / Voice / SFX volume
//  sliders and a radio list of installed voices. Reads/writes the settings.js
//  store, so every change saves immediately.
// ===========================================================================

import { qs, fetchJson } from "./util/dom.js";
import { playSound, playKey } from "./util/sound.js";
import { showWindowCentered, hideWindow } from "./windowing.js";
import { getSettings, setSetting } from "./settings.js";

//
// Build one labeled 0-100 volume slider bound to a setting key.
//
function buildSlider(key, label) {
  const settings = getSettings();
  const row = document.createElement("div");
  const head = document.createElement("div");
  const name = document.createElement("span");
  const value = document.createElement("span");
  const slider = document.createElement("input");

  row.className = "settings-row";
  head.className = "settings-head";
  name.textContent = label;
  value.className = "settings-value";
  value.textContent = settings[key] + "%";

  slider.type = "range";
  slider.min = "0";
  slider.max = "200";
  slider.value = String(settings[key]);
  slider.className = "settings-slider";
  slider.addEventListener("input", () => {
    const v = Number(slider.value);

    value.textContent = v + "%";
    setSetting(key, v);
    playKey();
  });

  head.appendChild(name);
  head.appendChild(value);
  row.appendChild(head);
  row.appendChild(slider);

  return row;
}

//
// Load the installed voices from the server and render them as radio buttons.
//
async function buildVoiceList(container) {
  const section = document.createElement("div");
  const title = document.createElement("div");
  const list = document.createElement("div");

  section.className = "settings-row";
  title.className = "settings-head";
  title.textContent = "Voice";
  list.className = "voice-list";
  section.appendChild(title);
  section.appendChild(list);
  container.appendChild(section);

  let voices = [];
  let serverDefault = "";

  try {
    const data = await fetchJson("/voices");

    voices = data.voices || [];
    serverDefault = String(data.default || "");
  } catch (error) {
    list.textContent = "(voice engine unavailable)";
    return;
  }

  if (voices.length === 0) {
    list.textContent = "(no voices installed)";
    return;
  }

  const chosen = getSettings().voiceId || serverDefault;

  voices.forEach((voice) => {
    const id = String(voice.id);
    const label = document.createElement("label");
    const radio = document.createElement("input");
    const text = document.createElement("span");

    label.className = "voice-option";
    radio.type = "radio";
    radio.name = "voice";
    radio.value = id;
    radio.checked = id === chosen;
    radio.addEventListener("change", () => {
      setSetting("voiceId", id);
      playSound("click");
    });
    text.textContent = voice.name;

    label.appendChild(radio);
    label.appendChild(text);
    list.appendChild(label);
  });
}

//
// (Re)build the popup body: three volume sliders and the voice list.
//
function render(body) {
  body.innerHTML = "";
  body.appendChild(buildSlider("master", "Master volume"));
  body.appendChild(buildSlider("voice", "Voice volume"));
  body.appendChild(buildSlider("sfx", "SFX volume"));
  body.appendChild(buildSlider("typeSpeed", "Typing speed"));
  buildVoiceList(body);
}

//
// True when the settings popup is open.
//
function isOpen(win) {
  return win && getComputedStyle(win).display !== "none";
}

//
// Wire the Start-menu "Settings" item to toggle the centered popup. Called once
// at startup.
//
export function initSettings() {
  const button = qs("#start-settings");
  const win = qs("#win-settings");
  const body = qs("#settings-body");

  if (!button || !win || !body) {
    return;
  }

  button.addEventListener("click", () => {
    const menu = qs("#start-menu");

    if (menu) {
      menu.style.display = "none";
    }

    if (isOpen(win)) {
      hideWindow(win, "min");
      return;
    }

    render(body);
    showWindowCentered(win);
  });
}
