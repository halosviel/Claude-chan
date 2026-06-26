# ===========================================================================
#  logbuf.py
#
#  An in-memory ring buffer of recent server log lines, surfaced to the in-app
#  terminal via GET /logs (the frontend polls it). add() both prints to the
#  console and appends to the buffer, so backend activity -- API calls, the
#  claude CLI, failures, actions -- shows up in the terminal window.
# ===========================================================================

import threading

_LOCK = threading.Lock()
_LINES = []   # list of (seq, text)
_SEQ = 0
_MAX = 400


# Record a log line: print it and append to the ring buffer (capped at _MAX).
def add(message):
    global _SEQ

    text = str(message)

    with _LOCK:
        _SEQ += 1
        _LINES.append((_SEQ, text))

        if len(_LINES) > _MAX:
            del _LINES[:len(_LINES) - _MAX]

    print("[server] " + text, flush=True)


# Return (lines, latest_seq): the log lines newer than `seq` and the newest seq.
def since(seq):
    with _LOCK:
        lines = [{"seq": s, "msg": m} for (s, m) in _LINES if s > seq]
        latest = _LINES[-1][0] if _LINES else 0

    return lines, latest
