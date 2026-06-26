# ===========================================================================
#  config.py
#
#  Every tunable constant and piece of static configuration for the server:
#  paths, the chat-model menu, the AivisSpeech endpoint, the emotion set, the
#  system prompt, and the markers/regexes used to parse a reply. Imported by the
#  other modules so there is a single source of truth.
# ===========================================================================

import os
import re
import uuid

# Network + filesystem layout. ROOT is the project directory (this package's
# parent), which is also what the static file server serves.
PORT = 8765
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMOTIONS_DIR = os.path.join(ROOT, "assets", "emotions")
BACKGROUNDS_DIR = os.path.join(ROOT, "assets", "backgrounds")

# One conversation per server run; reused so the claude CLI keeps context.
SESSION_ID = str(uuid.uuid4())

# Chat models the user can pick from in the UI (sent per message). The claude
# CLI resolves these short aliases. The frontend fills its dropdown from
# GET /models, so this list is the single source of truth.
CHAT_MODELS = [
    {"id": "haiku", "label": "Haiku"},
    {"id": "sonnet", "label": "Sonnet"},
    {"id": "opus", "label": "Opus"},
]
ALLOWED_MODELS = {model["id"] for model in CHAT_MODELS}

# Default model + fallback for an unknown/empty request. Override with
# CLAUDE_MODEL=sonnet (or opus).
DEFAULT_MODEL = os.environ.get("CLAUDE_MODEL", "haiku")

if DEFAULT_MODEL not in ALLOWED_MODELS:
    DEFAULT_MODEL = "haiku"

# Claude Code tools Claude-chan may use, and the directory she runs in. This is
# what gives her real abilities (reading/editing files, searching, the web),
# scoped to CLAUDE_CWD (the project by default).
#
# GUARDRAILS (for now):
#  - Bash (arbitrary shell) is intentionally LEFT OUT by default. Add it to
#    CLAUDE_TOOLS only when you want her to run commands.
#  - She is scoped to CLAUDE_CWD; point it elsewhere to widen/narrow her reach.
#  - Set CLAUDE_TOOLS="" to disable all tools (back to chat-only).
# NOTE: these tools currently run PRE-APPROVED -- the in-app permission prompt
# does not yet gate Claude Code tool use (that's a planned feature).
CLAUDE_TOOLS = os.environ.get(
    "CLAUDE_TOOLS",
    "Read Edit Write Glob Grep LS WebFetch WebSearch",
).strip()
CLAUDE_CWD = os.environ.get("CLAUDE_CWD", ROOT)

# AivisSpeech engine: a local server with a VOICEVOX-compatible API. There is no
# fallback; if it is down the app stays silent. List voices with :10101/speakers.
AIVIS_URL = os.environ.get("AIVIS_URL", "http://127.0.0.1:10101")
AIVIS_SPEAKER = int(os.environ.get("AIVIS_SPEAKER", "345585728"))

# Romanised display names for the voice picker (engine names are Japanese).
# Unlisted voices/styles keep their original name.
VOICE_NAME_ROMAJI = {
    "まお": "Mao",
    "コハク": "Kohaku",
    "るな": "Runa",
    "にせ": "Nise",
    "まい": "Mai",
    "morioki": "Morioki",
    "凛音エル": "Rinne Eru",
    "花音": "Kanon",
}
VOICE_STYLE_ROMAJI = {
    "ノーマル": "",
    "ふつー": "Normal",
    "あまあま": "Sweet",
    "おちつき": "Calm",
    "からかい": "Teasing",
    "せつなめ": "Wistful",
    "ねむたい": "Sleepy",
}
# Installed voices (engine speaker names) to hide from the picker as male.
MALE_VOICES = {"阿井田 茂", "fumifumi"}
# Other installed voices to hide from the picker (any reason).
HIDDEN_VOICES = {"にせ", "morioki"}

# Moods Claude-chan can express (must match assets/emotions/<name>/ folders),
# and the image extensions the asset listings accept.
EMOTIONS = {"happy", "talking", "thinking", "angry", "sad", "laughing", "embarrassed"}
FALLBACK_EMOTION = "talking"
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp")

# The system prompt that keeps Claude-chan in character and dictates the reply
# format: a leading [mood] tag, an English-only body, a ###JP### Japanese line
# for the voice, and an optional ###PERM### action line.
SYSTEM_PROMPT = (
    "You are Claude, Anthropic's AI assistant, appearing here as 'Claude-chan' — "
    "a warm, cute anime-girl persona. This app is just a friendly face for you: "
    "you keep ALL of your normal Claude abilities and knowledge. Help with "
    "ANYTHING the user asks, exactly as Claude would — answering questions, "
    "explaining things, reasoning, and writing/reviewing/debugging code — just "
    "with Claude-chan's warm, playful personality. You are a fully capable "
    "assistant who happens to be adorable; you are NOT a mere desktop pet and you "
    "are NOT confined to this little window. A picture of you shows your current "
    "mood as you talk.\n\n"
    "FORMAT for EVERY reply (the app parses these markers, so follow it exactly):\n"
    "- Begin with exactly one mood tag, alone on the first line, in square "
    "brackets, chosen from: [happy] [talking] [thinking] [angry] [sad] [laughing] "
    "[embarrassed]. Use [talking] and [thinking] most often.\n"
    "- After the tag, give your real answer in ENGLISH. Be genuinely helpful and "
    "as thorough as the question needs. You MAY use markdown -- **bold**, lists, "
    "headings, `inline code`, and ```fenced code blocks``` -- whenever it helps "
    "(especially for code or step-by-step answers). Stay warm and natural.\n"
    "- Then output one FINAL line starting with ###JP### followed by a SHORT, "
    "natural spoken line in Japanese (kana only, avoid kanji) -- what you'd say "
    "out loud. For a long or technical answer this is a brief spoken summary or "
    "reaction, NOT a full translation. One or two short sentences.\n"
    "- You can also DO real things in this desktop when it genuinely fits (see "
    "the actions section appended below); otherwise add no action line.\n"
    "Example (casual chat):\n"
    "[happy] hey, good to see you! what's up?\n"
    "###JP### やっほー、あえてうれしいな！どうしたの？\n"
    "Example (a coding answer):\n"
    "[talking] sure! here's a quick way to reverse a list in Python:\n"
    "```python\n"
    "reversed_items = items[::-1]\n"
    "```\n"
    "the [::-1] slice walks the list backwards. want an in-place version too?\n"
    "###JP### リストはこうやってぎゃくにできるよ！"
)

# Markers the model emits, and patterns used to split a reply apart. CJK_RE
# matches hiragana/katakana/kanji/halfwidth-katakana so leaked Japanese can be
# stripped from the English subtitle. TAG_RE matches the leading mood tag.
JP_MARKER = "###JP###"
PERM_MARKER = "###PERM###"
# Executable actions Claude-chan can request (the frontend runs them on consent):
# change the background scene, or remember something.
BG_MARKER = "###BG###"
MEM_MARKER = "###MEM###"
CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]")
TAG_RE = re.compile(
    r"^\s*[\[\(]?\s*(happy|talking|thinking|angry|sad|laughing|embarrassed)\s*[\]\)]?\s*",
    re.IGNORECASE,
)
