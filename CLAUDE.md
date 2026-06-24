# Claude_chan — guide for future Claude sessions

A **100% local** desktop chat companion. The user types, **Claude** replies
(through the `claude` CLI — **no Anthropic API key**), an anime-girl portrait
changes with the mood, and the reply is **spoken aloud in Japanese**. Single
user, runs locally, launched from VS Code (F5) or `python3 server.py`.

Location: `~/Local/Projects/Claude_chan`. The project is meant to be fully
deletable — everything voice-related lives OUTSIDE the folder (see "Voices").

---

## ⚠️ Hard rules (the user has stated these)

1. **Never regenerate or overwrite anything in `images/`.** The user
   hand-curates the per-emotion folders, intentionally leaving some empty.
   `generate_avatars.py` exists for history only — **do not run it.**
2. **No robotic / fallback voice.** Voice is **AivisSpeech only**. If the engine
   is down, the app stays silent and logs why — that is intended.
3. Editing the user's files: they prefer **nvim**; creating new files is fine.

---

## Architecture

| File | Role |
|------|------|
| `server.py` | Python **stdlib-only** HTTP server (port **8765**). Chat + image + TTS endpoints. Has a long header comment. |
| `index.html` / `style.css` / `app.js` | Frontend. `app.js` header explains the submit flow + audio sync. |
| `images/<emotion>/*.png` | Mood portraits (user-owned). Emotions: happy, talking, thinking, angry, sad, laughing, embarrassed. |
| `generate_avatars.py` | **Do not run.** Made the original placeholders. |
| `.vscode/launch.json` | "Run Claude_chan" (F5). |

### The "no API" chat
`run_claude()` runs: `claude -p <msg> --output-format json --append-system-prompt <SYSTEM_PROMPT>`.
First turn `--session-id <uuid>`, later turns `--resume <uuid>` → keeps context.
`SYSTEM_PROMPT` tells the model to (a) start each reply with a mood tag like
`[happy]`, and (b) end with `###JP### <kana>` — the Japanese line for the voice.
`parse()` splits the result into `(emotion, english_text, japanese_speech)`.

### HTTP endpoints (127.0.0.1:8765)
- `GET /` — static files
- `GET /image?emotion=<e>` → `{emotion, image}` — random non-repeating PNG from
  `images/<e>/`, falling back to `images/thinking/` if empty
- `GET /tts` → `{server: bool, engine: "aivisspeech"|null}`
- `GET /speak?text=<jp>` → WAV bytes (503 if engine down)
- `POST /chat {message}` → `{emotion, text, speech, image}`

### Frontend sync (important, user-requested)
On submit: show "thinking" image + `...`; POST `/chat`; then `prepareSpeech()`
**fully downloads/decodes** the WAV from `/speak` BEFORE revealing anything; once
ready, **image + text + audio fire together** (in sync, no 1s lag). Muted/engine
-down/synth-fail → text+image appear instantly.

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

- **Personality**: `personality.txt` (repo root) is read **live every turn** by
  `read_personality()` and appended to the system prompt. The user edits it
  freely to shape Claude-chan; blank = default behavior. No restart needed.
- **Volume**: playback is fixed at 70% (`VOICE_VOLUME` in app.js). There is no
  in-app volume control (the old dropdown/mute button were removed).
- **Debug logs**: verbose `dlog()` output (gated by `DEBUG` in app.js) goes to
  the browser console (F12).
- **No browser caching**: the server sends `Cache-Control: no-store` so edits to
  app.js/style.css/images appear on a plain reload (don't reintroduce caching,
  or static edits will look "broken" / not apply).

## Running, from scratch
1. Start the engine: `~/.local/bin/aivisspeech-engine`
2. Start the app: `python3 server.py` (or VS Code F5) → http://localhost:8765
3. The `claude` CLI must be logged in (it powers the chat; no API key).

## Known follow-ups offered but not done
- systemd **user service** to auto-start the engine on login.
- In-app **voice dropdown** (switch voice without restarting the server).
- Wiring the voice **style to the mood** (e.g. AivisSpeech emotion styles).
