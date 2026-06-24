# Claude_chan

A tiny, 100% local chat companion. You type, *I* reply (through the `claude`
CLI you're already logged into — **no Anthropic API key needed**), a little
anime-girl portrait changes to match my mood, and I speak my reply out loud in
Japanese.

## Run it

From VS Code: open this folder and press **F5** ("Run Claude_chan"), or open a
terminal here and run:

```bash
python3 server.py
```

Then open **http://localhost:8765** in your browser.

That's it — pure Python standard library, nothing to install.

## How the "no API" part works

`server.py` shells out to `claude -p` (print mode) and reuses one resumed
session so the conversation keeps its context. It's the same login you use in
the terminal, not a billed API key.

## Voice

I reply in English in the chat bubble but speak a Japanese version of it. Use
the 🔊/🔇 button (top-right) to toggle the voice.

The voice comes **entirely from [VOICEVOX](https://voicevox.hp.peatix.com/)** —
a free, fully-local Japanese TTS engine with natural, cute anime voices. There
is **no fallback**: if VOICEVOX isn't running, the app stays silent, a small
notice shows on the page, and the server prints the reason to its console.

### Setup

1. Install VOICEVOX. On Arch, prefer the prebuilt `voicevox-appimage` (it
   bundles the engine); `voicevox-bin` is GUI-only and needs `voicevox-engine`
   separately. Elsewhere, download it from the website.
2. Start the engine — either launch the VOICEVOX app (the GUI also starts the
   engine), or run it headless (see below). It serves `http://127.0.0.1:50021`.
   Confirm with: `curl http://127.0.0.1:50021/version`
3. Reload the page. The app detects it automatically — nothing to configure.

**Running the engine headless (no GUI window):** extract the engine once and
run it directly, e.g. on Linux from the installed AppImage:

```bash
cd ~/.local/share/voicevox-engine && voicevox --appimage-extract   # one-time
./squashfs-root/vv-engine/run --host 127.0.0.1 --port 50021         # start it
```

The engine must be running whenever you use Claude_chan.

### Choosing the voice

- Pick a character/style by setting an env var when starting the server, e.g.
  `VOICEVOX_SPEAKER=3 python3 server.py`.
- List the available speaker IDs with: `curl http://127.0.0.1:50021/speakers`
  (e.g. 2 = Shikoku Metan, 3 = Zundamon, 8 = Kasukabe Tsumugi).
- If the engine runs on another host/port, set `VOICEVOX_URL` too.

> Cross-platform note: VOICEVOX runs on Windows/macOS/Linux, so this works
> anywhere. Nothing is bundled into the project — only the running engine is
> needed.

## Cross-platform notes (Windows / Mac)

The app itself is just Python stdlib + static files, so it runs anywhere Python
3 and the `claude` CLI are installed. A couple of small things to adjust on
other machines:

- Run it with whatever launches Python 3 there (`python server.py` on Windows,
  `python3 server.py` on macOS/Linux).
- The placeholder avatars were generated with `rsvg-convert` (`generate_avatars.py`).
  You usually don't need to re-run that — the PNGs are already committed in
  `images/`. Just dropping in your own PNGs (below) is the normal path.

## Swapping in your own images

There's one folder per mood under `images/`:

```
images/happy/  talking/  thinking/  angry/  sad/  laughing/  embarrassed/
```

The PNGs in them are simple drawn placeholders (made by `generate_avatars.py`)
so the app works offline without any copyright worries.

To use real pictures, **just drop PNG files into the matching mood folder** —
no code changes needed. The server scans the folder live, picks a random PNG
each time, and avoids showing the same one twice in a row. Put in as many as
you like per mood.

If a mood folder is empty, it automatically falls back to a picture from
`images/thinking/`, so that folder should always have at least one image.

## Uninstall

Just delete this folder. Nothing was installed system-wide.

One note: chat sessions are stored by the `claude` CLI under `~/.claude/`
(shared with all your Claude Code usage), not in this folder, so deleting this
folder leaves those alone — which is what you want.
