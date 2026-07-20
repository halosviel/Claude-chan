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

# Directory listing cache: dir -> (mtime, [files]). A folder's mtime changes when
# files are added or removed, so hand-edits to the curated folders still show up,
# but repeat requests (e.g. every mood change hits /image) skip the os.listdir.
_listing_cache = {}


# Sorted filenames in a directory matching the given extensions, cached until the
# directory's mtime changes. Returns [] when the directory does not exist.
def _list_dir(directory, exts):
    try:
        mtime = os.path.getmtime(directory)
    except OSError:
        return []

    cached = _listing_cache.get(directory)

    if cached and cached[0] == mtime:
        return cached[1]

    files = sorted(f for f in os.listdir(directory) if f.lower().endswith(exts))
    _listing_cache[directory] = (mtime, files)

    return files


# List the PNG filenames in assets/emotions/<folder>/, sorted. Returns [] when
# the folder does not exist.
def list_pngs(folder):
    return _list_dir(os.path.join(config.EMOTIONS_DIR, folder), (".png",))


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
    return _list_dir(config.BACKGROUNDS_DIR, config.IMAGE_EXTS)


# List the web path of every mood portrait across all emotion folders, so the
# client can preload them and mood swaps show with no fetch/decode flicker.
def list_all_portraits():
    paths = []

    for folder in sorted(config.EMOTIONS | {config.FALLBACK_EMOTION}):
        for name in list_pngs(folder):
            paths.append("assets/emotions/%s/%s" % (folder, name))

    return paths
