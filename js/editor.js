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

import { qs, fetchJson, getCaretOffset, setCaretOffset } from "./util/dom.js";
import { buildHtml, htmlToMarkdown } from "./markdown.js";
import { t, onChange } from "./i18n.js";
import { playKey } from "./util/sound.js";
import { clearThinkTimer } from "./thinktimer.js";
import { cancelIdleReset } from "./idlereset.js";

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

//
// Repurpose the dialogue hint as a click-to-continue page counter while she
// replies ("Click to continue (1/3)"). On the last (or only) page there's
// nothing to click to, so the label is hidden.
//
export function setHintProgress(current, total) {
  if (!hintEl) {
    return;
  }

  // On the last (or only) page there's nothing to click to, so fall back to the
  // "Press / to talk" prompt rather than a "Click to continue" counter.
  if (current >= total) {
    hintEl.textContent = t("hint.talk");
    hintEl.classList.add("visible");
    return;
  }

  hintEl.textContent = t("hint.continue") + " (" + current + "/" + total + ")";
  hintEl.classList.add("visible");
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

// A paste larger than either limit (or an image) collapses to a compact "[…]"
// placeholder chip; the full text is restored when the message is sent.
const PASTE_LINE_LIMIT = 6;
const PASTE_CHAR_LIMIT = 800;
let pastedChunks = []; // { token, text } pairs to expand back on submit
let pasteSeq = 0;
let imageSeq = 0;

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
  editor.innerHTML = buildHtml(text, false) + (text.endsWith("\n") ? "<br>" : "");
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
// Scroll the box so the caret stays in view while typing, so a new line added
// past the box's ~3-line scroll cap isn't left hidden below the fold.
//
function keepCaretVisible() {
  const offset = getCaretOffset(editor);

  if (offset != null && offset >= editorText().length) {
    editor.scrollTop = editor.scrollHeight;
  }
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
// Forget any stored large pastes (a fresh prompt starts clean).
//
function resetPaste() {
  pastedChunks = [];
  pasteSeq = 0;
  imageSeq = 0;
}

//
// Pull the first image File out of a paste's clipboard data, or null.
//
function pastedImageFile(files, items) {
  if (files) {
    const file = Array.from(files).find((entry) => entry.type.startsWith("image/"));

    if (file) {
      return file;
    }
  }

  if (items) {
    const item = Array.from(items).find((entry) => entry.kind === "file" && entry.type.startsWith("image/"));

    if (item) {
      return item.getAsFile();
    }
  }

  return null;
}

//
// Upload an image File, then insert an "[Image #n]" chip that expands on submit
// to its saved path (so she views it with her Read tool). Falls back to a plain
// "[picture]" chip if the upload fails.
//
async function attachImageFile(file) {
  try {
    const data = await fetchJson("/paste-image", {
      method: "POST",
      headers: { "Content-Type": file.type || "image/png" },
      body: file,
    });

    imageSeq += 1;

    const token = "[Image #" + imageSeq + "]";
    const expansion = "(attached image #" + imageSeq +
      " -- view it with your Read tool at: " + data.path + ")";

    pastedChunks.push({ token, text: expansion });
    insertPlaceholder(token);
  } catch (error) {
    insertPlaceholder("[picture]");
  }
}

//
// Attach a list of dropped/pasted files: images upload and become viewable, any
// other file (video, etc.) gets a tidy placeholder chip (the text chat can't
// forward it).
//
async function attachFiles(files) {
  for (const file of Array.from(files)) {
    if (file.type.startsWith("image/")) {
      await attachImageFile(file);
    } else {
      const kind = file.type.startsWith("video/") ? "video" : "attachment";

      insertPlaceholder("[" + kind + ": " + file.name + "]");
    }
  }
}

//
// Restore collapsed large-paste placeholders to their full text, so the message
// the model receives contains what was actually pasted.
//
function expandPaste(text) {
  let out = text;

  for (const chunk of pastedChunks) {
    out = out.split(chunk.token).join(chunk.text);
  }

  return out;
}

//
// Insert a placeholder chip (a large paste or an attachment) at the caret.
//
function insertPlaceholder(token) {
  insertText(token);
  recordChange(false);
  keepCaretVisible();
}

//
// Empty the box and reset its history (and any stored pastes).
//
export function clearEditor() {
  editor.innerHTML = "";
  resetHistory();
  resetPaste();
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

  cancelIdleReset();
  state = "typing";
  editor.classList.remove("response");
  setEditable(true);
  setHtml(initialText);
  resetHistory();
  resetPaste();
  clearThinkTimer();

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

  if (hintEl) {
    hintEl.textContent = t("hint.talk");
  }

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
    keepCaretVisible();
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

    const isDelete = event.key === "Backspace" || event.key === "Delete";
    const emptyDelete = isDelete && editorText().length === 0;

    // Where the caret sits before this key acts, so we can tell when a key can't
    // actually do anything.
    const caret = getCaretOffset(editor);
    const length = editorText().length;
    const atStart = caret != null && caret <= 0;
    const atEnd = caret != null && caret >= length;
    const goingBack = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const goingForward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const stuckAtEdge = (goingBack && atStart) || (goingForward && atEnd);

    // No sound for: bare modifier keys, a delete with nothing to delete, or an
    // arrow key that's already at the start/end and so won't move.
    if (!SILENT_KEYS.has(event.key) && !emptyDelete && !stuckAtEdge) {
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

    // Tab indents in the box (handy inside code) instead of moving focus out to
    // the page's buttons.
    if (event.key === "Tab" && !mod) {
      event.preventDefault();
      insertText("\t");
      recordChange(false);
      keepCaretVisible();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !isComposing) {
      event.preventDefault();

      const message = expandPaste(editorText()).trim();

      if (message) {
        onSubmit(message);
      }

      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      insertText("\n");
      recordChange(false);
      keepCaretVisible();
    }
  });

  editor.addEventListener("paste", async (event) => {
    if (state !== "typing") {
      return;
    }

    event.preventDefault();

    const clipboard = event.clipboardData || window.clipboardData;

    // A pasted image is uploaded to the server, shown as an "[Image #n]" chip,
    // and on submit expanded to its saved path so she views it with her Read tool.
    const image = pastedImageFile(clipboard && clipboard.files, clipboard && clipboard.items);

    if (image) {
      await attachImageFile(image);
      return;
    }

    let text = clipboard ? clipboard.getData("text/plain") : "";
    const html = clipboard ? clipboard.getData("text/html") : "";

    if (html) {
      const markdown = htmlToMarkdown(html);

      if (markdown) {
        text = markdown;
      }
    }

    if (!text) {
      return;
    }

    // Collapse a big paste to a "[pasted text #n, N lines]" chip; the full text
    // is restored on submit (see expandPaste).
    const lineCount = text.split("\n").length;

    if (lineCount >= PASTE_LINE_LIMIT || text.length > PASTE_CHAR_LIMIT) {
      pasteSeq += 1;

      const token = "[pasted text #" + pasteSeq + ", " + lineCount +
        (lineCount === 1 ? " line]" : " lines]");

      pastedChunks.push({ token, text });
      insertPlaceholder(token);
      return;
    }

    insertText(text);
    recordChange(false);
    keepCaretVisible();
  });

  // Drag-and-drop files onto the whole Claude-chan scene (alongside paste). A
  // file drag lights up the scene; dropping attaches images (and chips other
  // files). The zone is the portrait/background region, not just the box.
  const zone = qs(".vn-center");

  if (zone) {
    const isFileDrag = (event) =>
      event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files");

    const clearDrag = () => zone.classList.remove("drag-over");

    zone.addEventListener("dragenter", (event) => {
      if (isFileDrag(event)) {
        event.preventDefault();
        zone.classList.add("drag-over");
      }
    });

    zone.addEventListener("dragover", (event) => {
      if (isFileDrag(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        zone.classList.add("drag-over");
      }
    });

    // Clear the highlight only once the cursor actually leaves the zone's bounds
    // (a plain dragleave fires when moving over children too, which would flicker
    // or leave the overlay stuck).
    zone.addEventListener("dragleave", (event) => {
      if (!isFileDrag(event)) {
        return;
      }

      const rect = zone.getBoundingClientRect();

      if (event.clientX <= rect.left || event.clientX >= rect.right ||
          event.clientY <= rect.top || event.clientY >= rect.bottom) {
        clearDrag();
      }
    });

    zone.addEventListener("drop", async (event) => {
      if (!isFileDrag(event)) {
        return;
      }

      event.preventDefault();
      clearDrag();

      if (state === "idle") {
        enterTyping();
      }

      if (state !== "typing") {
        return;
      }

      const files = event.dataTransfer.files;

      if (files && files.length) {
        await attachFiles(files);
      }
    });

    // Dropping a file anywhere on the page shouldn't navigate to it; also a
    // belt-and-braces clear of the highlight.
    window.addEventListener("dragover", (event) => {
      if (isFileDrag(event)) {
        event.preventDefault();
      }
    });

    window.addEventListener("drop", (event) => {
      if (isFileDrag(event)) {
        event.preventDefault();
      }

      clearDrag();
    });
  }
}
