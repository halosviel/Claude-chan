# ===========================================================================
#  voice.py
#
#  Speech synthesis via the AivisSpeech engine (a local server with a
#  VOICEVOX-compatible API). Japanese text in, WAV bytes out. There is no
#  fallback: if the engine is unreachable these functions return None / False
#  and log the reason to the console, leaving the app silent.
# ===========================================================================

import json
import urllib.parse
import urllib.request

from . import config
from . import logbuf


# Record a voice-related line (console + in-app terminal).
def log(message):
    logbuf.add("voice: " + message)


# Return the installed voices as a flat list of {"id", "name"} (one per style),
# queried from the AivisSpeech engine. Empty list if the engine is unreachable.
def list_voices():
    try:
        with urllib.request.urlopen(config.AIVIS_URL + "/speakers", timeout=3) as response:
            speakers = json.loads(response.read())
    except Exception as error:
        log("could not list voices: %s" % error)
        return []

    voices = []

    for speaker in speakers:
        name = speaker.get("name", "voice")

        # hide male voices
        if name in config.MALE_VOICES:
            continue

        # romanise the speaker name (fall back to the original)
        display = config.VOICE_NAME_ROMAJI.get(name, name)

        for style in speaker.get("styles", []):
            style_name = style.get("name", "")
            style_label = config.VOICE_STYLE_ROMAJI.get(style_name, style_name)

            if not style_label or style_name == "ノーマル":
                label = display
            else:
                label = "%s (%s)" % (display, style_label)

            voices.append({"id": style.get("id"), "name": label})

    return voices


# Return True when the AivisSpeech engine answers its /version endpoint.
def engine_up():
    try:
        with urllib.request.urlopen(config.AIVIS_URL + "/version", timeout=1.5) as response:
            return response.status == 200
    except Exception as error:
        log("AivisSpeech not reachable at %s (%s). Is the engine running?"
            % (config.AIVIS_URL, error))
        return False


# Render Japanese text to WAV bytes via AivisSpeech (audio_query then synthesis),
# using `speaker` (style id) or the configured default. Returns None, logging the
# reason, on empty text or any engine error.
def synth_wav(text, speaker=None):
    text = (text or "").strip()

    if not text:
        return None

    try:
        speaker = int(speaker)
    except (TypeError, ValueError):
        speaker = config.AIVIS_SPEAKER

    try:
        query_url = "%s/audio_query?speaker=%d&text=%s" % (
            config.AIVIS_URL, speaker, urllib.parse.quote(text))
        query_request = urllib.request.Request(query_url, method="POST")

        with urllib.request.urlopen(query_request, timeout=15) as response:
            query = response.read()

        synth_url = "%s/synthesis?speaker=%d" % (config.AIVIS_URL, speaker)
        synth_request = urllib.request.Request(
            synth_url, data=query, method="POST",
            headers={"Content-Type": "application/json"})

        with urllib.request.urlopen(synth_request, timeout=30) as response:
            wav = response.read()

        if not wav:
            log("AivisSpeech returned empty audio.")
            return None

        return wav
    except Exception as error:
        log("AivisSpeech synthesis failed: %s" % error)
        return None
