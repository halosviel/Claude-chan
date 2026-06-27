# ===========================================================================
#  server.py (app package)
#
#  The HTTP layer: a stdlib request handler that serves the static frontend and
#  the small JSON/audio API, plus main() which runs the threaded server. All the
#  real work (images, voice, chat) lives in sibling modules; this file only
#  routes requests to them. See robots.txt for the endpoint map.
# ===========================================================================

import http.server
import json
import socketserver
import urllib.parse

from . import config
from . import images
from . import voice
from . import chat
from . import logbuf


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
            emotion = (query.get("emotion", ["thinking"])[0] or "thinking").lower()
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

        if parsed.path == "/voices":
            self._json({"voices": voice.list_voices(), "default": config.AIVIS_SPEAKER})
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

    # Route POST /chat: validate the body, run the model, return the reply JSON.
    def do_POST(self):
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
            self._json({"emotion": "thinking",
                        "segments": [{"text": "...you didn't say anything.", "speech": ""}],
                        "permission": "", "action": None,
                        "image": images.pick_image("thinking")})
            return

        preview = message if len(message) <= 120 else message[:117] + "..."
        logbuf.add("POST /chat: %r (model=%s)" % (preview, model or "default"))

        emotion, segments, permission, action = chat.run_claude(message, model)

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
                    "image": images.pick_image(emotion)})

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

    with socketserver.ThreadingTCPServer(("127.0.0.1", config.PORT), Handler) as httpd:
        print("Claude-chan running at  http://localhost:%d" % config.PORT)
        print("Press Ctrl+C to stop.")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye~")
