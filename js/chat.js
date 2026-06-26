// ===========================================================================
//  chat.js
//
//  The send/reply flow. On submit it locks the box, shows a thinking animation,
//  asks the server, decodes the voice up front, then types the reply into the
//  box one character at a time (markdown-formatted) with the voice in sync. A
//  proposed action surfaces the permission prompt after she has spoken.
//
//  Cancellation (Esc, via inputgate): cancelThinking() aborts the in-flight
//  request and restores typing with the original message; cancelResponding()
//  stops the typewriter + voice and returns to idle.
// ===========================================================================

import { fetchJson } from "./util/dom.js";
import { dlog } from "./log.js";
import { playSound } from "./util/sound.js";
import { typeOut, cycleFrames } from "./util/animation.js";
import { DIALOGUE_TYPE_MS } from "./config.js";
import { buildHtml } from "./markdown.js";
import { setEmotion, showImage } from "./avatar.js";
import { prepareSpeech, playPrepared, stopAudio } from "./voice.js";
import { getCurrentModel } from "./models.js";
import { showPermission } from "./permission.js";
import { runAction } from "./actions.js";
import { recordUser, recordClaude, popTurn } from "./transcript.js";
import {
  getEditorElement,
  beginThinking,
  markReplyMode,
  finishReply,
  enterTyping,
} from "./editor.js";

// Stops the current thinking-dot animation, if one is running.
let stopThinking = null;

// Aborts the in-flight /chat request (during the thinking phase).
let controller = null;

// Cancels the running reply typewriter (during the responding phase).
let cancelTyping = null;

// The message currently being processed, restored if thinking is cancelled.
let pending = "";

//
// Render a partial reply for the typewriter: format what's typed so far as
// markdown and append a blinking caret until the last character is shown.
//
function renderReply(visibleText, done) {
  return buildHtml(visibleText) + (done ? "" : '<span class="type-caret"></span>');
}

//
// Stop the thinking animation if it is running.
//
function clearThinking() {
  if (stopThinking) {
    stopThinking();
    stopThinking = null;
  }
}

//
// Esc during the thinking phase: abort the request. The fetch rejects with an
// AbortError, whose handler restores typing with the original message.
//
export function cancelThinking() {
  if (controller) {
    controller.abort();
    controller = null;
  }
}

//
// Esc during the responding phase: stop the typewriter and the voice, then go
// idle (the partial reply stays on screen).
//
export function cancelResponding() {
  if (cancelTyping) {
    cancelTyping();
    cancelTyping = null;
  }

  stopAudio();
  finishReply();
}

//
// Send a message and play out the reply. Locks the box while she thinks and
// replies; you cannot type until she finishes and you press "/".
//
export async function sendMessage(message) {
  message = (message || "").trim();

  if (!message) {
    return;
  }

  playSound("message-sent");

  const editor = getEditorElement();

  pending = message;
  recordUser(message);
  beginThinking();
  dlog("submit:", JSON.stringify(message));
  setEmotion("thinking");
  stopThinking = cycleFrames(editor, [".", "..", "..."], 400);
  controller = new AbortController();

  try {
    const data = await fetchJson("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, model: getCurrentModel() }),
      signal: controller.signal,
    });

    controller = null;

    dlog("chat response:", {
      emotion: data.emotion,
      text: data.text,
      speechLen: (data.speech || "").length,
      permission: data.permission,
      image: data.image,
    });

    clearThinking();

    const audio = await prepareSpeech(data.speech || data.text || "");

    showImage(data.image);
    markReplyMode();

    // Hold any permission prompt until she has finished speaking (or, with no
    // voice, finished typing) so she can explain herself first. Fires once.
    let permShown = false;
    const revealPermission = () => {
      if (permShown || !data.permission) {
        return;
      }

      permShown = true;
      showPermission(data.permission, {
        onAccept: () => {
          runAction(data.action);
          sendMessage("yes, go ahead!");
        },
        onReject: () => sendMessage("no, please don't."),
      });
    };

    // Record her line now, as the voice + typing fire together, so the
    // transcript appears exactly when she starts talking (not during synthesis).
    recordClaude(data.text || "...");

    if (audio) {
      playPrepared(audio, { onEnd: revealPermission });
    }

    cancelTyping = typeOut(editor, data.text || "...", {
      delayMs: DIALOGUE_TYPE_MS,
      render: renderReply,
      onDone: () => {
        cancelTyping = null;
        finishReply();

        if (!audio) {
          revealPermission();
        }
      },
    });
  } catch (error) {
    controller = null;
    clearThinking();

    if (error.name === "AbortError") {
      // Cancelled mid-thinking: drop the (un-answered) turn and restore typing.
      dlog("submit: cancelled");
      popTurn();
      setEmotion("happy");
      finishReply();
      enterTyping(pending);
      return;
    }

    dlog("submit error:", error);
    setEmotion("sad");
    cancelTyping = typeOut(editor, "i couldn't reach the server... is server.py still running?", {
      delayMs: DIALOGUE_TYPE_MS,
      render: renderReply,
      onDone: () => {
        cancelTyping = null;
        finishReply();
      },
    });
  }
}
