# Install vibeediting

You do not need to know anything about coding. Pick the app you use.

You need your license key from the purchase email. It looks like `VIBE-XXXX-XXXX-XXXX-XXXX`.

## Claude app (chat), Mac or Windows: 3 clicks

1. Download **vibeediting.mcpb** from your purchase email or [vibeediting.app/download](https://vibeediting.app/download).
2. Double-click the file. The Claude app opens and shows vibeediting. Click **Install**.
3. Paste your license key and pick the folder that has your videos. Click **Save**.

Now start a chat and say: **"Edit my-video.mp4 into a Reel with captions"**.

## Claude Code, Codex or Cursor: one line

**Mac:** open the **Terminal** app (press Cmd + Space, type `Terminal`, press Enter), paste this line and press Enter:

```bash
curl -fsSL https://vibeediting.app/install.sh | sh
```

**Windows:** open **PowerShell** (press the Windows key, type `PowerShell`, press Enter), paste this line and press Enter:

```powershell
irm https://vibeediting.app/install.ps1 | iex
```

It asks for your license key. Paste it and press Enter. Then it sets up everything by itself in 2 to 10 minutes:

- connects vibeediting to Claude Code, Codex, Cursor and the Claude app (whichever you have)
- downloads the video tools (FFmpeg, about 50 MB)
- downloads the speech-to-text model (about 550 MB)
- installs Node.js privately if your computer does not have a new enough one

When it says **All set!**, close and reopen your AI app, open the folder that has your video, and say: **"Edit my-video.mp4 into a Reel with captions"**.

Nothing needs admin rights. Nothing outside your home folder is changed.

## Forgot the key during install?

Just paste it in the chat: **"Activate vibeediting with VIBE-XXXX-XXXX-XXXX-XXXX"**. The AI saves it for you. You only do this once per computer.

## Already have Node.js? (alternative)

If you are comfortable with a terminal, this does the same as the line above:

```bash
npx -y @vibeediting/mcp --setup
```

## Moving to a new computer

Each key works on 2 computers. On the old computer, say: **"Deactivate vibeediting on this computer"**. Then install on the new one.

## Uninstall

- Claude app: Settings, Extensions, vibeediting, Uninstall.
- Claude Code: `claude mcp remove vibeediting --scope user`
- Codex: delete the `[mcp_servers.vibeediting]` part of `~/.codex/config.toml`
- Cursor: delete the `vibeediting` part of `~/.cursor/mcp.json`
- Then delete the `.vibeediting` folder in your home folder (models, FFmpeg, settings). On Windows also delete `%LOCALAPPDATA%\vibeediting`.

## What the installer does, exactly

1. Checks for Node.js 22.12 or newer. If there is none, it downloads the official Node.js 24 from nodejs.org, checks its SHA-256 checksum and unpacks it into `~/.vibeediting/node` (Windows: `%LOCALAPPDATA%\vibeediting\node`). Your system Node.js, if any, is not touched.
2. Runs `npx -y @vibeediting/mcp --setup`, which:
   - saves your key in `~/.vibeediting/config.json` and checks it with vibeediting.app
   - adds vibeediting to Claude Code (`claude mcp add --scope user`), Codex (`~/.codex/config.toml`), Cursor (`~/.cursor/mcp.json`) and the Claude app (`claude_desktop_config.json`), keeping a `.before-vibeediting` backup of each file it edits
   - downloads FFmpeg 6.1.1 (checksum verified) into `~/.vibeediting/bin` unless your computer already has an FFmpeg with caption support
   - downloads the Whisper speech model into `~/.vibeediting/models`

Options for the setup command: `--license KEY`, `--no-model` (download the model later), `--model small` (smaller model), `--no-apps` (do not connect apps), `--yes` (never ask questions).
