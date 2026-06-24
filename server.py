#!/usr/bin/env python3
"""Claude_chan -- a 100% local desktop chat companion (server).

====================================================================
NOTES FOR FUTURE CLAUDE SESSIONS  (read CLAUDE.md too for the full map)
====================================================================

WHAT THIS IS
  A tiny local web app: you type, *Claude* replies (via the `claude` CLI, NOT
  the Anthropic API -- so no API key/billing), an anime-girl portrait changes
  with the mood, and the reply is spoken aloud in Japanese. Single user, local.

HOW THE "NO API" CHAT WORKS
  run_claude() shells out to:  claude -p <msg> --output-format json
                               --append-system-prompt <SYSTEM_PROMPT>
  First turn uses --session-id <new uuid>; later turns use --resume <same uuid>
  so the conversation keeps context. The model is told (see SYSTEM_PROMPT) to
  begin every reply with a mood tag like "[happy]" and to end with a line
  "###JP### <kana>" -- the Japanese version used for the voice. parse() splits
  the result into (emotion, english_text, japanese_speech).

HTTP ENDPOINTS (all served on 127.0.0.1:PORT, default 8765)
  GET  /                      static files (index.html, style.css, app.js, images/)
  GET  /image?emotion=<e>     -> {emotion, image}  picks a random PNG (see below)
  GET  /tts                   -> {server: bool, engine: "aivisspeech"|null}
  GET  /speak?text=<jp>       -> WAV audio bytes (or 503 if engine down)
  POST /chat  {message}       -> {emotion, text, speech, image}

IMAGES  (images/<emotion>/*.png)  *** DO NOT REGENERATE OR OVERWRITE ***
  The user hand-curates these folders (some intentionally empty). pick_image()
  returns a random PNG from images/<emotion>/, never repeating the last one,
  and falls back to images/thinking/ when a folder is empty (this is BY DESIGN,
  not a bug). generate_avatars.py made the original placeholders -- do NOT run
  it; it would clobber the user's pictures. Emotions: happy, talking, thinking,
  angry, sad, laughing, embarrassed.

VOICE  (see the AivisSpeech section lower in this file + CLAUDE.md)
  Spoken entirely by the AivisSpeech engine (local, :10101). No fallback. To
  change the voice, edit AIVIS_SPEAKER below (or set the env var). To add/remove
  voices, see CLAUDE.md "Voices".

RUN
  Engine first:  ~/.local/bin/aivisspeech-engine   (serves :10101)
  Then:          python3 server.py   ->  http://localhost:8765   (or VS Code F5)
"""
import http.server
import json
import os
import random
import re
import socketserver
import subprocess
import urllib.parse
import urllib.request
import uuid

PORT = 8765
ROOT = os.path.dirname(os.path.abspath(__file__))
EMOTIONS_DIR = os.path.join(ROOT, "images", "emotions")
BACKGROUNDS_DIR = os.path.join(ROOT, "images", "backgrounds")
# played when Claude-chan asks permission (lives outside the repo)
PERMISSION_SOUND = os.path.expanduser("~/Local/Rice/Sounds/claude_permission.mp3")
SESSION_ID = str(uuid.uuid4())
STATE = {"started": False}

# The voice is spoken entirely by AivisSpeech -- a local engine on :10101 with
# natural, expressive anime voices. There is no fallback: if it isn't running,
# the app stays silent and the reason is printed to the console. Nothing is
# bundled; just launch the engine and it's picked up automatically.
AIVIS_URL = os.environ.get("AIVIS_URL", "http://127.0.0.1:10101")
# Which voice/style speaks. List options with: curl :10101/speakers
AIVIS_SPEAKER = int(os.environ.get("AIVIS_SPEAKER", "345585728"))

EMOTIONS = {"happy", "talking", "thinking", "angry", "sad", "laughing", "embarrassed"}
FALLBACK_EMOTION = "thinking"

# Remembers the last image shown per folder so the same emotion doesn't repeat
# the same picture back to back.
_LAST_PICK = {}


IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp")


def list_pngs(folder):
    d = os.path.join(EMOTIONS_DIR, folder)
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d) if f.lower().endswith(".png"))


def pick_image(emotion):
    """Pick a random PNG from images/emotions/<emotion>/, avoiding an immediate
    repeat. If that folder has no PNGs, fall back to images/emotions/thinking/.
    Returns a web path (e.g. "images/emotions/happy/foo.png") or None.
    """
    if emotion not in EMOTIONS:
        emotion = "talking"
    folder = emotion
    files = list_pngs(folder)
    if not files:
        folder = FALLBACK_EMOTION
        files = list_pngs(folder)
    if not files:
        return None
    last = _LAST_PICK.get(folder)
    choices = [f for f in files if f != last] or files
    chosen = random.choice(choices)
    _LAST_PICK[folder] = chosen
    return f"images/emotions/{folder}/{chosen}"


def list_backgrounds():
    """Filenames of every image in images/backgrounds/ (sorted)."""
    if not os.path.isdir(BACKGROUNDS_DIR):
        return []
    return sorted(f for f in os.listdir(BACKGROUNDS_DIR)
                  if f.lower().endswith(IMAGE_EXTS))


def log(msg):
    print("[voice] " + msg, flush=True)


def engine_up():
    """True if the AivisSpeech engine is reachable."""
    try:
        with urllib.request.urlopen(AIVIS_URL + "/version", timeout=1.5) as r:
            return r.status == 200
    except Exception as e:
        log("AivisSpeech not reachable at %s (%s). Is the engine running?"
            % (AIVIS_URL, e))
        return False


def synth_wav(text):
    """Render Japanese text to WAV bytes via AivisSpeech. Returns None (and logs
    the reason to the console) if the engine isn't reachable or errors."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        q = "%s/audio_query?speaker=%d&text=%s" % (
            AIVIS_URL, AIVIS_SPEAKER, urllib.parse.quote(text))
        with urllib.request.urlopen(urllib.request.Request(q, method="POST"),
                                    timeout=15) as r:
            query = r.read()
        syn = "%s/synthesis?speaker=%d" % (AIVIS_URL, AIVIS_SPEAKER)
        req = urllib.request.Request(syn, data=query, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            wav = r.read()
        if not wav:
            log("AivisSpeech returned empty audio.")
            return None
        return wav
    except Exception as e:
        log("AivisSpeech synthesis failed: %s" % e)
        return None

SYSTEM_PROMPT = (
    "You are chatting through a cute little desktop companion app. A picture "
    "of an anime girl represents your current mood as you talk.\n\n"
    "Rules for EVERY reply:\n"
    "- Begin with exactly one mood tag, alone, in square brackets, chosen from: "
    "[happy] [talking] [thinking] [angry] [sad] [laughing] [embarrassed]. Use "
    "[thinking] and [talking] most often; reserve the others for when you "
    "genuinely feel them.\n"
    "- After the tag, reply like a real person in casual conversation.\n"
    "- Keep each sentence short -- no sentence longer than one line. You may "
    "string together a few short lines if you want.\n"
    "- Warm, natural, human. No markdown, no bullet lists, no headings, and no "
    "code blocks unless explicitly asked.\n"
    "- Then output ###JP### followed by a short, natural Japanese version of "
    "your reply, for the voice. Write it in hiragana/katakana (kana) only, "
    "avoiding kanji so it is pronounced correctly.\n"
    "- If (and ONLY if) you want to DO something that needs my permission, add "
    "one more final line: ###PERM### followed by a short summary of what you "
    "want to do. Omit this line entirely when no permission is needed.\n"
    "Example reply:\n"
    "[happy] oh hey, good to see you!\n"
    "what's up?\n"
    "###JP### やっほー、あえてうれしいよ！どうしたの？"
)

JP_MARKER = "###JP###"
PERM_MARKER = "###PERM###"

TAG_RE = re.compile(
    r"^\s*[\[\(]?\s*(happy|talking|thinking|angry|sad|laughing|embarrassed)\s*[\]\)]?\s*",
    re.IGNORECASE)


def read_personality():
    """Read personality.txt (next to this file) live each turn, so the user can
    edit Claude-chan's personality without restarting. Empty/missing -> ''."""
    try:
        with open(os.path.join(ROOT, "personality.txt"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def run_claude(prompt):
    system = SYSTEM_PROMPT
    personality = read_personality()
    if personality:
        system += ("\n\n--- Personality (from personality.txt; adopt this as "
                   "who you are) ---\n" + personality)
    cmd = [
        "claude", "-p", prompt,
        "--output-format", "json",
        "--append-system-prompt", system,
    ]
    if STATE["started"]:
        cmd += ["--resume", SESSION_ID]
    else:
        cmd += ["--session-id", SESSION_ID]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              cwd=ROOT, timeout=180)
    except subprocess.TimeoutExpired:
        return "thinking", "sorry, i got stuck thinking for too long there...", "", ""
    except FileNotFoundError:
        return "sad", "i can't find the claude CLI -- is it installed and on your PATH?", "", ""

    STATE["started"] = True

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()[-400:]
        return "thinking", "hmm, something went sideways on my end...\n" + err, "", ""

    text = proc.stdout.strip()
    try:
        data = json.loads(proc.stdout)
        text = (data.get("result") or "").strip()
    except (json.JSONDecodeError, AttributeError):
        pass
    return parse(text)


def parse(text):
    emotion = "talking"
    m = TAG_RE.match(text)
    if m:
        emotion = m.group(1).lower()
        text = text[m.end():].strip()
    if emotion not in EMOTIONS:
        emotion = "talking"
    # permission request line is last, if present
    permission = ""
    if PERM_MARKER in text:
        text, perm = text.split(PERM_MARKER, 1)
        permission = perm.strip()
        text = text.strip()
    speech = text
    if JP_MARKER in text:
        english, japanese = text.split(JP_MARKER, 1)
        text = english.strip()
        speech = japanese.strip()
    return emotion, text, speech, permission


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass  # keep the console quiet

    def end_headers(self):
        # Local single-user app: never let the browser cache static files, so
        # edits to app.js/style.css/images show up on a plain reload.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/image":
            qs = urllib.parse.parse_qs(parsed.query)
            emotion = (qs.get("emotion", ["thinking"])[0] or "thinking").lower()
            self._json({"emotion": emotion, "image": pick_image(emotion)})
            return
        if parsed.path == "/tts":
            # Tells the frontend whether the AivisSpeech engine can speak.
            up = engine_up()
            self._json({"server": up, "engine": "aivisspeech" if up else None})
            return
        if parsed.path == "/backgrounds":
            self._json({"backgrounds": list_backgrounds()})
            return
        if parsed.path == "/permission-sound":
            try:
                with open(PERMISSION_SOUND, "rb") as f:
                    data = f.read()
            except OSError:
                self.send_error(404, "permission sound not found")
                return
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/speak":
            qs = urllib.parse.parse_qs(parsed.query)
            wav = synth_wav(qs.get("text", [""])[0])
            if wav is None:
                self.send_error(503, "server TTS unavailable")
                return
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/chat":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            message = (payload.get("message") or "").strip()
        except (json.JSONDecodeError, ValueError):
            message = ""
        if not message:
            self._json({"emotion": "thinking", "text": "...you didn't say anything.",
                        "speech": "", "permission": "", "image": pick_image("thinking")})
            return
        emotion, text, speech, permission = run_claude(message)
        self._json({"emotion": emotion, "text": text, "speech": speech,
                    "permission": permission, "image": pick_image(emotion)})

    def _json(self, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Chiyo chat running at  http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye~")


if __name__ == "__main__":
    main()
