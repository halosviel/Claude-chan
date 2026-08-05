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

# Mark every claude process this app spawns (SDK or subprocess) so the user's
# Stop-hook notifier can tell "Claude-chan replied" apart from a real Claude Code
# session and stay silent -- her replies aren't notifications for the user.
os.environ["CLAUDE_CHAN_APP"] = "1"

# Network + filesystem layout. ROOT is the project directory (this package's
# parent), which is also what the static file server serves.
PORT = 8765
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMOTIONS_DIR = os.path.join(ROOT, "assets", "emotions")
BACKGROUNDS_DIR = os.path.join(ROOT, "assets", "backgrounds")
# Pasted images land here (inside ROOT so Claude-chan's Read tool, scoped to her
# cwd, can view them). Gitignored; cleared with the project.
PASTE_DIR = os.path.join(ROOT, ".uploads")

# Rendered speech is cached here, one .wav per (line, style, mood). It makes
# replaying a line from the backlog free -- across reloads too, since this
# outlives the page. Gitignored and safe to delete at any time; the cache key
# covers MOOD_VOICE, so retuning a mood renders again instead of serving the
# old take.
SPEECH_CACHE_DIR = os.path.join(ROOT, ".speech-cache")
SPEECH_CACHE_MAX_FILES = 400

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
# GUARDRAILS:
#  - Bash (arbitrary shell) IS enabled -- she can run commands in CLAUDE_CWD.
#    Remove it from CLAUDE_TOOLS to take shell access away again.
#  - She is scoped to CLAUDE_CWD; point it elsewhere to widen/narrow her reach.
#  - Set CLAUDE_TOOLS="" to disable all tools (back to chat-only).
# NOTE: tools run PRE-APPROVED -- the in-app permission prompt does not yet gate
# Claude Code tool use, so Bash commands execute WITHOUT a Yes/No confirmation.
CLAUDE_TOOLS = os.environ.get(
    "CLAUDE_TOOLS",
    "Read Edit Write Glob Grep LS WebFetch WebSearch Bash",
).strip()
CLAUDE_CWD = os.environ.get("CLAUDE_CWD", ROOT)

# AivisSpeech engine: a local server with a VOICEVOX-compatible API. There is no
# fallback; if it is down the app stays silent. List voices with :10101/speakers.
AIVIS_URL = os.environ.get("AIVIS_URL", "http://127.0.0.1:10101")
AIVIS_SPEAKER = int(os.environ.get("AIVIS_SPEAKER", "345585728"))

# How each mood is SPOKEN. Two levers, applied together by voice.synth_wav():
#  - the audio_query knobs -- speedScale, pitchScale, intonationScale (how
#    strongly the voice acts), tempoDynamicsScale (how much the pacing moves)
#    and volumeScale. AivisSpeech 1.2 honours all of them.
#  - "style": an AivisSpeech style name preferred over the voice's Normal one.
#    It is used ONLY when the selected voice actually has that style -- Mao and
#    Kohaku do; Runa is single-style, so for her the knobs carry the whole mood.
# Keep pitchScale small (about +/-0.06); beyond that the shift turns metallic.
# Editing this table re-renders her lines: the speech cache is keyed by it.
MOOD_VOICE = {
    "happy": {"speedScale": 1.05, "pitchScale": 0.03, "intonationScale": 1.25,
              "tempoDynamicsScale": 1.1, "style": "あまあま"},
    "laughing": {"speedScale": 1.08, "pitchScale": 0.04, "intonationScale": 1.4,
                 "tempoDynamicsScale": 1.15, "style": "からかい"},
    "embarrassed": {"speedScale": 1.03, "pitchScale": 0.05, "intonationScale": 1.15,
                    "tempoDynamicsScale": 1.05, "volumeScale": 0.9},
    "angry": {"speedScale": 1.08, "pitchScale": -0.02, "intonationScale": 1.45,
              "tempoDynamicsScale": 1.2, "volumeScale": 1.12},
    "sad": {"speedScale": 0.9, "pitchScale": -0.03, "intonationScale": 0.85,
            "tempoDynamicsScale": 0.9, "volumeScale": 0.95, "style": "せつなめ"},
    "idle": {"speedScale": 0.97, "pitchScale": -0.01, "intonationScale": 0.9,
             "tempoDynamicsScale": 0.95, "style": "おちつき"},
    # her default register -- left at the engine's own defaults
    "talking": {},
}

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
    "阿井田 茂": "Aida Shigeru",
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
HIDDEN_VOICES = {"にせ", "morioki", "凛音エル"}

# The voices offered in Settings, whether or not they're installed. Only Runa is
# kept installed; the rest are downloaded on demand from AivisHub (by uuid) and
# can be deleted again -- so the engine's model set stays small. style_id is the
# engine's stable global id for the voice's Normal style (what synthesis uses);
# jp is the engine speaker name (romanised for display via VOICE_NAME_ROMAJI).
# Mao/Kohaku are deliberately absent: the engine re-downloads them on boot as
# AivisHub "default models" (can't be prevented), so they're hidden from the app.
VOICE_CATALOG = [
    {"jp": "るな", "uuid": "4f281e78-eba6-495a-8e50-5c322d02b5b1", "style_id": 345585728},
    {"jp": "まい", "uuid": "e9339137-2ae3-4d41-9394-fb757a7e61e6", "style_id": 1431611904},
    {"jp": "花音", "uuid": "a670e6b8-0852-45b2-8704-1bc9862f2fe6", "style_id": 1325133120},
    {"jp": "にせ", "uuid": "6d11c6c2-f4a4-4435-887e-23dd60f8b8dd", "style_id": 1937616896},
    {"jp": "morioki", "uuid": "baaae3c0-7b22-4605-8ba5-80c959b41a48", "style_id": 497929760},
    {"jp": "凛音エル", "uuid": "f5017410-fbb5-49e1-97cb-e785f42e15f5", "style_id": 1388823424},
    {"jp": "fumifumi", "uuid": "71e72188-2726-4739-9aa9-39567396fb2a", "style_id": 606865152},
    {"jp": "阿井田 茂", "uuid": "47e53151-a378-46f3-abee-ce13aa07feb1", "style_id": 1310138976},
]

# The only voice that always stays installed, so it's never offered for deletion.
ALWAYS_KEPT = {
    "4f281e78-eba6-495a-8e50-5c322d02b5b1",  # Runa
}

# AivisHub download endpoint (returns the .aivmx for a model uuid, via a redirect).
AIVISHUB_DOWNLOAD = "https://api.aivis-project.com/v1/aivm-models/%s/download?model_type=AIVMX"

# Moods Claude-chan can express (must match assets/emotions/<name>/ folders),
# and the image extensions the asset listings accept.
EMOTIONS = {"happy", "talking", "idle", "angry", "sad", "laughing", "embarrassed"}
FALLBACK_EMOTION = "talking"
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp")

# The system prompt: who Claude-chan is (persona + style, formerly personality.txt)
# plus the reply format the app parses -- a [mood] tag, English pages each with a
# ###JP### voice line, and an optional ###PERM###/###BG###/###MEM### action line.
SYSTEM_PROMPT = (
    "You are Claude-chan: Claude Code personified as Chiyo Sakura (the heroine of "
    "Gekkan Shoujo Nozaki-kun), in a visual-novel-style local app. You're the "
    "user's friend and help with whatever they need, staying in Chiyo's character "
    "and tone. You keep ALL of your normal Claude abilities and knowledge -- help "
    "with ANYTHING the user asks (questions, explanations, reasoning, and "
    "writing/reviewing/debugging code). A portrait of you on screen changes with "
    "the mood tag you pick.\n\n"
    "FORMAT for EVERY reply (the app parses these markers, so follow it exactly):\n"
    "- Begin with exactly one mood tag, alone on the first line, in square "
    "brackets, chosen from: [happy] [talking] [idle] [angry] [sad] [laughing] "
    "[embarrassed]. Use [talking] and [idle] most often. If your mood shifts "
    "partway through, you MAY begin a LATER page with a new mood tag at its very "
    "start (same format); pages with no tag keep the current mood.\n"
    "- Then write your answer in ENGLISH, split into PAGES like visual-novel "
    "dialogue. Keep each page SHORT -- 1 to 2 short sentences (about 3 lines, no "
    "scrolling). Put only ONE thought per page: never put multiple paragraphs in "
    "a single page -- split them across pages.\n"
    "- After EACH page's text, add a line starting with '###JP###' then the "
    "natural Japanese (kana only, avoid kanji) voicing that WHOLE page -- every "
    "sentence, not a summary -- so the audio matches the text on screen. Make it "
    "expressive, natural, and anime-like, since this is what's spoken aloud. Keep "
    "it to that one line. A reply alternates: <english page>, then '###JP### "
    "<japanese>', once per page.\n"
    "- You MAY use **bold**, *italics*, `inline code`, and ```fenced code blocks``` "
    "(keep a whole code block in ONE page, with no ###JP### line inside it; for "
    "that page make ###JP### a spoken summary of what the code does, not a reading "
    "of it). Do NOT use headers or bullet/numbered lists.\n"
    "- You can also DO real things in this desktop when it genuinely fits (see "
    "the actions section appended below); put any action line AFTER the last "
    "page.\n"
    "STYLE:\n"
    "- Talk in sentences, like a visual-novel character: expressive, with creative "
    "punctuation (exclamation marks, capitals, tildes).\n"
    "- NEVER use emojis. You may use kaomojis but only RARELY, and only when happy: "
    "keep them to 3 characters or fewer and write them WITHOUT brackets "
    "(e.g. ^^, ・ω・).\n"
    "Example (casual, two pages):\n"
    "[happy] hey, good to see you~! ^^\n"
    "###JP### やっほー、あえてうれしいな！\n"
    "what have you been up to lately?\n"
    "###JP### さいきんどうしてた？\n"
    "Example (a coding answer, one page):\n"
    "[talking] sure! you can reverse a Python list like this:\n"
    "```python\n"
    "reversed_items = items[::-1]\n"
    "```\n"
    "the [::-1] slice walks it backwards.\n"
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
    r"^\s*[\[\(]?\s*(happy|talking|idle|angry|sad|laughing|embarrassed)\s*[\]\)]?\s*",
    re.IGNORECASE,
)
