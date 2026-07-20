// ===========================================================================
//  main.js
//
//  Entry point. Imports every feature module and starts it in order, then wires
//  the editor's submit to the chat flow and shows an opening picture. This is
//  the only script the page loads (as a module); everything else is reached
//  through its imports.
// ===========================================================================

import { PRIMARY_COLOR, SECONDARY_COLOR, HOVER_COLOR } from "./config.js";
import { initTerminal } from "./log.js";
import { initServerLog } from "./serverlog.js";
import { initI18n } from "./i18n.js";
import { initWindowing } from "./windowing.js";
import { initStartMenu } from "./startmenu.js";
import { initClock } from "./clock.js";
import { initDateBox } from "./datebox.js";
import { initModels } from "./models.js";
import { initVoice } from "./voice.js";
import { initBackgrounds } from "./backgrounds.js";
import { setEmotion, preloadPortraits } from "./avatar.js";
import { preloadSounds, playChime } from "./util/sound.js";
import { initPermission } from "./permission.js";
import { initCredits } from "./credits.js";
import { initEditor } from "./editor.js";
import { initTranscript } from "./transcript.js";
import { initHelp } from "./help.js";
import { initMemory } from "./memory.js";
import { initSettings } from "./settings-ui.js";
import { initInputGate } from "./inputgate.js";
import { sendMessage, initReplyClick } from "./chat.js";
import { waitForEngine, hideLoading } from "./loading.js";

//
// Boot the app: hold behind the loading spinner until the voice engine is ready,
// then start every subsystem, connect the input box to the chat flow, pick a
// cheerful opening portrait, and reveal the desktop.
//
async function main() {
  const root = document.documentElement.style;

  root.setProperty("--primary", PRIMARY_COLOR);
  root.setProperty("--secondary", SECONDARY_COLOR);
  root.setProperty("--hover", HOVER_COLOR);

  await waitForEngine();

  initTerminal();
  initServerLog();
  initI18n();
  initWindowing();
  initStartMenu();
  initClock();
  initDateBox();
  initModels();
  initVoice();
  initBackgrounds();
  initPermission();
  initCredits();
  initEditor({ onSubmit: sendMessage });
  initReplyClick();
  initTranscript();
  initHelp();
  initMemory();
  initSettings();
  initInputGate();
  preloadSounds();
  preloadPortraits();
  setEmotion("idle");
  hideLoading();
  playChime();
}

main();
