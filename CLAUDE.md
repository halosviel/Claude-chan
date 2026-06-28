# Claude_chan — guide for future Claude sessions

A **100% local** desktop chat companion. The user types, **Claude** replies
(through the `claude` CLI — **no Anthropic API key**), an anime-girl portrait
changes with the mood, and the reply is **spoken aloud in Japanese**. Single
user, runs locally, launched from VS Code (F5) or `python3 server.py`.

Location: `~/Local/Projects/Claude_chan`. The project is meant to be fully
deletable — everything voice-related lives OUTSIDE the folder (see "Voices").

---

## ⚠️ Hard rules (the user has stated these)

1. **Never regenerate or overwrite anything in `assets/emotions/`.** The user
   hand-curates the per-emotion folders, intentionally leaving some empty.
2. **No robotic / fallback voice.** Voice is **AivisSpeech only**. If the engine
   is down, the app stays silent and logs why — that is intended.
3. Editing the user's files: they prefer **nvim**; creating new files is fine.

---

## Architecture

The code is modular and dependency-free (no build step). Two short explainer
files describe the whole codebase: **`robots.txt`** (for AI) and **`humans.txt`**
(for humans) — read those first. Comments sit **on top of functions**
(Windows-developer style), special behaviors are factored into reusable utils,
and there are no inline comments.

| Path | Role |
|------|------|
| `server.py` | Thin entry point: runs `app.server.main()` (F5 / `python3 server.py`). |
| `app/` | Backend package: `config.py` (constants + `SYSTEM_PROMPT`), `images.py` (portraits/backgrounds), `voice.py` (AivisSpeech), `chat.py` (`run_claude`/`parse`), `server.py` (HTTP Handler + `main`). |
| `index.html` / `style.css` | Page shell + styles. Loads `js/main.js` as a module. |
| `js/` | Frontend ES modules. Entry `main.js` wires the rest. Utilities in `js/util/` (`dom`, `sound`, `animation`). Feature modules: `log`, `markdown`, `windowing`, `startmenu`, `clock`, `avatar`, `backgrounds`, `voice`, `models`, `editor`, `chat`. |
| `assets/emotions/<emotion>/*.png` | Mood portraits (user-owned). Emotions: happy, talking, thinking, angry, sad, laughing, embarrassed. |
| `assets/backgrounds/*.png` | Scene images for the background selector (set behind the avatar). |
| `assets/fonts/` | Bundled fonts: `Snowbell` (primary/chrome) and `Modeseven` (sub/content), via `@font-face`. Title uses Google `Sacramento`. |
| `.vscode/launch.json` | "Run Claude_chan" (F5). |

### The "no API" chat
`app/chat.py`'s `run_claude()` runs: `claude -p <msg> --output-format json --append-system-prompt <SYSTEM_PROMPT>`.
First turn `--session-id <uuid>`, later turns `--resume <uuid>` → keeps context.
`SYSTEM_PROMPT` (in `app/config.py`) tells the model to (a) start each reply with
a mood tag like `[happy]`, and (b) end with `###JP### <kana>` — the Japanese line
for the voice. `parse()` splits the result into `(emotion, english, speech, permission)`.

### HTTP endpoints (127.0.0.1:8765)
- `GET /` — static files
- `GET /image?emotion=<e>` → `{emotion, image}` — random non-repeating PNG from
  `assets/emotions/<e>/`, falling back to `assets/emotions/thinking/` if empty
- `GET /tts` → `{server: bool, engine: "aivisspeech"|null}`
- `GET /speak?text=<jp>` → WAV bytes (503 if engine down)
- `GET /backgrounds` → `{backgrounds: [...]}` ; `GET /permission-sound` → mp3
- `POST /chat {message}` → `{emotion, text, speech, permission, image}`

### The box + reply flow (important, user-requested)
There is **one box** (`js/editor.js`) that is both the input composer AND the
surface Claude-chan types her reply into (the old separate chat bubble was
merged in). On submit (`js/chat.js`): clear + **lock** the box (typing is
disabled and it blurs — the user is kicked out), show a `...` think animation;
POST `/chat`; `prepareSpeech()` decodes the WAV up front; then the reply is
**typed in one character at a time** (`typeOut` in `js/util/animation.js`),
markdown-formatted with the syntax markers hidden, **voice playing in sync**.
When done the box unlocks but keeps the reply on screen until the next
click/keypress clears it back to a fresh input. No voice → it just types silently.

---

## Voices (AivisSpeech)

The voice is rendered by the **AivisSpeech engine** — a local HTTP server with a
**VOICEVOX-compatible API** (`/audio_query` + `/synthesis`). It was chosen for
natural, expressive anime voices (44.1 kHz, Style-Bert-VITS2). VOICEVOX was used
earlier but has been fully removed from the project and system.

### Where it lives (outside the repo)
- Engine binary: `~/.local/share/aivisspeech-engine/Linux-x64/run`
  (downloaded from GitHub `Aivis-Project/AivisSpeech-Engine`, extracted with 7z)
- Headless launcher: `~/.local/bin/aivisspeech-engine` (serves `:10101`).
  NOT on PATH — run the full path. **Does not auto-start on reboot** (no systemd
  unit yet; the user was offered one).
- Voice models on disk: `~/.local/share/AivisSpeech-Engine/Models/<uuid>.aivmx`

### Start the engine (must be running for voice)
```bash
~/.local/bin/aivisspeech-engine      # serves http://127.0.0.1:10101
curl http://127.0.0.1:10101/version  # sanity check
```

### Change the voice
`server.py` sets `AIVIS_SPEAKER` (style id) and `AIVIS_URL` (default
`http://127.0.0.1:10101`). Either edit the default in `server.py`, or override
per-run: `AIVIS_SPEAKER=<id> python3 server.py`.
- **Current default: Runa, Normal = `345585728`.**
- List installed voices + style ids: `curl http://127.0.0.1:10101/speakers`
- After changing, restart the server (F5) and reload the page. To verify a voice
  renders without the UI:
  `curl "http://127.0.0.1:10101/version"` then test via the app's `/speak`.

### Download / add more voices (from AivisHub)
1. Browse the catalog (61+ community models):
   `curl "https://api.aivis-project.com/v1/aivm-models/search?limit=30"`
   → each has `name` and `aivm_model_uuid`.
2. Install one into the engine (downloads the `.aivmx`):
   ```bash
   UUID=<aivm_model_uuid>
   curl -X POST "http://127.0.0.1:10101/aivm_models/install" \
     -F "url=https://api.aivis-project.com/v1/aivm-models/$UUID/download?model_type=AIVMX"
   # HTTP 204 = success. Large models can take 30-90s each.
   ```
3. `curl :10101/speakers` to get the new style id, then set `AIVIS_SPEAKER`.

### Delete voices
```bash
curl -X POST   "http://127.0.0.1:10101/aivm_models/$UUID/unload"
curl -X DELETE "http://127.0.0.1:10101/aivm_models/$UUID/uninstall"   # 204 = gone
```
⚠️ **Mao (まお) and Kohaku (コハク) cannot be deleted** — they are AivisSpeech's
built-in default models. The API returns 400 ("default models cannot be
uninstalled"), and deleting their `.aivmx` files just makes the engine
re-download them on next start. They sit unused since the app uses Runa.

---

## Customization

- **Personality**: her persona, style, and the reply format all live in one
  place — `SYSTEM_PROMPT` in `app/config.py`. (The old live `personality.txt`
  was merged in; that file is no longer read.) Editing the prompt needs a server
  restart: `systemctl --user restart claudechan.service`.
- **Volume**: master scale is `SOUND_SCALE` in `js/util/sound.js`; the voice's
  own level is `VOICE_VOLUME` in `js/voice.js`. There is no in-app volume
  control (the old dropdown/mute button were removed).
- **Debug logs**: verbose `dlog()` output (gated by `DEBUG` in `js/log.js`) goes
  to the browser console (F12) and the in-app terminal window.
- **No browser caching**: the server sends `Cache-Control: no-store` so edits to
  `js/`, `style.css`, and images appear on a plain reload (don't reintroduce
  caching, or static edits will look "broken" / not apply).

## Running, from scratch
1. Start the engine: `~/.local/bin/aivisspeech-engine`
2. Start the app: `python3 server.py` (or VS Code F5) → http://localhost:8765
3. The `claude` CLI must be logged in (it powers the chat; no API key).

## Known follow-ups offered but not done
- systemd **user service** to auto-start the engine on login.
- In-app **voice dropdown** (switch voice without restarting the server).
- Wiring the voice **style to the mood** (e.g. AivisSpeech emotion styles).
