# ===========================================================================
#  chat.py
#
#  The "no API key" chat: shells out to the claude CLI with the system prompt
#  (which holds her persona + reply format), keeping conversation context across
#  a session, then parses the reply into (emotion, english_text, japanese_speech,
#  permission). The CLI does the talking; this module shapes it.
# ===========================================================================

import json
import re
import subprocess
import time

from . import config
from . import images
from . import logbuf

# Whether the session has been started yet (first turn creates it, later turns
# resume it), so the claude CLI keeps context across messages.
_state = {"started": False}

# Substrings (lower-cased) in a CLI error that mean the account is out of credits
# -- distinct from a transient rate limit, which we don't treat as "no credits".
CREDIT_TERMS = ("credit balance", "credit", "billing", "insufficient", "quota",
                "balance is too low", "payment required")


# Run the claude CLI for one turn and return the parsed reply tuple plus an
# out_of_credits flag: (emotion, segments, permission, action, out_of_credits).
# Falls back to an in-character message on timeout, a missing CLI, or a non-zero
# exit (which may itself be an out-of-credits failure).
def run_claude(prompt, model=None):
    model = model if model in config.ALLOWED_MODELS else config.DEFAULT_MODEL
    system = config.SYSTEM_PROMPT

    if config.CLAUDE_TOOLS:
        system += (
            "\n\n--- Your tools ---\n"
            "You have real Claude Code tools available (" + config.CLAUDE_TOOLS +
            ") and you run in this directory: " + config.CLAUDE_CWD + ". Use them "
            "naturally to ACTUALLY help when the user asks for something concrete "
            "-- read and search files, edit or write files, look things up on the "
            "web. Don't just describe what you'd do; do it. After using tools, "
            "still reply in the required format (mood tag, English answer, then "
            "the ###JP### line).\n"
            "When the user pastes an IMAGE, their message includes its file path; "
            "use your Read tool on that path to actually look at the image before "
            "you respond."
        )

    system += (
        "\n\n--- Asking permission (###PERM###) ---\n"
        "When the user asks you to DO something concrete and worth confirming "
        "first (an action that changes things, not just answering a question), "
        "say what you're about to do in your English reply, then make the VERY "
        "LAST line of the whole reply:\n"
        "'" + config.PERM_MARKER + " <a short, plain summary of exactly what "
        "you'll do>'.\n"
        "The app then shows the user a Yes/No prompt and only proceeds if they "
        "accept. Use at most ONE action line per reply, and never combine "
        + config.PERM_MARKER + " with " + config.BG_MARKER + "/"
        + config.MEM_MARKER + "."
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
        return "idle", [{"text": "sorry, i got stuck thinking for too long there...", "speech": ""}], "", None, False
    except FileNotFoundError:
        logbuf.add("chat: claude CLI not found on PATH")
        return "sad", [{"text": "i can't find the claude CLI -- is it installed and on your PATH?", "speech": ""}], "", None, False

    _state["started"] = True
    elapsed = int((time.monotonic() - started) * 1000)

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()[-400:]
        logbuf.add("chat: claude FAILED (exit %d, %dms): %s" % (proc.returncode, elapsed, err))

        # Out of credits is its own case: she says so and the app pops a notice.
        if any(term in err.lower() for term in CREDIT_TERMS):
            logbuf.add("chat: detected OUT OF CREDITS")
            return ("sad",
                    [{"text": "ah... i've run out of credits, so i can't reply right now. sorry!",
                      "speech": "ごめんね、クレジットがなくなっちゃって、いまおはなしできないの。",
                      "emotion": "sad"}],
                    "", None, True)

        return "idle", [{"text": "hmm, something went sideways on my end...\n" + err, "speech": ""}], "", None, False

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

    return (*parse(text), False)


# Pull a leading [mood] tag off a page of text, returning (mood_or_default,
# remaining_text). A page with no leading tag keeps the mood it was given.
def _lead_mood(text, default):
    match = config.TAG_RE.match(text)

    if match and match.group(1).lower() in config.EMOTIONS:
        return match.group(1).lower(), text[match.end():].lstrip()

    return default, text


# Split a raw reply into (emotion, segments, permission, action). Pulls the
# leading [mood] tag and any action line (###BG###/###MEM### or ###PERM###), then
# breaks the rest into PAGES at each ###JP### line. Each page may begin with its
# own [mood] tag to shift her expression mid-reply; otherwise it inherits the
# current one. `segments` is a list of {"text", "speech", "emotion"}; `action` is
# a dict or None; `emotion` (first return) is the reply's opening mood.
def parse(text):
    emotion, text = _lead_mood(text, "talking")
    text = text.strip()

    action = None
    permission = ""

    # Markers are honoured ONLY at the start of a line (that's how she emits them).
    # So when she MENTIONS one mid-sentence -- e.g. explaining how the app works --
    # it stays as plain text and doesn't cut her message off or fire an action.
    def line_marker(marker):
        return re.compile(r"(?m)^[ \t]*" + re.escape(marker) + r"[ \t]*(.*)$")

    for marker, kind in ((config.BG_MARKER, "background"), (config.MEM_MARKER, "memory")):
        match = line_marker(marker).search(text)

        if match:
            action = {"type": kind, "value": match.group(1).strip()}
            text = (text[:match.start()] + text[match.end():]).strip()
            break

    perm_match = line_marker(config.PERM_MARKER).search(text)

    if perm_match:
        permission = perm_match.group(1).strip()
        text = (text[:perm_match.start()] + text[perm_match.end():]).strip()

    # an executable action always needs a confirm summary
    if action and not permission:
        if action["type"] == "background":
            permission = "change the background to " + action["value"]
        else:
            permission = "remember: " + action["value"]

    # Split the remaining text into PAGES at each line-start ###JP### marker (also
    # line-anchored, so a ###JP### mentioned in prose doesn't split the message).
    # Leaked Japanese is stripped from each english page; line structure is kept.
    segments = []
    chunks = re.compile(r"(?m)^[ \t]*" + re.escape(config.JP_MARKER) + r"[ \t]?").split(text)
    english = chunks[0]
    current = emotion

    for chunk in chunks[1:]:
        # The spoken Japanese is the first non-empty line after the marker, so a
        # reply that puts the kana on the line BELOW '###JP###' (a blank line right
        # after the marker) still gets a voice instead of falling silent.
        chunk = chunk.lstrip("\n")
        newline = chunk.find("\n")

        if newline == -1:
            speech, rest = chunk.strip(), ""
        else:
            speech, rest = chunk[:newline].strip(), chunk[newline + 1:]

        current, english = _lead_mood(english, current)
        page = config.CJK_RE.sub("", english).strip()

        if page or speech:
            segments.append({"text": page, "speech": speech, "emotion": current})

        english = rest

    current, english = _lead_mood(english, current)
    tail = config.CJK_RE.sub("", english).strip()

    if tail:
        segments.append({"text": tail, "speech": "", "emotion": current})

    if not segments:
        segments = [{"text": config.CJK_RE.sub("", text).strip(), "speech": "", "emotion": emotion}]

    return emotion, segments, permission, action
