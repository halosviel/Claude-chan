// ===========================================================================
//  inputgate.js
//
//  The keyboard gate for talking to Claude-chan. Typing is entered with the "/"
//  key whenever she is idle (not thinking or replying). "Esc" cancels: it aborts
//  her thinking, stops her reply, or discards an in-progress prompt, depending
//  on the state.
// ===========================================================================

import { getEditorState, enterTyping, cancelTyping } from "./editor.js";
import { cancelThinking, cancelResponding, advanceReply } from "./chat.js";

//
// Handle Esc per state: thinking -> abort, responding -> stop, typing -> cancel.
//
function handleEscape(event) {
  const state = getEditorState();

  if (state === "thinking") {
    event.preventDefault();
    cancelThinking();
  } else if (state === "responding") {
    event.preventDefault();
    cancelResponding();
  } else if (state === "typing") {
    event.preventDefault();
    cancelTyping();
  }
}

//
// Wire the global "/" and Esc keys. Called once at startup.
//
export function initInputGate() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      handleEscape(event);
      return;
    }

    // Space / Enter advance her reply (skip typing or go to the next page).
    if ((event.key === " " || event.key === "Enter") && getEditorState() === "responding") {
      event.preventDefault();
      advanceReply();
      return;
    }

    // "/" starts typing whenever she's idle (no hover requirement).
    if (event.key === "/" && getEditorState() === "idle") {
      event.preventDefault();
      enterTyping();
    }
  });
}
