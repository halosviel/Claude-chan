# ===========================================================================
#  voice.py
#
#  Speech synthesis via the AivisSpeech engine (a local server with a
#  VOICEVOX-compatible API). Japanese text in, WAV bytes out. There is no
#  fallback: if the engine is unreachable these functions return None / False
#  and log the reason to the console, leaving the app silent.
# ===========================================================================

import glob
import hashlib
import json
import os
import time
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
    # Order: the default first, then the other installed voices (all selectable
    # radios grouped at the top), then the not-installed ones (download rows).
    default = []
    installed = []
    available = []

    for voice in voices:
        if voice["id"] == config.AIVIS_SPEAKER:
            voice["name"] = voice["name"] + " (default)"
            default.append(voice)
        elif voice["installed"]:
            installed.append(voice)
        else:
            available.append(voice)

    return default + installed + available


# The set of style ids the engine currently has installed (from /speakers), or
# None if the engine is unreachable -- used to flag catalog voices installed.
def _installed_style_ids():
    try:
        with urllib.request.urlopen(config.AIVIS_URL + "/speakers", timeout=3) as response:
            speakers = json.loads(response.read())
    except Exception as error:
        log("could not list voices: %s" % error)
        return None

    return {style.get("id") for speaker in speakers for style in speaker.get("styles", [])}


# The Settings voice list: every catalogued voice with an `installed` flag, so the
# UI can show installed ones as selectable and offer the rest as downloads. The
# default voice is labelled and moved to the top. Returns None if the engine is
# unreachable (so the UI can say so instead of offering downloads that can't run).
def list_catalog():
    installed = _installed_style_ids()

    if installed is None:
        return None

    voices = []

    for entry in config.VOICE_CATALOG:
        name = config.VOICE_NAME_ROMAJI.get(entry["jp"], entry["jp"])
        voices.append({
            "id": entry["style_id"],
            "name": name,
            "uuid": entry["uuid"],
            "installed": entry["style_id"] in installed,
            "deletable": entry["uuid"] not in config.ALWAYS_KEPT,
        })

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


# The engine's speaker list, cached briefly: a mood style is looked up per
# synthesis, and /speakers is slow enough to matter across a multi-page reply.
# The TTL is short so a voice installed mid-session still turns up.
_speakers_cache = (0.0, None)
_SPEAKERS_TTL = 60.0


# Return the engine's /speakers payload, served from the cache while fresh.
def _speakers():
    global _speakers_cache

    stamp, cached = _speakers_cache

    if cached is not None and time.time() - stamp < _SPEAKERS_TTL:
        return cached

    try:
        with urllib.request.urlopen(config.AIVIS_URL + "/speakers", timeout=3) as response:
            speakers = json.loads(response.read())
    except Exception as error:
        log("could not list voices: %s" % error)
        return []

    _speakers_cache = (time.time(), speakers)
    return speakers


# The style id a mood should be spoken with: the style named `style_name` on the
# same voice as `speaker`, or `speaker` unchanged when that voice hasn't got one
# (Runa is single-style, so her moods ride on the query knobs alone).
def _style_for(speaker, style_name):
    if not style_name:
        return speaker

    for entry in _speakers():
        styles = entry.get("styles", [])

        if not any(style.get("id") == speaker for style in styles):
            continue

        for style in styles:
            if style.get("name") == style_name:
                return style.get("id", speaker)

        return speaker

    return speaker


# Where a rendered line is cached. The key covers everything that shapes the
# audio -- the text, the style speaking it, and the mood knobs -- so retuning a
# mood (or switching voice) can never serve the previous take.
def _cache_path(text, style, profile):
    seed = json.dumps([text, style, profile], sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()

    return os.path.join(config.SPEECH_CACHE_DIR, digest + ".wav")


# Read a cached render, or None when it isn't there (or can't be read).
def _cache_read(path):
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError:
        return None


# Store a render, then keep the cache bounded: once it is over the file limit
# the oldest renders are dropped back down to it.
def _cache_write(path, wav):
    try:
        os.makedirs(config.SPEECH_CACHE_DIR, exist_ok=True)

        with open(path, "wb") as handle:
            handle.write(wav)

        files = glob.glob(os.path.join(config.SPEECH_CACHE_DIR, "*.wav"))
        excess = len(files) - config.SPEECH_CACHE_MAX_FILES

        if excess > 0:
            files.sort(key=os.path.getmtime)

            for stale in files[:excess]:
                os.remove(stale)
    except OSError as error:
        log("could not cache speech: %s" % error)


# Render Japanese text to WAV bytes via AivisSpeech (audio_query then synthesis),
# using `speaker` (style id) or the configured default, acted in `mood` (a key of
# config.MOOD_VOICE -- see it for how a mood shapes the voice). Renders are cached
# on disk, so a line she has already said comes back instantly, reload or not.
# Returns None, logging the reason, on empty text or any engine error.
def synth_wav(text, speaker=None, mood=None):
    # collapse newlines to spaces -- AivisSpeech otherwise stops at the first one
    text = " ".join((text or "").split("\n")).strip()

    if not text:
        return None

    try:
        speaker = int(speaker)
    except (TypeError, ValueError):
        speaker = config.AIVIS_SPEAKER

    profile = config.MOOD_VOICE.get((mood or "").strip().lower(), {})
    style = _style_for(speaker, profile.get("style"))
    path = _cache_path(text, style, profile)
    cached = _cache_read(path)

    if cached:
        return cached

    try:
        query_url = "%s/audio_query?speaker=%d&text=%s" % (
            config.AIVIS_URL, style, urllib.parse.quote(text))
        query_request = urllib.request.Request(query_url, method="POST")

        with urllib.request.urlopen(query_request, timeout=15) as response:
            query = json.loads(response.read())

        # only the knobs the engine actually offers ("style" is not one of them)
        for key, value in profile.items():
            if key in query:
                query[key] = value

        synth_url = "%s/synthesis?speaker=%d" % (config.AIVIS_URL, style)
        synth_request = urllib.request.Request(
            synth_url, data=json.dumps(query).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json"})

        with urllib.request.urlopen(synth_request, timeout=30) as response:
            wav = response.read()

        if not wav:
            log("AivisSpeech returned empty audio.")
            return None

        _cache_write(path, wav)

        return wav
    except Exception as error:
        log("AivisSpeech synthesis failed: %s" % error)
        return None
