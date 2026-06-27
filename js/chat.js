// ===========================================================================
//  chat.js
//
//  The send/reply flow. On submit it locks the box, shows a thinking animation,
//  and asks the server. The reply comes back as PAGES (segments), each with its
//  own text and spoken Japanese; she plays them visual-novel style: one page at
//  a time, text typed out with the page's voice. A "click to continue" arrow
//  shows when a page finishes; clicking the stage skips the current page's
//  typing or advances to the next page. A proposed action surfaces the
//  permission prompt after the last page.
//
//  Cancellation (Esc, via inputgate): cancelThinking() aborts the in-flight
//  request and restores typing; cancelResponding() stops the reply.
// ===========================================================================

import { qs, fetchJson } from "./util/dom.js";
import { dlog } from "./log.js";
import { playSound } from "./util/sound.js";
import { typeOut, cycleFrames } from "./util/animation.js";
import { buildHtml } from "./markdown.js";
import { DIALOGUE_TYPE_MS } from "./config.js";
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

// Stops the thinking-dot animation, and aborts the in-flight /chat request.
let stopThinking = null;
let controller = null;
let pending = "";

// Active reply playback state.
let segments = [];
let segIndex = 0;
let audioClips = [];      // prepared (decoded) audio per page, fetched up front
let typingCancel = null;  // cancels the current page's typewriter
let pageComplete = false; // current page finished typing
let onAllDone = null;     // run once the last page completes (reveals permission)

//
// Render a partial reply for the typewriter: markdown plus a blinking caret
// until the last character is shown.
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
// Show or hide the "click to continue" arrow.
//
function showContinue(show) {
  const arrow = qs("#dialogue-continue");

  if (arrow) {
    arrow.classList.toggle("visible", show);
  }
}

//
// Clear all reply-playback state.
//
function resetPlayback() {
  segments = [];
  audioClips = [];
  segIndex = 0;
  pageComplete = false;
  typingCancel = null;
  showContinue(false);
}

//
// Finish the whole reply: go idle (the last page stays on screen) and reveal
// any permission prompt.
//
function endReply() {
  const done = onAllDone;

  onAllDone = null;
  resetPlayback();
  finishReply();

  if (done) {
    done();
  }
}

//
// After a page finishes (typed out or skipped): show the continue arrow if more
// pages remain, otherwise end the reply.
//
function pageFinished() {
  pageComplete = true;

  if (segIndex < segments.length - 1) {
    showContinue(true);
  } else {
    endReply();
  }
}

//
// Play the current page: start its voice and type its text. Guards against the
// reader advancing while the audio is still decoding.
//
async function playPage() {
  const editor = getEditorElement();
  const index = segIndex;
  const seg = segments[index];

  pageComplete = false;
  showContinue(false);

  const audio = await audioClips[index];

  if (index !== segIndex) {
    return;
  }

  if (audio) {
    playPrepared(audio);
  }

  typingCancel = typeOut(editor, seg.text || "...", {
    delayMs: DIALOGUE_TYPE_MS,
    render: renderReply,
    onDone: () => {
      typingCancel = null;
      pageFinished();
    },
  });
}

//
// Skip the current page's typing: show its full text at once.
//
function skipPage() {
  const editor = getEditorElement();

  if (typingCancel) {
    typingCancel();
    typingCancel = null;
  }

  editor.innerHTML = renderReply(segments[segIndex].text || "...", true);
  editor.scrollTop = editor.scrollHeight;
  pageFinished();
}

//
// Advance the reply on a click: skip the current page's typing if it's still
// going, else move to the next page. Returns false when nothing happened (no
// reply playing, or already on the finished last page).
//
export function advanceReply() {
  if (segments.length === 0) {
    return false;
  }

  if (!pageComplete) {
    skipPage();
    return true;
  }

  if (segIndex < segments.length - 1) {
    stopAudio();
    segIndex += 1;
    playPage();
    return true;
  }

  return false;
}

//
// Esc during thinking: abort the request (its AbortError handler restores
// typing with the original message).
//
export function cancelThinking() {
  if (controller) {
    controller.abort();
    controller = null;
  }
}

//
// Esc during the reply: stop the typewriter and voice, go idle.
//
export function cancelResponding() {
  if (typingCancel) {
    typingCancel();
    typingCancel = null;
  }

  stopAudio();
  onAllDone = null;
  resetPlayback();
  finishReply();
}

//
// Begin playing a list of pages (with their voices prefetched).
//
function playReply(pages, afterLast) {
  segments = pages;
  segIndex = 0;
  pageComplete = false;
  onAllDone = afterLast;
  audioClips = pages.map((page) => prepareSpeech(page.speech || ""));
  playPage();
}

//
// Send a message and play out the reply, page by page.
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
      pages: (data.segments || []).length,
      permission: data.permission,
      action: data.action,
    });

    clearThinking();
    showImage(data.image);
    markReplyMode();

    const pages = data.segments && data.segments.length
      ? data.segments
      : [{ text: "...", speech: "" }];

    recordClaude(pages.map((p) => p.text).filter(Boolean).join("\n") || "...");

    playReply(pages, () => {
      if (data.permission) {
        showPermission(data.permission, {
          onAccept: () => {
            runAction(data.action);
            sendMessage("yes, go ahead!");
          },
          onReject: () => sendMessage("no, please don't."),
        });
      }
    });
  } catch (error) {
    controller = null;
    clearThinking();

    if (error.name === "AbortError") {
      dlog("submit: cancelled");
      popTurn();
      setEmotion("happy");
      finishReply();
      enterTyping(pending);
      return;
    }

    dlog("submit error:", error);
    setEmotion("sad");
    markReplyMode();
    recordClaude("i couldn't reach the server...");
    playReply([{ text: "i couldn't reach the server... is server.py still running?", speech: "" }], null);
  }
}

//
// Wire the Claude-chan stage so a click skips/advances her reply (visual-novel
// click-through). Called once at startup.
//
export function initReplyClick() {
  const stage = qs(".vn-center");

  if (stage) {
    stage.addEventListener("click", () => advanceReply());
  }
}
