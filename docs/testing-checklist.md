# Manual testing checklist

Do this on a real Mac and a real Windows PC before each release. Use a short (30-60 s) video of yourself talking, in Hindi or Hinglish if possible.

## 0. MCP Inspector (developer check, 5 minutes)

```bash
npm run build
VIBE_LICENSE_KEY=VIBE-XXXX-XXXX-XXXX-XXXX npx @modelcontextprotocol/inspector node dist/cli.js
```

- [ ] Tools tab lists 44 tools. Prompts tab lists 4 prompts.
- [ ] `check_setup` shows FFmpeg OK, License OK, working folder.

## 1. Fresh install (as a customer)

On a computer without vibeediting:

- [ ] Mac: paste `curl -fsSL https://vibeediting.app/install.sh | sh` in Terminal. Windows: paste `irm https://vibeediting.app/install.ps1 | iex` in PowerShell.
- [ ] It asks for the key, says which apps it connected, downloads FFmpeg and the model, and ends with "All set!".
- [ ] Try it once on a computer **without** Node.js: it gets its own copy and still works.
- [ ] Claude app: double-click `vibeediting.mcpb`, Install, paste the key, pick the folder. Say "Check my vibeediting setup".
- [ ] Skip the key during install, then say "Activate vibeediting with VIBE-..." in the chat. It activates.
- [ ] Open the video folder in a terminal, start `claude`, run `/mcp`: vibeediting shows as connected.
- [ ] Say "Check my vibeediting setup". Everything important says OK.
- [ ] Say "Check my vibeediting license". It shows "License OK" and "1 of 2 computers".

## 2. The demo: talking-head reel

Say: *"Edit my-video.mp4 into a Reel: cut the silences and umms, add yellow captions and a title card, make it 9:16."*

- [ ] The agent creates a project, transcribes (first time: model download with progress), analyzes.
- [ ] It shows a plan and **waits** for your OK.
- [ ] After OK it edits, then makes a preview in `exports/`. The preview plays.
- [ ] Captions are in sync, the current word is highlighted, Hindi letters look right (no broken letters).
- [ ] Say "make the captions bigger and move the title down". Preview again. It changed.
- [ ] Say "export it". `exports/my-video-reels.mp4` exists, plays on the phone, 1080x1920.
- [ ] The original video is unchanged.

## 3. Other features

- [ ] "Write the captions in Roman Hinglish" rewrites captions.
- [ ] "Undo that" undoes the last change.
- [ ] "Add an animated counter to 10,000 at 0:05" shows the counter.
- [ ] With Chrome/Edge: "Make a custom animation of a rising chart" works.
- [ ] With a Pexels key: "Find stock footage of a city at night and add it at 0:08" works, and `broll/credits.json` exists.
- [ ] "Add music.mp3 quietly" ducks under speech.
- [ ] Long video (10+ min): `analyze_video` and `export_video` run in the background and finish. The app does not time out.
- [ ] "Find the 3 best Shorts" lists moments and creates projects.
- [ ] "Give me an SRT" creates `exports/<name>.srt`.

## 4. License cases

- [ ] Wrong key: every editing tool says "Check your key for typos" with the link. `check_setup` still works.
- [ ] No internet after one successful check: editing still works (offline mode).
- [ ] Third computer with the same key: "Your key is in use on 2 computers".
- [ ] "Deactivate vibeediting on this computer": the slot is freed on the website.

## 5. Other agents

- [ ] Codex: `codex mcp add ...` from the tutorial, same demo prompt works.
- [ ] Cursor: `~/.cursor/mcp.json` from the tutorial. If Cursor warns about too many tools, add `"VIBE_TOOLSET": "core"`.
- [ ] Claude Code plugin: `/plugin marketplace add highontrading/vibeediting-mcp`, `/plugin install vibeediting@vibeediting`, enter the key in the form, then the demo prompt.

## 6. Windows specifics

- [ ] A video in a folder with spaces and non-English letters (for example `C:\Users\Asha\Videos\मेरी रील\take 1.mp4`).
- [ ] Windows Defender does not block the first `npx` run (it may be slow the first time).
- [ ] The video folder is inside OneDrive: export still works.
