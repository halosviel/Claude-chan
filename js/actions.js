// ===========================================================================
//  actions.js
//
//  Runs the concrete things Claude-chan asks to do in the desktop, once the
//  user consents (via the permission prompt). The server validates and tags
//  each action; here we map a tag to the matching live change.
// ===========================================================================

import { dlog } from "./log.js";
import { setScene } from "./backgrounds.js";
import { addMemory } from "./memory.js";

//
// Execute an action object ({ type, value }) from the chat response. Unknown or
// empty actions are ignored.
//
export function runAction(action) {
  if (!action || !action.type) {
    return;
  }

  if (action.type === "background") {
    setScene(action.value);
    dlog("action: background ->", action.value);
  } else if (action.type === "memory") {
    addMemory(action.value);
    dlog("action: memory ->", action.value);
  }
}
