# vibeediting

Edit your videos by talking to the AI agent you already use: Claude Code, Codex, Cursor or any other MCP client.

> "Cut the silences, add yellow Hinglish captions and a title card, make it a 9:16 reel."

The agent calls vibeediting's tools, and the finished video appears in an `exports` folder next to your video.

- **Private.** Everything runs on your computer. Your footage is never uploaded.
- **Safe.** Your original files are never changed. Every edit can be undone.
- **Made for creators.** Reels, Shorts, TikTok, YouTube and podcast clips. Hindi, English and Hinglish captions.
- **No AI-generated media.** B-roll is animated graphics made with code, or free stock clips from Pexels and Pixabay.

Buy a license and read the tutorials at **[vibeediting.app](https://vibeediting.app)**.

## Install

You need your license key (`VIBE-XXXX-XXXX-XXXX-XXXX`) and one AI app: the Claude app, Claude Code, Codex or Cursor. Nothing else: the installer brings the video tools (FFmpeg), the speech model and, if needed, Node.js.

**Claude app (Mac, Windows):** download `vibeediting.mcpb`, double-click it, click **Install**, paste your key.

**Claude Code, Codex, Cursor:** paste one line.

Mac (Terminal):

```bash
curl -fsSL https://vibeediting.app/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://vibeediting.app/install.ps1 | iex
```

It asks for your key, connects every AI app it finds and downloads what is needed. Then open your video folder in the app and say **"Edit my-video.mp4 into a Reel with captions"**.

Full guide, uninstall and details: [docs/install.md](docs/install.md).

<details>
<summary>Manual setup (for developers)</summary>

Needs Node.js 22.12+. FFmpeg is downloaded automatically on first use if your computer has none with caption support.

```bash
npx -y @vibeediting/mcp --setup                       # guided setup
claude mcp add vibeediting --scope user -- npx -y @vibeediting/mcp
codex mcp add vibeediting -- npx -y @vibeediting/mcp
```

Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "vibeediting": { "command": "npx", "args": ["-y", "@vibeediting/mcp"] } } }
```

Claude Code plugin with workflow skills:

```text
/plugin marketplace add highontrading/vibeediting-mcp
/plugin install vibeediting@vibeediting
```

The license key can be set with `VIBE_LICENSE_KEY`, saved by the setup, or given in the chat ("Activate vibeediting with VIBE-...").

</details>

## How it works

1. The agent looks at your video: transcript, pauses, hook, pacing, a few frames.
2. It tells you its plan and waits for your OK.
3. It changes the edit plan (fast, cheap, undoable).
4. It renders a quick low-resolution preview for you to watch.
5. It fixes what you ask.
6. It renders the final video once.

The first transcription downloads a speech model once (about 550 MB, or 190 MB on older computers).

## Settings (environment variables)

| Variable | What it does |
|---|---|
| `VIBE_LICENSE_KEY` | Your license key (or save it with the setup, or give it in the chat) |
| `PEXELS_API_KEY`, `PIXABAY_API_KEY` | Free keys for stock footage (optional) |
| `VIBE_WHISPER_MODEL` | `tiny`, `base`, `small`, `medium`, `turbo` (default) or `large` |
| `DEEPGRAM_API_KEY`, `OPENAI_API_KEY` | Optional cloud transcription with your own key. Off unless you ask for it. This uploads the audio to that provider |
| `VIBE_TOOLSET=core` | Show a smaller set of 31 tools, for apps that limit the number of tools |
| `VIBE_PROJECT_DIR` | Force the working folder |
| `VIBE_BROWSER_PATH` | Use a specific Chrome/Chromium for animations |
| `VIBE_FFMPEG=managed` | Always use vibeediting's own FFmpeg copy, not one installed on the computer |
| `VIBE_AUTO_DOWNLOAD=0` | Never download FFmpeg automatically |

## Privacy

vibeediting has no telemetry and no analytics. Only these network calls happen:

- **License check** to `vibeediting.app`: your key, an anonymous hashed computer id and the vibeediting version. At most once a day.
- **Model downloads** from Hugging Face, once.
- **FFmpeg download** from GitHub (`eugeneware/ffmpeg-static` release b6.1.1), once, only if your computer has no FFmpeg with caption support. Checksums are verified.
- **Stock footage searches** to Pexels/Pixabay, only if you add a key and ask for stock clips.
- **Cloud transcription**, only if you add your own Deepgram/OpenAI key and ask for it.

Full policy: [vibeediting.app/privacy](https://vibeediting.app/privacy).

## Docs

- [Install guide](docs/install.md)
- [All tools, with example sentences](docs/tools.md)
- [Testing checklist for Mac and Windows](docs/testing-checklist.md)
- [Changelog](CHANGELOG.md)

## For developers

```bash
npm install
npm run check        # lint, typecheck, all tests
npm run build        # dist/cli.js
npm run docs:tools   # regenerate docs/tools.md
npx tsx scripts/demo.mts <folder> <video.mp4> --mock-license --model base
```

Inspect the server with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/cli.js
```
