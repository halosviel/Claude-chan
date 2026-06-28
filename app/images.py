# ===========================================================================
#  images.py
#
#  Mood portraits and background scenes. Image selection is owned entirely by
#  the server: it scans the hand-curated assets/emotions/<mood>/ folders, never
#  regenerating or overwriting them, and returns a random non-repeating picture
#  (falling back to the FALLBACK_EMOTION folder when a mood folder is empty, by
#  design). Backgrounds are simply listed for the scene picker.
# ===========================================================================

import os
import random

from . import config

# Remembers the last image shown per folder so the same mood does not repeat the
# same picture back to back.
_last_pick = {}


# List the PNG filenames in assets/emotions/<folder>/, sorted. Returns [] when
# the folder does not exist.
def list_pngs(folder):
    directory = os.path.join(config.EMOTIONS_DIR, folder)

    if not os.path.isdir(directory):
        return []

    return sorted(f for f in os.listdir(directory) if f.lower().endswith(".png"))


# Pick a random PNG for a mood, avoiding an immediate repeat. Unknown moods map
# to "talking"; an empty mood folder falls back to FALLBACK_EMOTION (intentional,
# not a bug). Returns a web path like "assets/emotions/happy/foo.png", or None.
def pick_image(emotion):
    if emotion not in config.EMOTIONS:
        emotion = "talking"

    folder = emotion
    files = list_pngs(folder)

    if not files:
        folder = config.FALLBACK_EMOTION
        files = list_pngs(folder)

    if not files:
        return None

    last = _last_pick.get(folder)
    choices = [f for f in files if f != last] or files
    chosen = random.choice(choices)
    _last_pick[folder] = chosen

    return "assets/emotions/%s/%s" % (folder, chosen)


# List every image filename in assets/backgrounds/, sorted, for the scene picker.
def list_backgrounds():
    if not os.path.isdir(config.BACKGROUNDS_DIR):
        return []

    return sorted(
        f for f in os.listdir(config.BACKGROUNDS_DIR)
        if f.lower().endswith(config.IMAGE_EXTS)
    )
