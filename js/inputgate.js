// ===========================================================================
//  inputgate.js
//
//  The keyboard gate for talking to Claude-chan. Typing is entered with the "/"
//  key whenever she is idle (not thinking or replying). "Esc" cancels: it aborts
//  her thinking, stops her reply, or discards an in-progress prompt, depending
//  on the state.
// ===========================================================================

import { getEditorState, enterTyping, cancelTyping } from "./editor.js";
import { cancelThinking, cancelResponding, advanceReply, backReply } from "./chat.js";

//
// True when a form control (a slider, text field, etc.) has focus, so the
// visual-novel nav keys don't hijack typing/adjusting in other windows.
//
function isFormFocused() {
  const element = document.activeElement;

  if (!element) {
    return false;
  }

  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

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

    const state = getEditorState();

    // Visual-novel navigation while she's replying or her reply sits finished:
    // Enter / Space / Right go forward, Left goes back. (Not while typing or
    // thinking, and not when a form control is focused.)
    if ((state === "responding" || state === "idle") && !isFormFocused()) {
      const forward = event.key === " " || event.key === "Enter" || event.key === "ArrowRight";

      if (forward && advanceReply()) {
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowLeft" && backReply()) {
        event.preventDefault();
        return;
      }
    }

    // "/" starts typing whenever she's idle (no hover requirement).
    if (event.key === "/" && state === "idle") {
      event.preventDefault();
      enterTyping();
    }
  });
}
