# ===========================================================================
#  server.py (app package)
#
#  The HTTP layer: a stdlib request handler that serves the static frontend and
#  the small JSON/audio API, plus main() which runs the threaded server. All the
#  real work (images, voice, chat) lives in sibling modules; this file only
#  routes requests to them. See robots.txt for the endpoint map.
# ===========================================================================

import glob
import http.server
import json
import os
import socketserver
import sys
import threading
import time
import urllib.parse
import uuid

from . import config
from . import images
from . import voice
from . import voiceinstall
from . import chat
from . import logbuf
from . import engine


# Backend files (server + app package). A change here needs a process restart.
def _backend_signature():
    files = [os.path.join(config.ROOT, "server.py")] + glob.glob(os.path.join(config.ROOT, "app", "*.py"))
    return tuple(sorted((p, os.path.getmtime(p)) for p in files if os.path.exists(p)))


# Watch the backend files and re-exec the process when one changes, so editing
# Python takes effect without a manual restart. Disable with CLAUDECHAN_RELOAD=0.
def _watch_and_restart():
    last = _backend_signature()

    while True:
        time.sleep(1)

        try:
            current = _backend_signature()
        except OSError:
            continue

        if current != last:
            logbuf.add("reload: backend changed -> restarting")
            print("reloading (a backend file changed)...")
            os.execv(sys.executable, [sys.executable] + sys.argv)


class Handler(http.server.SimpleHTTPRequestHandler):
    # Serve static files from the project root (where index.html lives).
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=config.ROOT, **kwargs)

    # Silence the default per-request console logging.
    def log_message(self, *args):
        pass

    # Never let the browser cache static files, so edits to the frontend show up
    # on a plain reload.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    # Route GET requests: the small JSON/audio API first, then static files.
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/image":
            query = urllib.parse.parse_qs(parsed.query)
            emotion = (query.get("emotion", ["idle"])[0] or "idle").lower()
            self._json({"emotion": emotion, "image": images.pick_image(emotion)})
            return

        if parsed.path == "/models":
            self._json({"models": config.CHAT_MODELS, "default": config.DEFAULT_MODEL})
            return

        if parsed.path == "/tts":
            up = voice.engine_up()
            self._json({"server": up, "engine": "aivisspeech" if up else None})
            return

        if parsed.path == "/backgrounds":
            self._json({"backgrounds": images.list_backgrounds()})
            return

        if parsed.path == "/portraits":
            self._json({"portraits": images.list_all_portraits()})
            return

        if parsed.path == "/voices":
            catalog = voice.list_catalog()
            self._json({
                "voices": catalog or [],
                "default": config.AIVIS_SPEAKER,
                "engine_up": catalog is not None,
            })
            return

        if parsed.path == "/voices/install-status":
            query = urllib.parse.parse_qs(parsed.query)
            self._json(voiceinstall.status(query.get("uuid", [""])[0]))
            return

        if parsed.path == "/logs":
            query = urllib.parse.parse_qs(parsed.query)

            try:
                seq = int(query.get("since", ["0"])[0])
            except (TypeError, ValueError):
                seq = 0

            lines, latest = logbuf.since(seq)
            self._json({"lines": lines, "seq": latest})
            return

        if parsed.path == "/speak":
            query = urllib.parse.parse_qs(parsed.query)
            speaker = query.get("speaker", [None])[0]
            wav = voice.synth_wav(query.get("text", [""])[0], speaker)

            if wav is None:
                logbuf.add("speak: TTS unavailable (engine down or synth failed)")
                self.send_error(503, "server TTS unavailable")
                return

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
            return

        super().do_GET()

    # Image extensions by content type, for saving pasted images.
    _IMAGE_EXTS = {
        "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
        "image/gif": ".gif", "image/webp": ".webp",
    }

    # Route POST: a pasted image upload, a voice download, or a chat turn.
    def do_POST(self):
        if self.path == "/paste-image":
            self._save_pasted_image()
            return

        if self.path == "/voices/install":
            length = int(self.headers.get("Content-Length", 0))

            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (json.JSONDecodeError, ValueError):
                payload = {}

            started = voiceinstall.start_install((payload.get("uuid") or "").strip())
            self._json({"ok": started})
            return

        if self.path == "/voices/delete":
            length = int(self.headers.get("Content-Length", 0))

            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (json.JSONDecodeError, ValueError):
                payload = {}

            ok, error = voiceinstall.uninstall((payload.get("uuid") or "").strip())
            self._json({"ok": ok, "error": error})
            return

        if self.path != "/chat":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))

        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            message = (payload.get("message") or "").strip()
            model = (payload.get("model") or "").strip()
        except (json.JSONDecodeError, ValueError):
            message = ""
            model = ""

        if not message:
            self._json({"emotion": "idle",
                        "segments": [{"text": "...you didn't say anything.", "speech": ""}],
                        "permission": "", "action": None,
                        "image": images.pick_image("idle")})
            return

        preview = message if len(message) <= 120 else message[:117] + "..."
        logbuf.add("POST /chat: %r (model=%s)" % (preview, model or "default"))

        emotion, segments, permission, action, out_of_credits = chat.run_claude(message, model)

        # Only allow a background action that names a real background file.
        if action and action.get("type") == "background":
            if action.get("value") not in images.list_backgrounds():
                logbuf.add("action: dropped invalid background %r" % action.get("value"))
                action = None
                permission = ""

        if action:
            logbuf.add("action: proposed %s -> %r" % (action.get("type"), action.get("value")))

        spoken = sum(1 for s in segments if s.get("speech"))
        logbuf.add("chat: -> emotion=%s, %d page(s), %d spoken" % (emotion, len(segments), spoken))

        self._json({"emotion": emotion, "segments": segments,
                    "permission": permission, "action": action,
                    "out_of_credits": out_of_credits,
                    "image": images.pick_image(emotion)})

    # Save a pasted image to PASTE_DIR and return its absolute path, so the chat
    # message can point Claude-chan's Read tool at it (Read can view images).
    def _save_pasted_image(self):
        length = int(self.headers.get("Content-Length", 0))
        ctype = (self.headers.get("Content-Type", "image/png").split(";")[0]).strip().lower()

        if length <= 0 or length > 30 * 1024 * 1024:
            self.send_error(413, "image missing or too large")
            return

        data = self.rfile.read(length)
        ext = self._IMAGE_EXTS.get(ctype, ".png")
        os.makedirs(config.PASTE_DIR, exist_ok=True)
        name = "paste-" + uuid.uuid4().hex[:12] + ext
        path = os.path.join(config.PASTE_DIR, name)

        with open(path, "wb") as handle:
            handle.write(data)

        logbuf.add("paste: saved image %s (%d bytes)" % (name, len(data)))
        self._json({"path": path, "name": name})

    # Write an object as a JSON 200 response.
    def _json(self, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# Start the threaded HTTP server and serve until interrupted.
def main():
    socketserver.TCPServer.allow_reuse_address = True

    # Bind first; if the port is taken, it's already running -- say so plainly
    # instead of crashing with a traceback (e.g. F5 while the service is up).
    try:
        httpd = socketserver.ThreadingTCPServer(("127.0.0.1", config.PORT), Handler)
    except OSError:
        print("Claude-chan is already running on port %d (the claudechan service or" % config.PORT)
        print("another instance). Stop it first:  systemctl --user stop claudechan")
        return

    # Bring the AivisSpeech engine up alongside the app (stopped again on exit).
    engine.start()

    # Auto-restart on backend edits (unless disabled) so Python changes apply
    # without a manual restart. The page is refreshed by hand (no live-reload).
    if os.environ.get("CLAUDECHAN_RELOAD") != "0":
        threading.Thread(target=_watch_and_restart, daemon=True).start()

    # Pre-connect the warm chat session so the first reply skips the connect cost.
    chat.warm_up()

    with httpd:
        print("Claude-chan running at  http://localhost:%d" % config.PORT)
        print("Press Ctrl+C to stop.")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye~")
