# ===========================================================================
#  chat.py
#
#  The "no API key" chat. Two ways to reach Claude, same (emotion, segments,
#  permission, action, out_of_credits) contract out the other side:
#
#    1. SDK path (default) -- ONE persistent Claude Agent SDK session kept warm
#       across turns. The claude process is spawned once and reused, so every
#       reply skips the CLI cold-start the old per-turn `claude -p` paid. Context
#       lives in the live session (no --resume reload).
#    2. Subprocess path (fallback) -- the original `claude -p` per turn. Used
#       automatically if the SDK is unavailable or any SDK turn errors, so the
#       app behaves exactly as before even when the warm session can't be used.
#
#  Set CLAUDE_CHAN_SDK=0 to force the subprocess path.
# ===========================================================================

import asyncio
import json
import os
import re
import subprocess
import threading
import time
from concurrent.futures import TimeoutError as FutureTimeout

from . import config
from . import images
from . import logbuf

# Whether the (subprocess) session has been started yet -- first turn creates it,
# later turns resume it, so the claude CLI keeps context across messages.
_state = {"started": False}

# Substrings (lower-cased) in a CLI error that mean the account is out of credits
# -- distinct from a transient rate limit, which we don't treat as "no credits".
CREDIT_TERMS = ("credit balance", "credit", "billing", "insufficient", "quota",
                "balance is too low", "payment required")

# In-character messages reused by both paths, so a timeout/credit/error looks the
# same to the user whichever path produced it.
TIMEOUT_REPLY = ("idle", [{"text": "sorry, i got stuck thinking for too long there...", "speech": ""}], "", None, False)
OUT_OF_CREDITS_REPLY = ("sad",
                        [{"text": "ah... i've run out of credits, so i can't reply right now. sorry!",
                          "speech": "ごめんね、クレジットがなくなっちゃって、いまおはなしできないの。",
                          "emotion": "sad"}],
                        "", None, True)


# Build the appended persona system prompt: her persona + the action/permission
# protocol + the desktop actions she can take. Shared by both paths so they send
# Claude exactly the same instructions.
def _build_system():
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

    return system


# ---------------------------------------------------------------------------
#  Subprocess path (fallback) -- the original `claude -p` per turn.
# ---------------------------------------------------------------------------

# Run the claude CLI for one turn and return the parsed reply tuple plus an
# out_of_credits flag: (emotion, segments, permission, action, out_of_credits).
# Falls back to an in-character message on timeout, a missing CLI, or a non-zero
# exit (which may itself be an out-of-credits failure).
def _run_claude_subprocess(prompt, model=None):
    model = model if model in config.ALLOWED_MODELS else config.DEFAULT_MODEL
    system = _build_system()

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
        return TIMEOUT_REPLY
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
            return OUT_OF_CREDITS_REPLY

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


# ---------------------------------------------------------------------------
#  SDK path -- one warm Claude Agent SDK session reused across turns.
# ---------------------------------------------------------------------------

# Force the subprocess path with CLAUDE_CHAN_SDK=0.
USE_SDK = os.environ.get("CLAUDE_CHAN_SDK", "1") != "0"

# Tools she may auto-run (matches CLAUDE_TOOLS); everything else is denied so a
# stray tool request can never hang the non-interactive session.
_ALLOWED_TOOLS = config.CLAUDE_TOOLS.split()

_sdk = None            # the imported module, or False once known unavailable
_loop = None           # background asyncio loop that owns the session
_loop_lock = threading.Lock()
_turn_lock = threading.Lock()  # single-user: serialize warm-session turns
_client = None         # the live ClaudeSDKClient, created on first use
_client_model = None   # the model the live client is currently set to
_client_lock = asyncio.Lock()  # serialize connect so a turn + warm-up don't double-connect


# Import the SDK once; cache False if it isn't installed so we stop trying.
def _import_sdk():
    global _sdk

    if _sdk is None:
        try:
            import claude_agent_sdk as sdk
            _sdk = sdk
        except Exception as error:
            logbuf.add("chat: claude-agent-sdk unavailable (%s); using subprocess" % error)
            _sdk = False

    return _sdk


# Start (once) the background event loop that owns the persistent session.
def _ensure_loop():
    global _loop

    with _loop_lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            threading.Thread(target=_loop.run_forever, daemon=True,
                             name="claude-sdk-loop").start()

    return _loop


# Permission gate: auto-allow the configured tools, deny everything else. Keeps
# her to the same tool set the CLI's --allowedTools gave her, and guarantees an
# unexpected tool request is answered (never left hanging) in this headless app.
async def _gate_tool(tool_name, tool_input, context):
    if tool_name in _ALLOWED_TOOLS:
        return _sdk.PermissionResultAllow()

    return _sdk.PermissionResultDeny(message="not permitted for Claude-chan")


# Get the warm client, creating it on first use. A model change is applied to the
# live session (no reconnect), so the model picker keeps working without losing
# the warm process or the conversation.
async def _ensure_client(model):
    global _client, _client_model

    async with _client_lock:
        if _client is None:
            options = _sdk.ClaudeAgentOptions(
                system_prompt={"type": "preset", "preset": "claude_code", "append": _build_system()},
                allowed_tools=_ALLOWED_TOOLS,
                disallowed_tools=["Bash"],
                can_use_tool=_gate_tool,
                cwd=config.CLAUDE_CWD,
                model=model,
            )
            client = _sdk.ClaudeSDKClient(options=options)
            await client.connect()
            _client = client
            _client_model = model
        elif model and model != _client_model:
            await _client.set_model(model)
            _client_model = model

    return _client


# One turn on the warm session: send the prompt, drain the reply, hand back the
# final ResultMessage (the analog of the CLI's JSON output).
async def _ask_sdk(prompt, model):
    client = await _ensure_client(model)
    await client.query(prompt)

    result = None

    async for message in client.receive_response():
        if isinstance(message, _sdk.ResultMessage):
            result = message

    return result


# Tear down the warm session so the next turn reconnects fresh (after an error or
# timeout). Best-effort.
async def _shutdown_client():
    global _client, _client_model

    client, _client = _client, None
    _client_model = None

    if client is not None:
        try:
            await client.disconnect()
        except Exception:
            pass


# Run one turn through the warm session and shape it into the same tuple the
# subprocess path returns. Raises on infrastructure errors so the caller can fall
# back to the subprocess for this turn.
def _run_claude_sdk(prompt, model=None):
    model = model if model in config.ALLOWED_MODELS else config.DEFAULT_MODEL
    loop = _ensure_loop()

    logbuf.add("chat: claude(sdk) (model=%s, tools=[%s], cwd=%s)"
               % (model, config.CLAUDE_TOOLS or "none", config.CLAUDE_CWD))

    started = time.monotonic()

    try:
        result = asyncio.run_coroutine_threadsafe(_ask_sdk(prompt, model), loop).result(timeout=185)
    except FutureTimeout:
        logbuf.add("chat: claude(sdk) TIMED OUT; resetting session")
        asyncio.run_coroutine_threadsafe(_shutdown_client(), loop)
        return TIMEOUT_REPLY
    except Exception:
        # Reset the session so the next turn reconnects, then bubble up to the
        # subprocess fallback for this turn.
        try:
            asyncio.run_coroutine_threadsafe(_shutdown_client(), loop)
        except Exception:
            pass
        raise

    elapsed = int((time.monotonic() - started) * 1000)

    if result is not None and result.is_error:
        err = (result.result or str(getattr(result, "errors", "")) or
               str(getattr(result, "api_error_status", ""))).strip()
        logbuf.add("chat: claude(sdk) FAILED (%dms, subtype=%s): %s"
                   % (elapsed, getattr(result, "subtype", None), err[-400:]))

        if any(term in err.lower() for term in CREDIT_TERMS):
            logbuf.add("chat: detected OUT OF CREDITS")
            return OUT_OF_CREDITS_REPLY

        return "idle", [{"text": "hmm, something went sideways on my end...\n" + err, "speech": ""}], "", None, False

    text = ((result.result if result else None) or "").strip()
    logbuf.add("chat: claude(sdk) ok (%dms, turns=%s, cost=%s)"
               % (elapsed, getattr(result, "num_turns", None),
                  getattr(result, "total_cost_usd", None)))

    return (*parse(text), False)


# ---------------------------------------------------------------------------
#  Dispatcher
# ---------------------------------------------------------------------------

# Run one chat turn. Prefers the warm SDK session; falls back to the per-turn
# subprocess if the SDK isn't available or a turn errors, so behavior is
# unchanged from the user's side either way.
def run_claude(prompt, model=None):
    if USE_SDK and _import_sdk():
        with _turn_lock:
            try:
                return _run_claude_sdk(prompt, model)
            except Exception as error:
                logbuf.add("chat: SDK path error (%s); falling back to subprocess" % error)

    return _run_claude_subprocess(prompt, model)


# Pre-connect the warm session at startup so the user's first reply doesn't pay
# the one-time connect cost. Non-blocking and best-effort: a failure just means
# the session connects lazily (or the subprocess path runs) on the first turn.
def warm_up():
    if not (USE_SDK and _import_sdk()):
        return

    loop = _ensure_loop()

    async def _connect():
        try:
            await _ensure_client(config.DEFAULT_MODEL)
            logbuf.add("chat: warm SDK session ready")
        except Exception as error:
            logbuf.add("chat: SDK warm-up failed (%s); will connect lazily" % error)

    asyncio.run_coroutine_threadsafe(_connect(), loop)


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
