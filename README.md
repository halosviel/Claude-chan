# Claude_chan

Claude-code as a dating sim in a virtual machine, fully vibe coded.

**Warning:** Not fully developed yet. Will remove this warning when so.

<p align="center">
    <img width="1827" height="959" alt="screenshot" src="https://github.com/user-attachments/assets/5110df1b-6ff5-4b01-aee9-044dbb37a169" />
    <small><i>Claude-chan is based off <a href="https://gekkan-shoujo-nozakikun.fandom.com/wiki/Chiyo_Sakura">Chiyo Sakura</a>.</i></small>
</p>

## Features
- Terminal app to see logs
- Switch between voices
- Switch between sceneries
- Tons of Claude-chan sprites (by Grok)
- Intuitive controls from dating sims

## Retains everything from Claude-code
- Attachment/long message pasting
- `ESC` to cancel response/thinking
- Permission requests
- Switch between models

Claude-chan's messages are displayed as click-through segments, visual-novel style.

Work in progress!

# Installation
Installation is simple since Claude-chan is made to have as little dependencies as possible!

## Archlinux
### Dependencies
[python3](https://archlinux.org/packages/core/x86_64/python/) - Pacman
```
sudo pacman -S python
```
[claude-code](https://aur.archlinux.org/packages/claude-code) - AUR
```
yay -S claude-code
```

## Windows
### Dependencies
[python3](https://www.python.org/downloads/windows/) - winget
```
winget install Python.Python.3.12
```
If you want to install manually from python.org instead, tick **"Add python.exe to PATH"**.

[claude-code](https://docs.anthropic.com/en/docs/claude-code) - PowerShell
```
irm https://claude.ai/install.ps1 | iex
```
Or if you prefer npm:
```
npm install -g @anthropic-ai/claude-code
```

### Get the source
```
git clone https://github.com/halosviel/Claude-chan.git
cd Claude-chan
```

Make sure you are signed in your respective Claude-code app and have an active subscription!!!

# Usage
## Easy way - VSC
Open the project in VSC and simply press F5. It should open the terminal and you should see something like this:
<img width="1359" height="144" alt="image" src="https://github.com/user-attachments/assets/ea9bc6cb-5796-460f-9858-610a738ba508" />

Then, open the `http://localhost:8765` website in your browser! (might be different)

This works the same on Linux and Windows.

## Hard way - From Source
### Linux
Run AivisSpeech in a new terminal:
```
~/.local/bin/aivisspeech-engine
```
Then run `server.py` in another terminal:
```
cd ~/Local/Projects/Claude_chan
python3 server.py
```

### Windows
Install
[AivisSpeech](https://aivis-project.com/) and launch it. Make sure it's running in the background.

Then run `server.py` from PowerShell (or `cmd`):
```
cd path\to\Claude-chan
python server.py
```

Make sure AivisSpeech and the python server are running simultaneously.
Open the `http://localhost:8765` website in your browser (might be different).

# Troubleshooting
Ask your Claude-code to debug!
