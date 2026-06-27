# ===========================================================================
#  chat.py
#
#  The "no API key" chat: shells out to the claude CLI with the system prompt
#  and the user's live personality file, keeping conversation context across a
#  session, then parses the reply into (emotion, english_text, japanese_speech,
#  permission). The CLI does the talking; this module shapes it.
# ===========================================================================

import json
import os
import subprocess
import time

from . import config
from . import images
from . import logbuf

# Whether the session has been started yet (first turn creates it, later turns
# resume it), so the claude CLI keeps context across messages.
_state = {"started": False}


# Read personality.txt next to the project root live each turn, so the user can
# reshape Claude-chan without restarting. Missing/empty returns "".
def read_personality():
    try:
        with open(os.path.join(config.ROOT, "personality.txt"), encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


# Run the claude CLI for one turn and return the parsed reply tuple. Falls back
# to an in-character message on timeout, a missing CLI, or a non-zero exit.
def run_claude(prompt, model=None):
    model = model if model in config.ALLOWED_MODELS else config.DEFAULT_MODEL
    system = config.SYSTEM_PROMPT
    personality = read_personality()

    if personality:
        system += ("\n\n--- Personality (from personality.txt; adopt this as "
                   "who you are) ---\n" + personality)

    if config.CLAUDE_TOOLS:
        system += (
            "\n\n--- Your tools ---\n"
            "You have real Claude Code tools available (" + config.CLAUDE_TOOLS +
            ") and you run in this directory: " + config.CLAUDE_CWD + ". Use them "
            "naturally to ACTUALLY help when the user asks for something concrete "
            "-- read and search files, edit or write files, look things up on the "
            "web. Don't just describe what you'd do; do it. After using tools, "
            "still reply in the required format (mood tag, English answer, then "
            "the ###JP### line)."
        )

    backgrounds = images.list_backgrounds()

    if backgrounds:
        system += (
            "\n\n--- Things you can DO in the desktop ---\n"
            "Only when it genuinely fits, and AFTER saying it out loud in your "
            "English reply, you may add ONE action line as the very last line "
            "(after the ###JP### line):\n"
            "- To change the background scene behind you: '" + config.BG_MARKER +
            " <filename>' using EXACTLY one of: " + ", ".join(backgrounds) + ".\n"
            "- To remember something the user asks you to remember: '" +
            config.MEM_MARKER + " <the thing to remember>'.\n"
            "Use at most one action line per reply, and do not combine "
            "###BG###/###MEM### with ###PERM###."
        )

    command = [
        "claude", "-p", prompt,
        "--model", model,
        "--output-format", "json",
        "--append-system-prompt", system,
    ]

    if config.CLAUDE_TOOLS:
        command += ["--allowedTools", config.CLAUDE_TOOLS]

    if _state["started"]:
        command += ["--resume", config.SESSION_ID]
    else:
        command += ["--session-id", config.SESSION_ID]

    logbuf.add("chat: claude -p (model=%s, tools=[%s], cwd=%s)"
               % (model, config.CLAUDE_TOOLS or "none", config.CLAUDE_CWD))

    started = time.monotonic()

    try:
        proc = subprocess.run(command, capture_output=True, text=True,
                              cwd=config.CLAUDE_CWD, timeout=180)
    except subprocess.TimeoutExpired:
        logbuf.add("chat: claude TIMED OUT after 180s")
        return "thinking", [{"text": "sorry, i got stuck thinking for too long there...", "speech": ""}], "", None
    except FileNotFoundError:
        logbuf.add("chat: claude CLI not found on PATH")
        return "sad", [{"text": "i can't find the claude CLI -- is it installed and on your PATH?", "speech": ""}], "", None

    _state["started"] = True
    elapsed = int((time.monotonic() - started) * 1000)

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()[-400:]
        logbuf.add("chat: claude FAILED (exit %d, %dms): %s" % (proc.returncode, elapsed, err))
        return "thinking", [{"text": "hmm, something went sideways on my end...\n" + err, "speech": ""}], "", None

    text = proc.stdout.strip()
    turns = None
    cost = None

    try:
        data = json.loads(proc.stdout)
        text = (data.get("result") or "").strip()
        turns = data.get("num_turns")
        cost = data.get("total_cost_usd")
    except (json.JSONDecodeError, AttributeError):
        logbuf.add("chat: could not parse claude JSON output")

    logbuf.add("chat: claude ok (%dms, turns=%s, cost=%s)" % (elapsed, turns, cost))

    return parse(text)


# Split a raw reply into (emotion, segments, permission, action). Pulls the
# leading [mood] tag and any action line (###BG###/###MEM### or ###PERM###), then
# breaks the rest into PAGES at each ###JP### line. `segments` is a list of
# {"text": english, "speech": japanese}; `action` is a dict or None.
def parse(text):
    emotion = "talking"
    match = config.TAG_RE.match(text)

    if match:
        emotion = match.group(1).lower()
        text = text[match.end():].strip()

    if emotion not in config.EMOTIONS:
        emotion = "talking"

    action = None

    for marker, kind in ((config.BG_MARKER, "background"), (config.MEM_MARKER, "memory")):
        if marker in text:
            text, value = text.split(marker, 1)
            action = {"type": kind, "value": value.strip()}
            text = text.strip()
            break

    permission = ""

    if config.PERM_MARKER in text:
        text, perm = text.split(config.PERM_MARKER, 1)
        permission = perm.strip()
        text = text.strip()

    # an executable action always needs a confirm summary
    if action and not permission:
        if action["type"] == "background":
            permission = "change the background to " + action["value"]
        else:
            permission = "remember: " + action["value"]

    # Split the remaining text into PAGES: each ###JP### line ends a page,
    # yielding {text: the english before it, speech: that page's spoken
    # japanese}. Leaked Japanese is stripped from each english page (line
    # structure / indentation is preserved so code blocks survive).
    segments = []
    chunks = text.split(config.JP_MARKER)
    english = chunks[0]

    for chunk in chunks[1:]:
        newline = chunk.find("\n")

        if newline == -1:
            speech, rest = chunk.strip(), ""
        else:
            speech, rest = chunk[:newline].strip(), chunk[newline + 1:]

        page = config.CJK_RE.sub("", english).strip()

        if page or speech:
            segments.append({"text": page, "speech": speech})

        english = rest

    tail = config.CJK_RE.sub("", english).strip()

    if tail:
        segments.append({"text": tail, "speech": ""})

    if not segments:
        segments = [{"text": config.CJK_RE.sub("", text).strip(), "speech": ""}]

    return emotion, segments, permission, action
