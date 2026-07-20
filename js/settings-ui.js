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
import { addDownload, setDownload, failDownload, removeDownload } from "./download.js";

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
// Build the "Voice" section: a re-buildable list of catalogued voices. Installed
// ones are selectable radios; the rest offer a download button.
//
function buildVoiceList(container) {
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

  renderVoices(list);
}

//
// (Re)fill a voice-list element from /voices: a selectable radio per installed
// voice, a download button for the rest. Called on open and after an install.
//
async function renderVoices(list) {
  list.textContent = "…";

  let voices = [];
  let serverDefault = "";

  try {
    const data = await fetchJson("/voices");

    if (!data.engine_up) {
      list.textContent = "(voice engine unavailable)";
      return;
    }

    voices = data.voices || [];
    serverDefault = String(data.default || "");
  } catch (error) {
    list.textContent = "(voice engine unavailable)";
    return;
  }

  if (voices.length === 0) {
    list.textContent = "(no voices)";
    return;
  }

  const chosen = getSettings().voiceId || serverDefault;

  list.innerHTML = "";

  voices.forEach((voice) => {
    list.appendChild(voice.installed ? voiceRadio(voice, chosen, list) : voiceDownload(voice, list));
  });
}

//
// A selectable radio row for an installed voice, plus a delete button when the
// voice may be removed (everything except Runa and the two engine built-ins).
//
function voiceRadio(voice, chosen, list) {
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

  if (voice.deletable) {
    label.appendChild(deleteButton(voice, list));
  }

  return label;
}

//
// A trash button that removes a voice. It arms on the first click (to avoid an
// accidental delete + big re-download) and only deletes on a second click within
// a few seconds.
//
function deleteButton(voice, list) {
  const button = document.createElement("button");
  let armed = false;
  let timer = null;

  button.type = "button";
  button.className = "voice-del-btn";
  button.textContent = "🗑";
  button.title = "remove this voice";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!armed) {
      armed = true;
      button.classList.add("armed");
      button.title = "click again to remove";
      timer = setTimeout(() => {
        armed = false;
        button.classList.remove("armed");
        button.title = "remove this voice";
      }, 3000);
      return;
    }

    clearTimeout(timer);
    deleteVoice(voice, list);
  });

  return button;
}

//
// A row for a not-yet-installed voice: its name and a download button.
//
function voiceDownload(voice, list) {
  const row = document.createElement("div");
  const text = document.createElement("span");
  const button = document.createElement("button");

  row.className = "voice-option voice-uninstalled";
  text.textContent = voice.name;
  button.type = "button";
  button.className = "voice-dl-btn";
  button.textContent = "⬇";
  button.title = "download this voice";
  button.addEventListener("click", () => downloadVoice(voice, list));

  row.appendChild(text);
  row.appendChild(button);

  return row;
}

//
// Delete an installed voice via the server, then rebuild the list. If it was the
// selected voice, fall back to the default so nothing points at a gone voice.
//
async function deleteVoice(voice, list) {
  playSound("click");

  let data;

  try {
    data = await fetchJson("/voices/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: voice.uuid }),
    });
  } catch (error) {
    data = { ok: false };
  }

  if (data.ok && String(getSettings().voiceId) === String(voice.id)) {
    setSetting("voiceId", "");
  }

  renderVoices(list);
}

//
// Start a voice install and add a row to the downloads window, driving its bar
// until it finishes -- then switch to the new voice and rebuild the list. Several
// downloads can run at once; each polls independently by uuid.
//
async function downloadVoice(voice, list) {
  playSound("click");
  addDownload(voice.uuid, voice.name);

  try {
    await fetch("/voices/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: voice.uuid }),
    });
  } catch (error) {
    failDownload(voice.uuid, "couldn't start the download");
    return;
  }

  pollInstall(voice, list);
}

//
// Poll one voice's install status every 500ms, updating its row; on success
// switch to it and re-render, on failure leave the error on its row.
//
async function pollInstall(voice, list) {
  let data;

  try {
    data = await fetchJson("/voices/install-status?uuid=" + encodeURIComponent(voice.uuid));
  } catch (error) {
    data = { state: "error", error: "lost contact with the server" };
  }

  if (data.state === "downloading") {
    setDownload(voice.uuid, data.percent, "Downloading… " + (data.percent || 0) + "%");
  } else if (data.state === "installing") {
    setDownload(voice.uuid, 95, "Installing…");
  } else if (data.state === "done") {
    setDownload(voice.uuid, 100, "Done!");
    setSetting("voiceId", String(voice.id));
    setTimeout(() => {
      removeDownload(voice.uuid);
      renderVoices(list);
    }, 800);
    return;
  } else if (data.state === "error") {
    failDownload(voice.uuid, data.error || "download failed");
    return;
  }

  setTimeout(() => pollInstall(voice, list), 500);
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
