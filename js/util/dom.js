// ===========================================================================
//  dom.js
//
//  Small, dependency-free DOM helpers shared across the app: element lookup,
//  HTML escaping, caret offset get/set for the contenteditable editor, and a
//  JSON fetch wrapper. Nothing here knows about Claude-chan specifically.
// ===========================================================================

//
// Return the first element matching a CSS selector, or null. A thin alias for
// querySelector so call sites stay short.
//
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

//
// Return all elements matching a CSS selector as a real array (so callers can
// use map/forEach/filter without converting a NodeList first).
//
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

//
// Escape the HTML-significant characters in a string so user/model text can be
// placed into innerHTML without being interpreted as markup.
//
export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

//
// Measure the caret as an absolute character offset into root.textContent. This
// survives an innerHTML rewrite because offsets are stable as long as the
// rewrite only wraps characters in spans (never adds/removes characters).
// Returns null when the selection is not inside root.
//
export function getCaretOffset(root) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const preCaret = range.cloneRange();

  preCaret.selectNodeContents(root);
  preCaret.setEnd(range.endContainer, range.endOffset);

  return preCaret.toString().length;
}

//
// The topmost display:none ancestor of a node within root, or null if the node
// is rendered. Used to detect when a caret target lands inside hidden text (such
// as a collapsed code fence), which the browser cannot draw a caret inside.
//
function hiddenAncestor(node, root) {
  let element = node.nodeType === 3 ? node.parentElement : node;
  let hidden = null;

  while (element && element !== root) {
    if (getComputedStyle(element).display === "none") {
      hidden = element;
    }

    element = element.parentElement;
  }

  return hidden;
}

//
// Place the caret at an absolute character offset into root (the inverse of
// getCaretOffset). Offsets count every character, including those in hidden
// (display:none) spans, so they match getCaretOffset. But a caret cannot be
// drawn inside hidden text, so when the target lands there it snaps to just
// after the hidden run (the next visible position). An offset past the end
// drops the caret at the very end; a null offset is a no-op.
//
export function setCaretOffset(root, offset) {
  if (offset == null) {
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let remaining = offset;
  let node;

  while ((node = walker.nextNode())) {
    const length = node.nodeValue.length;

    if (remaining <= length) {
      const hidden = hiddenAncestor(node, root);

      if (hidden && hidden.parentNode) {
        range.setStartAfter(hidden);
      } else {
        range.setStart(node, remaining);
      }

      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      return;
    }

    remaining -= length;
  }

  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

//
// Fetch a URL and parse the response as JSON. Rejects on a non-OK status so
// callers can rely on a resolved value being real data.
//
export async function fetchJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error("fetchJson " + url + " -> HTTP " + response.status);
  }

  return response.json();
}
