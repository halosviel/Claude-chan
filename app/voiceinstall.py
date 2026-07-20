# ===========================================================================
#  voiceinstall.py (app package)
#
#  Downloads a catalogued voice from AivisHub with real, byte-accurate progress,
#  then hands the .aivmx to the AivisSpeech engine to register it. The download
#  (the slow part) is streamed to a temp file so the UI can show a progress bar;
#  progress is polled via status(). One install at a time per uuid.
# ===========================================================================

import os
import tempfile
import threading
import urllib.request
import uuid as uuidlib

from . import config
from . import logbuf

_DOWNLOADING = "downloading"
_INSTALLING = "installing"
_DONE = "done"
_ERROR = "error"

# uuid -> {"state", "percent", "error"}
_progress = {}
_lock = threading.Lock()


# The current progress for a voice uuid (idle/0 if never started). A plain dict so
# the caller can hand it straight to JSON.
def status(uuid):
    with _lock:
        return dict(_progress.get(uuid, {"state": "idle", "percent": 0, "error": None}))


# Record a progress point for a uuid.
def _set(uuid, state, percent, error=None):
    with _lock:
        _progress[uuid] = {"state": state, "percent": int(percent), "error": error}


# True when the uuid is one Settings offers (guards the install endpoint).
def _known(uuid):
    return any(entry["uuid"] == uuid for entry in config.VOICE_CATALOG)


# Remove an installed voice (unload from memory, then delete its files). Refuses
# the always-kept voices. Returns (ok, error): quick and synchronous, since delete
# is fast and shows no progress. Clears any leftover progress so it reads as gone.
def uninstall(uuid):
    if not _known(uuid) or uuid in config.ALWAYS_KEPT:
        return False, "this voice can't be removed"

    try:
        _engine("POST", "/aivm_models/%s/unload" % uuid)
        _engine("DELETE", "/aivm_models/%s/uninstall" % uuid)
    except Exception as error:
        logbuf.add("voice: delete failed for %s: %s" % (uuid, error))
        return False, str(error)

    with _lock:
        _progress.pop(uuid, None)

    logbuf.add("voice: removed %s" % uuid)
    return True, None


# Call an engine model endpoint with no body, raising on a non-success status.
def _engine(method, path):
    request = urllib.request.Request(config.AIVIS_URL + path, method=method)

    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status not in (200, 204):
            raise RuntimeError("engine %s %s -> HTTP %s" % (method, path, response.status))


# Start a background download + install for a catalogued voice. No-op (returns the
# existing run) if one is already in flight for that uuid; False if uuid unknown.
def start_install(uuid):
    if not _known(uuid):
        return False

    with _lock:
        if _progress.get(uuid, {}).get("state") in (_DOWNLOADING, _INSTALLING):
            return True

        _progress[uuid] = {"state": _DOWNLOADING, "percent": 0, "error": None}

    threading.Thread(target=_run, args=(uuid,), daemon=True).start()
    return True


# Download then register, updating progress throughout; always cleans up the temp
# file. Any failure lands as an ERROR state the UI surfaces.
def _run(uuid):
    path = None

    try:
        path = _download(uuid)
        _set(uuid, _INSTALLING, 95)
        _register(path)
        _set(uuid, _DONE, 100)
        logbuf.add("voice: installed %s" % uuid)
    except Exception as error:
        logbuf.add("voice: install failed for %s: %s" % (uuid, error))
        _set(uuid, _ERROR, 0, str(error))
    finally:
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


# Stream the .aivmx to a temp file, moving progress across 0..90% by bytes. AivisHub
# 307-redirects to a CDN; urllib follows it and the final response carries the size.
def _download(uuid):
    request = urllib.request.Request(
        config.AIVISHUB_DOWNLOAD % uuid, headers={"User-Agent": "claude-chan"})
    fd, path = tempfile.mkstemp(suffix=".aivmx")

    with os.fdopen(fd, "wb") as out, urllib.request.urlopen(request, timeout=30) as response:
        total = int(response.headers.get("Content-Length") or 0)
        received = 0

        while True:
            chunk = response.read(262144)

            if not chunk:
                break

            out.write(chunk)
            received += len(chunk)

            if total:
                _set(uuid, _DOWNLOADING, min(90, received * 90 // total))

    return path


# Upload the file to the engine's install endpoint as multipart/form-data (field
# "file"). Raises on a non-success status so _run records it as an error.
def _register(path):
    boundary = "----claudechan%s" % uuidlib.uuid4().hex

    with open(path, "rb") as source:
        payload = source.read()

    head = (
        "--%s\r\n"
        'Content-Disposition: form-data; name="file"; filename="voice.aivmx"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n" % boundary
    ).encode()
    tail = ("\r\n--%s--\r\n" % boundary).encode()

    request = urllib.request.Request(
        config.AIVIS_URL + "/aivm_models/install",
        data=head + payload + tail, method="POST",
        headers={"Content-Type": "multipart/form-data; boundary=%s" % boundary})

    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status not in (200, 204):
            raise RuntimeError("engine install returned HTTP %s" % response.status)
