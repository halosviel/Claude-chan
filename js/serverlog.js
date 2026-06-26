// ===========================================================================
//  serverlog.js
//
//  Streams backend log lines (GET /logs) into the in-app terminal, so the
//  terminal shows server activity -- API calls, the claude CLI, failures, and
//  the actions Claude-chan takes -- alongside the frontend's own logs. Polls on
//  an interval; the first poll just syncs position so old buffered lines aren't
//  dumped on connect.
// ===========================================================================

import { fetchJson } from "./util/dom.js";
import { dlog } from "./log.js";

const POLL_MS = 2000;

let since = 0;
let primed = false;

//
// Fetch any log lines newer than what we've seen and print them to the terminal.
//
async function poll() {
  try {
    const data = await fetchJson("/logs?since=" + since);

    if (primed) {
      (data.lines || []).forEach((line) => dlog("«srv»", line.msg));
    }

    if (typeof data.seq === "number") {
      since = data.seq;
    }

    primed = true;
  } catch (error) {
    // server momentarily unreachable; try again next tick
  }
}

//
// Start streaming backend logs into the terminal. Called once at startup.
//
export function initServerLog() {
  poll();
  setInterval(poll, POLL_MS);
}
