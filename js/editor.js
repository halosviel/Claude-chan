// ===========================================================================
//  editor.js
//
//  The dialogue box: both the input composer AND the surface Claude-chan types
//  her replies into. It is READ-ONLY by default; you enter typing mode only via
//  the "/" key (see inputgate.js). A small state machine gates everything:
//
//    idle       read-only; showing her last reply (or empty). "/" -> typing.
//    typing     editable; Enter sends, Esc cancels.
//    thinking   locked while the server is queried ("..."). Esc cancels.
//    responding locked while she types her reply. Esc stops it.
//
//  The chat flow drives the thinking/responding/idle transitions; inputgate
//  drives idle<->typing. As input it is a live-markdown contenteditable with
//  its own undo/redo (the browser's is wiped by re-rendering each keystroke).
// ===========================================================================

import { qs, getCaretOffset, setCaretOffset } from "./util/dom.js";
import { buildHtml, htmlToMarkdown } from "./markdown.js";
import { t, onChange } from "./i18n.js";
import { playKey } from "./util/sound.js";

// Keys that don't make a typing sound (they don't "type" anything on their own).
const SILENT_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

// Resolved in initEditor so the module can be imported before the DOM exists.
let editor = null;
let speaker = null;
let hintEl = null;

//
// Show or hide the "Press / to talk" hint in the dialogue box corner.
//
function setHint(show) {
  if (hintEl) {
    hintEl.classList.toggle("visible", show);
  }
}

// Which placeholder/speaker to show, so they can be re-applied on a language
// change (the actual text comes from i18n).
let placeholderKey = "placeholder.idle";
let speakerMode = "input";

// The input state machine (see the header).
let state = "idle";

// True mid-IME composition (e.g. Japanese), when we must not re-render.
let isComposing = false;

// Called when the user submits a message (Enter). Set in initEditor.
let onSubmit = () => {};

// Our own undo stack: each entry is { text, caret }. Rapid typing coalesces
// into one step; newlines / pastes / IME commits start a fresh step.
let history = [{ text: "", caret: 0 }];
let histIndex = 0;
let lastEditAt = 0;

//
// The raw text content of the box (markdown source, identical to what's typed).
//
function editorText() {
  return editor.textContent || "";
}

//
// The current input state (idle / typing / thinking / responding).
//
export function getEditorState() {
  return state;
}

//
// The DOM element of the box, for the chat flow to type replies into.
//
export function getEditorElement() {
  return editor;
}

//
// The current input text (trimmed by callers as needed).
//
export function getEditorText() {
  return editorText();
}

//
// Set which placeholder (by i18n key) shows when the box is empty.
//
function setPlaceholder(key) {
  placeholderKey = key;

  if (editor) {
    editor.dataset.placeholder = t(key);
  }
}

//
// Make the box editable or read-only. Read-only still allows scrolling and
// selecting (so a long reply can be read/copied), just not typing.
//
function setEditable(editable) {
  editor.contentEditable = editable ? "true" : "false";
}

//
// Set the editor's HTML from markdown text. A trailing <br> is appended when the
// text ends in a newline: a pre-wrap contenteditable otherwise renders no final
// empty line and won't let the caret reach it -- which is what made it take
// several Enter presses to move to a new line, and kept the caret stuck on a
// code fence's language line. The <br> contributes nothing to textContent, so
// caret offsets are unaffected.
//
function setHtml(text) {
  editor.innerHTML = buildHtml(text) + (text.endsWith("\n") ? "<br>" : "");
}

//
// Re-render the box's markdown from its current text. When preserveCaret is
// set, the caret offset is measured before and restored after (offsets are
// stable because rendering only wraps characters, never adds/removes them).
//
function render(preserveCaret) {
  const text = editorText();
  const offset = preserveCaret ? getCaretOffset(editor) : null;

  setHtml(text);

  if (preserveCaret) {
    setCaretOffset(editor, offset);
  }
}

//
// Insert a string at the caret (or at the end if there is no caret), re-render,
// and place the caret just after the inserted text.
//
function insertText(str) {
  const offset = getCaretOffset(editor);
  const at = offset == null ? editorText().length : offset;
  const text = editorText();

  setHtml(text.slice(0, at) + str + text.slice(at));
  setCaretOffset(editor, at + str.length);
}

//
// Reset the undo history to a single empty state.
//
function resetHistory() {
  history = [{ text: "", caret: 0 }];
  histIndex = 0;
  lastEditAt = 0;
}

//
// Empty the box and reset its history.
//
export function clearEditor() {
  editor.innerHTML = "";
  resetHistory();
}

//
// Capture the current { text, caret } state for the undo stack.
//
function snapshot() {
  const caret = getCaretOffset(editor);
  const text = editorText();

  return { text, caret: caret == null ? text.length : caret };
}

//
// Record a change onto the undo stack. A fast burst of typing (coalesce, within
// 450ms) folds into the current step; anything else pushes a new step.
//
function recordChange(coalesce) {
  const state = snapshot();
  const now = Date.now();

  if (histIndex < history.length - 1) {
    history.length = histIndex + 1;
  }

  if (coalesce && now - lastEditAt < 450 && histIndex > 0) {
    history[histIndex] = state;
  } else {
    history.push(state);
    histIndex = history.length - 1;
  }

  lastEditAt = now;
}

//
// Restore a saved { text, caret } state into the box.
//
function restoreState(saved) {
  setHtml(saved.text);
  setCaretOffset(editor, saved.caret);
}

//
// Step back one undo step, if any.
//
function undo() {
  if (histIndex > 0) {
    histIndex--;
    restoreState(history[histIndex]);
  }
}

//
// Step forward one redo step, if any.
//
function redo() {
  if (histIndex < history.length - 1) {
    histIndex++;
    restoreState(history[histIndex]);
  }
}

//
// Set the speaker name tag: "you" while you're typing, "Claude-chan" while she
// is thinking or replying. (Claude-chan is a name, kept in every language.)
//
function setSpeaker(mode) {
  speakerMode = mode;

  if (speaker) {
    speaker.textContent = mode === "input" ? t("speaker.you") : "Claude-chan";
  }
}

//
// Re-apply the placeholder and speaker text after a language change.
//
function applyLang() {
  setPlaceholder(placeholderKey);
  setSpeaker(speakerMode);
}

//
// Enter typing mode (only valid from idle), optionally seeding the box with
// text (used to restore a cancelled prompt). Clears any shown reply, makes the
// box editable, focuses it, and drops the caret at the end. Returns false if
// typing isn't allowed right now (she's thinking/replying).
//
export function enterTyping(initialText = "") {
  if (state !== "idle") {
    return false;
  }

  state = "typing";
  editor.classList.remove("response");
  setEditable(true);
  setHtml(initialText);
  resetHistory();

  if (initialText) {
    recordChange(false);
  }

  setCaretOffset(editor, Array.from(initialText).length);
  setSpeaker("input");
  setPlaceholder("placeholder.typing");
  setHint(false);
  editor.focus();

  return true;
}

//
// Leave typing mode without sending (Esc): clear the box and go read-only.
//
export function cancelTyping() {
  state = "idle";
  editor.classList.remove("response");
  clearEditor();
  setEditable(false);
  editor.blur();
  setSpeaker("input");
  setPlaceholder("placeholder.idle");
  setHint(false);
}

//
// Lock the box for a new turn: clear it, go read-only, blur it, and label the
// speaker as Claude-chan. The chat flow then shows a thinking animation.
//
export function beginThinking() {
  state = "thinking";
  editor.classList.remove("response");
  clearEditor();
  setEditable(false);
  editor.blur();
  setSpeaker("talk");
  setHint(false);
}

//
// Switch the box into reply styling (markdown markers hidden) ahead of typing a
// reply into it. The box stays read-only.
//
export function markReplyMode() {
  state = "responding";
  editor.classList.add("response");
}

//
// Finish (or stop) a reply: go idle and stay read-only, leaving the reply on
// screen. Pressing "/" starts a fresh prompt.
//
export function finishReply() {
  state = "idle";
  setEditable(false);
  setPlaceholder("placeholder.idle");
  setHint(true);
}

//
// Wire all the box's input handling and remember the submit callback. The box
// starts idle (read-only); typing is entered via "/". Called once at startup.
//
export function initEditor(options = {}) {
  editor = qs("#editor");
  speaker = qs("#subbar-name");
  hintEl = qs("#dialogue-hint");
  onSubmit = options.onSubmit || (() => {});

  if (!editor) {
    return;
  }

  state = "idle";
  setEditable(false);
  setSpeaker("input");
  setPlaceholder("placeholder.idle");
  onChange(applyLang);

  editor.addEventListener("input", () => {
    if (isComposing) {
      return;
    }

    render(true);
    recordChange(true);
  });

  editor.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  editor.addEventListener("compositionend", () => {
    isComposing = false;
    render(true);
    recordChange(false);
  });

  editor.addEventListener("keydown", (event) => {
    if (state !== "typing") {
      return;
    }

    // No sound for a delete that has nothing to delete (empty box), or for bare
    // modifier keys.
    const isDelete = event.key === "Backspace" || event.key === "Delete";
    const emptyDelete = isDelete && editorText().length === 0;

    if (!SILENT_KEYS.has(event.key) && !emptyDelete) {
      playKey();
    }

    const mod = event.ctrlKey || event.metaKey;

    if (mod && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }

    if (mod && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
      event.preventDefault();
      redo();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !isComposing) {
      event.preventDefault();

      const message = editorText().trim();

      if (message) {
        onSubmit(message);
      }

      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      insertText("\n");
      recordChange(false);
    }
  });

  editor.addEventListener("paste", (event) => {
    if (state !== "typing") {
      return;
    }

    event.preventDefault();

    const clipboard = event.clipboardData || window.clipboardData;
    let text = clipboard ? clipboard.getData("text/plain") : "";
    const html = clipboard ? clipboard.getData("text/html") : "";

    if (html) {
      const markdown = htmlToMarkdown(html);

      if (markdown) {
        text = markdown;
      }
    }

    if (text) {
      insertText(text);
      recordChange(false);
    }
  });
}
