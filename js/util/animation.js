// ===========================================================================
//  animation.js
//
//  Reusable, content-agnostic text animations driven by timers. typeOut reveals
//  a string one character at a time; cycleFrames loops a set of short frames.
//  Neither knows about markdown, the editor, or Claude-chan; callers supply a
//  target element and a render strategy.
// ===========================================================================

//
// Reveal `text` into `element` one character at a time. On every step the
// caller's render(visibleText, done) returns the HTML to display, so callers
// own formatting (markdown, a trailing caret, plain text, ...). The element is
// kept scrolled to the bottom so the newest characters stay visible. Returns a
// cancel function that stops the animation in place.
//
// Options:
//   delayMs  milliseconds between characters (default 18)
//   render   (visibleText, done) => htmlString (default: the raw text)
//   onDone   called once after the final character is shown
//
export function typeOut(element, text, options = {}) {
  const delayMs = options.delayMs ?? 18;
  const render = options.render || ((visible) => visible);
  const onDone = options.onDone || (() => {});
  const characters = Array.from(text || "");

  let index = 0;
  let timer = null;

  const draw = () => {
    const visible = characters.slice(0, index).join("");

    element.innerHTML = render(visible, index >= characters.length);
    element.scrollTop = element.scrollHeight;
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const step = () => {
    index += 1;
    draw();

    if (index < characters.length) {
      timer = setTimeout(step, delayMs);
    } else {
      timer = null;
      onDone();
    }
  };

  if (characters.length === 0) {
    element.innerHTML = render("", true);
    onDone();
    return cancel;
  }

  draw();
  timer = setTimeout(step, delayMs);

  return cancel;
}

//
// Loop `frames` (an array of strings) into element.textContent on an interval,
// starting from the first frame immediately. Useful for a "thinking" indicator
// such as ".", "..", "...". Returns a stop function.
//
export function cycleFrames(element, frames, intervalMs = 400) {
  let n = 0;

  element.textContent = frames[0];

  const timer = setInterval(() => {
    n = (n + 1) % frames.length;
    element.textContent = frames[n];
  }, intervalMs);

  return () => clearInterval(timer);
}
