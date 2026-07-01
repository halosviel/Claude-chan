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

        # hide male and otherwise-excluded voices
        if name in config.MALE_VOICES or name in config.HIDDEN_VOICES:
            continue

        styles = speaker.get("styles", [])

        if not styles:
            continue

        # keep only the original (Normal) style -- drop the variations
        base = next((st for st in styles if st.get("name") == "ノーマル"), styles[0])
        display = config.VOICE_NAME_ROMAJI.get(name, name)
        voices.append({"id": base.get("id"), "name": display})

    # label the default voice and move it to the top of the list
    default = []
    rest = []

    for voice in voices:
        if voice["id"] == config.AIVIS_SPEAKER:
            voice["name"] = voice["name"] + " (default)"
            default.append(voice)
        else:
            rest.append(voice)

    return default + rest


# Return True when the AivisSpeech engine answers its /version endpoint.
def engine_up():
    try:
        with urllib.request.urlopen(config.AIVIS_URL + "/version", timeout=1.5) as response:
            return response.status == 200
    except Exception:
        return False


# Render Japanese text to WAV bytes via AivisSpeech (audio_query then synthesis),
# using `speaker` (style id) or the configured default. Returns None, logging the
# reason, on empty text or any engine error.
def synth_wav(text, speaker=None):
    # collapse newlines to spaces -- AivisSpeech otherwise stops at the first one
    text = " ".join((text or "").split("\n")).strip()

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
