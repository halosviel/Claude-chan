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
import { getTypeMs } from "./settings.js";
import { setEmotion, showImage } from "./avatar.js";
import { prepareSpeech, playPrepared, stopAudio, isVoiceEnabled } from "./voice.js";
import { getCurrentModel } from "./models.js";
import { showPermission } from "./permission.js";
import { showCredits } from "./credits.js";
import { startThinkTimer, clearThinkTimer } from "./thinktimer.js";
import { runAction } from "./actions.js";
import { recordUser, recordClaude, popTurn } from "./transcript.js";
import { initIdleReset, armIdleReset, cancelIdleReset } from "./idlereset.js";
import {
  getEditorElement,
  getEditorState,
  clearEditor,
  beginThinking,
  markReplyMode,
  finishReply,
  enterTyping,
  setHintProgress,
} from "./editor.js";

// Stops the thinking-dot animation, and aborts the in-flight /chat request.
let stopThinking = null;
let controller = null;
let pending = "";

// Active reply playback state.
let segments = [];
let segIndex = 0;
let segReached = -1;      // highest page reached so far: new pages voice + log, revisits don't
let shownEmotion = null;   // mood currently on the portrait, to vary it per section
let currentImageSrc = null; // the exact portrait src currently shown
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
// Fetch a fresh portrait src for a mood (no display), or null on failure.
//
async function fetchEmotionImage(mood) {
  try {
    const data = await fetchJson("/image?emotion=" + encodeURIComponent(mood));

    return data.image;
  } catch (error) {
    return null;
  }
}

//
// Set the portrait for a section. The chosen picture is CACHED on the segment, so
// stepping back/forward shows the exact same image that section originally had. A
// new section with a different mood always swaps; the same mood swaps to another
// picture ~half the time (when allowReroll) so a long reply isn't static.
//
async function showSectionImage(seg, allowReroll) {
  if (seg.image) {
    shownEmotion = seg.emotion || shownEmotion;
    currentImageSrc = seg.image;
    showImage(seg.image);
    return;
  }

  const mood = seg.emotion || "talking";
  let src = currentImageSrc;

  if (mood !== shownEmotion || (allowReroll && Math.random() < 0.5)) {
    const fetched = await fetchEmotionImage(mood);

    if (fetched) {
      src = fetched;
    }
  }

  shownEmotion = mood;
  currentImageSrc = src;
  seg.image = src;

  if (src) {
    showImage(src);
  }
}

//
// Reset to the fresh idle state after a spell of inactivity once her last
// section was reached: drop the played-out reply, empty the dialogue box, and
// put her portrait back to idle. Skipped if she's no longer idle (a new turn
// began) or a permission prompt is still waiting for an answer.
//
function resetToIdle() {
  if (getEditorState() !== "idle") {
    return;
  }

  const perm = qs("#perm-window");

  if (perm && getComputedStyle(perm).display !== "none") {
    return;
  }

  resetPlayback();
  clearEditor();
  setEmotion("idle");
}

//
// Clear all reply-playback state.
//
function resetPlayback() {
  segments = [];
  audioClips = [];
  segIndex = 0;
  segReached = -1;
  pageComplete = false;
  typingCancel = null;
  showContinue(false);
}

//
// Finish the whole reply: go idle and reveal any permission prompt. The pages
// are KEPT (not reset) so you can still right-click back through them; a new
// prompt replaces them.
//
function endReply() {
  const done = onAllDone;

  onAllDone = null;
  finishReply();

  if (done) {
    done();
  }

  // Her last section has been reached and she's idle: start the inactivity
  // countdown that resets the box + portrait if the user steps away.
  armIdleReset();
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
// Play a NEW page (one not reached before): start its voice and type its text,
// and log it to the backlog as she begins — so voice, text, and transcript all
// appear together. Guards against the reader advancing while audio is decoding.
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

  // Stop the thinking dots only now, the instant her text + voice begin, so they
  // keep animating through the audio-decode wait instead of freezing on a frame.
  clearThinking();
  clearThinkTimer();
  setHintProgress(index + 1, segments.length);
  showSectionImage(seg, true);

  // Record this page to the backlog only as she actually starts speaking it, so
  // the transcript stays in step with her voice and the dialogue box.
  if ((seg.text || "").trim()) {
    recordClaude(seg.text);
  }

  if (audio) {
    playPrepared(audio);
  } else if ((seg.speech || "").trim() && isVoiceEnabled()) {
    dlog("voice: expected to speak this page but have no audio clip");
  }

  segReached = Math.max(segReached, index);

  typingCancel = typeOut(editor, seg.text || "...", {
    delayMs: getTypeMs(),
    render: renderReply,
    onDone: () => {
      typingCancel = null;
      pageFinished();
    },
  });
}

//
// Jump straight to a page you've already seen: show its full text at once with no
// typewriter (back/forward through the reply). Navigation never stops the voice --
// only starting a NEW, unheard section swaps the audio (see playPage).
//
function showPage(index) {
  const editor = getEditorElement();

  if (typingCancel) {
    typingCancel();
    typingCancel = null;
  }

  segIndex = index;
  editor.innerHTML = renderReply(segments[index].text || "...", true);
  editor.scrollTop = editor.scrollHeight;
  pageComplete = true;
  setHintProgress(index + 1, segments.length);
  showSectionImage(segments[index], false);
  showContinue(index < segments.length - 1);
}

//
// Skip the current page's typing: show its full text at once (voice keeps going).
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
// Advance the reply on a left-click: skip the current page's typing if it's
// still going, else move to the next page (voicing it only if it's new). Returns
// false when nothing happened (no reply, or already on the last page).
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
    const next = segIndex + 1;

    if (next > segReached) {
      segIndex = next;
      playPage();
    } else {
      showPage(next);
    }

    return true;
  }

  return false;
}

//
// Step BACK one page on a right-click: show the previous page with no voice
// replay. Returns false when there's nothing before the current page.
//
export function backReply() {
  if (segments.length === 0 || segIndex === 0) {
    return false;
  }

  showPage(segIndex - 1);
  return true;
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
  cancelIdleReset();
  resetPlayback();
  finishReply();
}

//
// Prefetch each page's voice, but SEQUENTIALLY -- one synthesis at a time. Firing
// them all at once made AivisSpeech run several neural TTS jobs in parallel,
// saturating the CPU and stuttering the desktop. Each returned promise resolves
// to its page's decoded audio, and each synthesis starts only after the previous
// one finishes -- which still keeps ahead of the page-by-page playback.
//
function prefetchSpeech(pages) {
  let chain = Promise.resolve(null);

  return pages.map((page) => {
    chain = chain.then(() => prepareSpeech(page.speech || ""));
    return chain;
  });
}

//
// Begin playing a list of pages (with their voices prefetched).
//
function playReply(pages, afterLast) {
  segments = pages;
  segIndex = 0;
  segReached = -1;
  shownEmotion = null;
  currentImageSrc = null;
  pageComplete = false;
  onAllDone = afterLast;
  audioClips = prefetchSpeech(pages);
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
  cancelIdleReset();

  const editor = getEditorElement();

  pending = message;
  recordUser(message);
  beginThinking();
  dlog("submit:", JSON.stringify(message));
  setEmotion("idle");
  startThinkTimer();
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
      outOfCredits: data.out_of_credits,
    });

    markReplyMode();

    const pages = data.segments && data.segments.length
      ? data.segments
      : [{ text: "...", speech: "", emotion: data.emotion }];

    playReply(pages, () => {
      if (data.out_of_credits) {
        showCredits();
        return;
      }

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
    markReplyMode();
    playReply([{ text: "i couldn't reach the server... is server.py still running?", speech: "", emotion: "sad" }], null);
  }
}

//
// Wire the Claude-chan stage so a click skips/advances her reply (visual-novel
// click-through). Called once at startup.
//
export function initReplyClick() {
  initIdleReset(resetToIdle);

  const stage = qs(".vn-center");

  if (!stage) {
    return;
  }

  // Only navigate her reply while it's playing or sitting finished (idle) -- not
  // while she's thinking or while you're typing a new prompt.
  const canNavigate = () => {
    const state = getEditorState();

    return state === "responding" || state === "idle";
  };

  stage.addEventListener("click", () => {
    if (canNavigate()) {
      advanceReply();
    }
  });

  stage.addEventListener("contextmenu", (event) => {
    if (canNavigate() && segments.length > 1) {
      event.preventDefault();
      backReply();
    }
  });
}
