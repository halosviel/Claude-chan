#!/usr/bin/env python3
"""Generates cute placeholder SVG->PNG avatars for each emotion.

  *********************************************************************
  *  DO NOT RUN THIS.  FUTURE CLAUDE: the user now HAND-CURATES the  *
  *  images/<emotion>/ folders (some intentionally empty). Running   *
  *  this script OVERWRITES images/*/<emotion>-N.png and would       *
  *  clobber their pictures. It is kept ONLY for reference/history.  *
  *********************************************************************

This produced the original transparent placeholder faces (drawn as SVG,
rendered to PNG via `rsvg-convert`). The app picks images at runtime straight
from images/<emotion>/ -- no manifest, just files in folders. To add/replace
art, the user drops PNGs into the matching folder; nobody needs to run this.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "images")
SIZE = 400  # rendered PNG resolution (displayed at 280px, so this stays crisp)

# Mood -> accent colour used for the rounded background tile.
ACCENT = {
    "happy":       "#ffd9a0",
    "talking":     "#ffe6c2",
    "thinking":    "#e6dcff",
    "angry":       "#ffc2bd",
    "sad":         "#c2dcff",
    "laughing":    "#ffe08a",
    "embarrassed": "#ffd0e0",
}


def head(tilt, bg=None):
    """Common head + hair, optionally tilted a few degrees. Transparent
    background (no tile) so the character sits directly on the page."""
    return f'''
  <g transform="rotate({tilt} 100 105)">
    <!-- pigtails -->
    <ellipse cx="34" cy="108" rx="22" ry="30" fill="#8a5a2b"/>
    <ellipse cx="166" cy="108" rx="22" ry="30" fill="#8a5a2b"/>
    <circle cx="30" cy="84" r="9" fill="#c44"/>
    <circle cx="170" cy="84" r="9" fill="#c44"/>
    <!-- hair back -->
    <ellipse cx="100" cy="98" rx="66" ry="64" fill="#8a5a2b"/>
    <!-- face -->
    <ellipse cx="100" cy="104" rx="56" ry="56" fill="#ffe3cf"/>
    <!-- bangs -->
    <path d="M44 80 Q100 30 156 80 Q150 60 100 52 Q50 60 44 80 Z" fill="#8a5a2b"/>
    <path d="M60 70 Q72 96 84 72 Q96 100 108 72 Q120 100 132 72 Q142 92 150 74 L150 56 L52 56 Z" fill="#8a5a2b"/>'''


FOOT = '''
  </g>
</svg>'''


def svg(body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" '
            'width="200" height="200">' + body + FOOT)


def blush():
    return ('<ellipse cx="68" cy="120" rx="11" ry="6" fill="#ff9a9a" opacity=".55"/>'
            '<ellipse cx="132" cy="120" rx="11" ry="6" fill="#ff9a9a" opacity=".55"/>')


def faces(emotion, variant):
    """Return the eyes + mouth + extras for an emotion/variant combo."""
    e = emotion
    v = variant  # 1 or 2
    parts = []
    if e == "happy":
        # round shiny eyes, gentle smile
        parts.append('<circle cx="76" cy="106" r="9" fill="#3a2a1a"/>'
                     '<circle cx="124" cy="106" r="9" fill="#3a2a1a"/>'
                     '<circle cx="79" cy="103" r="3" fill="#fff"/>'
                     '<circle cx="127" cy="103" r="3" fill="#fff"/>')
        parts.append('<path d="M82 132 Q100 148 118 132" stroke="#7a4a2a" '
                     'stroke-width="4" fill="none" stroke-linecap="round"/>')
        parts.append(blush())
    elif e == "talking":
        parts.append('<circle cx="76" cy="106" r="8" fill="#3a2a1a"/>'
                     '<circle cx="124" cy="106" r="8" fill="#3a2a1a"/>'
                     '<circle cx="78" cy="103" r="2.5" fill="#fff"/>'
                     '<circle cx="126" cy="103" r="2.5" fill="#fff"/>')
        if v == 1:
            parts.append('<ellipse cx="100" cy="134" rx="9" ry="7" fill="#a0432f"/>')
        else:
            parts.append('<ellipse cx="100" cy="133" rx="11" ry="5" fill="#a0432f"/>')
    elif e == "thinking":
        # eyes looking up-left, small flat mouth, sweat drop
        parts.append('<circle cx="78" cy="103" r="8" fill="#3a2a1a"/>'
                     '<circle cx="126" cy="103" r="8" fill="#3a2a1a"/>'
                     '<circle cx="75" cy="100" r="2.5" fill="#fff"/>'
                     '<circle cx="123" cy="100" r="2.5" fill="#fff"/>')
        parts.append('<path d="M88 134 L112 132" stroke="#7a4a2a" '
                     'stroke-width="4" fill="none" stroke-linecap="round"/>')
        parts.append('<path d="M150 64 q-6 12 0 18 q6 -6 0 -18z" fill="#7ec8ff" opacity=".8"/>')
    elif e == "angry":
        parts.append('<circle cx="76" cy="108" r="8" fill="#3a2a1a"/>'
                     '<circle cx="124" cy="108" r="8" fill="#3a2a1a"/>')
        # angled brows
        parts.append('<path d="M66 94 L88 100" stroke="#5a3a1a" stroke-width="4" stroke-linecap="round"/>'
                     '<path d="M134 94 L112 100" stroke="#5a3a1a" stroke-width="4" stroke-linecap="round"/>')
        parts.append('<path d="M84 138 Q100 128 116 138" stroke="#7a4a2a" '
                     'stroke-width="4" fill="none" stroke-linecap="round"/>')
        if v == 2:
            parts.append('<path d="M150 92 l8 -8 m0 8 l-8 -8" stroke="#e23" stroke-width="3"/>')
    elif e == "sad":
        parts.append('<path d="M68 104 Q76 98 84 104" stroke="#3a2a1a" stroke-width="4" fill="none"/>'
                     '<path d="M116 104 Q124 98 132 104" stroke="#3a2a1a" stroke-width="4" fill="none"/>')
        parts.append('<path d="M84 140 Q100 130 116 140" stroke="#7a4a2a" '
                     'stroke-width="4" fill="none" stroke-linecap="round" '
                     'transform="rotate(180 100 135)"/>')
        # tears
        parts.append('<path d="M76 110 q-4 14 0 20 q4 -6 0 -20z" fill="#7ec8ff"/>')
        if v == 2:
            parts.append('<path d="M124 110 q-4 14 0 20 q4 -6 0 -20z" fill="#7ec8ff"/>')
    elif e == "laughing":
        # closed happy eyes ^ ^, wide open mouth
        parts.append('<path d="M68 108 Q76 98 84 108" stroke="#3a2a1a" stroke-width="4" fill="none" stroke-linecap="round"/>'
                     '<path d="M116 108 Q124 98 132 108" stroke="#3a2a1a" stroke-width="4" fill="none" stroke-linecap="round"/>')
        parts.append('<path d="M82 130 Q100 154 118 130 Z" fill="#a0432f"/>'
                     '<path d="M88 136 Q100 146 112 136 Z" fill="#ff8f8f"/>')
        parts.append(blush())
    elif e == "embarrassed":
        # eyes glancing away, small wavy mouth, heavy blush + steam
        parts.append('<circle cx="76" cy="106" r="7" fill="#3a2a1a"/>'
                     '<circle cx="124" cy="106" r="7" fill="#3a2a1a"/>'
                     '<circle cx="73" cy="104" r="2.5" fill="#fff"/>'
                     '<circle cx="121" cy="104" r="2.5" fill="#fff"/>')
        parts.append('<path d="M88 134 q6 -6 12 0 q6 6 12 0" stroke="#7a4a2a" '
                     'stroke-width="4" fill="none" stroke-linecap="round"/>')
        # strong blush with little shading lines
        parts.append('<ellipse cx="66" cy="120" rx="15" ry="9" fill="#ff7a8c" opacity=".6"/>'
                     '<ellipse cx="134" cy="120" rx="15" ry="9" fill="#ff7a8c" opacity=".6"/>')
        parts.append('<path d="M58 116 l16 0 M58 122 l16 0 M126 116 l16 0 M126 122 l16 0" '
                     'stroke="#e0566a" stroke-width="2" opacity=".7"/>')
        if v == 2:
            parts.append('<path d="M150 60 q-5 8 0 14 M160 58 q-5 8 0 14" '
                         'stroke="#cfd8e0" stroke-width="3" fill="none" '
                         'stroke-linecap="round" opacity=".8"/>')
    return "".join(parts)


def render_png(svg_text, path):
    """Render an SVG string to a PNG file using rsvg-convert."""
    subprocess.run(
        ["rsvg-convert", "-w", str(SIZE), "-h", str(SIZE), "-o", path],
        input=svg_text.encode("utf-8"), check=True,
    )


def main():
    if not os.path.exists(OUT):
        os.makedirs(OUT)
    try:
        subprocess.run(["rsvg-convert", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        sys.exit("error: rsvg-convert not found. Install librsvg, or just drop "
                 "your own PNG files into images/ instead.")

    count = 0
    for emotion, accent in ACCENT.items():
        folder = os.path.join(OUT, emotion)
        os.makedirs(folder, exist_ok=True)
        for variant in (1, 2):
            tilt = -4 if variant == 1 else 4
            body = head(tilt, accent) + faces(emotion, variant)
            path = os.path.join(folder, f"{emotion}-{variant}.png")
            render_png(svg(body), path)
            count += 1
    print(f"wrote {count} PNG avatars into per-emotion folders under {OUT}")


if __name__ == "__main__":
    main()
