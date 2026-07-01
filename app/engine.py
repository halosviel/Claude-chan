# ===========================================================================
#  engine.py (app package)
#
#  Owns the AivisSpeech engine process so its lifetime is tied to the app: the
#  app launches the headless engine (~/.local/bin/aivisspeech-engine) on start
#  and it is stopped again when the app exits -- Ctrl+C, VS Code's stop button,
#  or systemd. Three things make that robust:
#    * PR_SET_PDEATHSIG makes the kernel signal the engine if the app dies for
#      any reason (even SIGKILL), so it can never be orphaned.
#    * an atexit hook + a SIGTERM handler stop it cleanly (with a log line).
#    * the engine pid is carried across the reload re-exec in an env var, so a
#      backend edit re-attaches to the same engine instead of spawning a second.
#  An engine that was already running (started by hand) is left untouched -- we
#  only ever stop the one we launched.
# ===========================================================================

import atexit
import ctypes
import os
import signal
import subprocess
import threading
import time

from . import voice
from . import logbuf


# Headless AivisSpeech launcher (serves 127.0.0.1:10101). Override with the env
# var if it lives elsewhere; not on PATH, so the full path is the default.
AIVIS_LAUNCHER = os.environ.get(
    "AIVIS_LAUNCHER", os.path.expanduser("~/.local/bin/aivisspeech-engine"))

# Carries the engine pid across the reload os.execv, so the re-exec'd process
# adopts the same engine instead of spawning another or orphaning the first.
_PID_ENV = "CLAUDECHAN_ENGINE_PID"

# The engine Popen we launched (None if one was already up and we attached).
_proc = None
_cleanup_installed = False


# True when a process with this pid is currently alive.
def _alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


# Ask the kernel to send us SIGTERM when our parent (the app) dies, so the
# engine cannot outlive the app even on an uncatchable kill. Linux-only.
def _die_with_parent():
    PR_SET_PDEATHSIG = 1
    ctypes.CDLL("libc.so.6", use_errno=True).prctl(PR_SET_PDEATHSIG, signal.SIGTERM)


# Launch the AivisSpeech engine if it isn't already serving, and arrange for it
# to be stopped when the app exits. Call once from main(); safe to no-op.
def start():
    global _proc

    if voice.engine_up():
        logbuf.add("engine: AivisSpeech already running; leaving it as-is")
        return

    carried = os.environ.get(_PID_ENV, "")
    if carried.isdigit() and _alive(int(carried)):
        logbuf.add("engine: re-attached to AivisSpeech pid %s after reload" % carried)
        _install_cleanup()
        return

    try:
        _proc = subprocess.Popen(
            [AIVIS_LAUNCHER],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True, preexec_fn=_die_with_parent)
    except OSError as error:
        logbuf.add("engine: could not start AivisSpeech (%s)" % error)
        return

    os.environ[_PID_ENV] = str(_proc.pid)
    logbuf.add("engine: started AivisSpeech (pid %d)" % _proc.pid)
    _install_cleanup()
    threading.Thread(target=_wait_ready, daemon=True).start()


# Poll /version in the background until the engine answers, just to log when
# voice becomes available -- it does not block the server from serving.
def _wait_ready(timeout=40):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if voice.engine_up():
            logbuf.add("engine: AivisSpeech is ready")
            return
        time.sleep(2)
    logbuf.add("engine: AivisSpeech did not answer within %ds (voice may lag)" % timeout)


# Stop the engine we launched. Idempotent, and a no-op when we merely attached
# to an engine that was already running (we only kill what we started).
def stop():
    global _proc

    pid = None
    if _proc is not None and _proc.poll() is None:
        pid = _proc.pid
    else:
        carried = os.environ.get(_PID_ENV, "")
        if carried.isdigit() and _alive(int(carried)):
            pid = int(carried)

    if pid is None:
        return

    logbuf.add("engine: stopping AivisSpeech (pid %d)" % pid)
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except OSError:
        pass

    os.environ.pop(_PID_ENV, None)
    _proc = None


# Run stop() on normal exit and on SIGTERM (systemd / VS Code stop). SIGINT is
# left as the default KeyboardInterrupt so main()'s Ctrl+C path unwinds cleanly,
# after which the atexit hook stops the engine.
def _install_cleanup():
    global _cleanup_installed
    if _cleanup_installed:
        return
    _cleanup_installed = True

    atexit.register(stop)

    def _on_term(signum, frame):
        stop()
        raise SystemExit(0)

    try:
        signal.signal(signal.SIGTERM, _on_term)
    except ValueError:
        pass
