# Changes needed on vibeediting.app

The MCP keeps every name from the brief: server `vibeediting`, package `@vibeediting/mcp`, start command `npx -y @vibeediting/mcp`, env vars `VIBE_LICENSE_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `VIBE_API_URL`, and the tool names `analyze_video`, `cut_silences`, `add_captions`, `render_motion_graphic`, `export_video`, `check_license`, `deactivate_this_computer`. The license API calls match the brief exactly.

Please change these things on the website and in the tutorials.

## Must change

1. **Host the installers and the extension.** Put these three files in the website's `public/` folder so they are served from the site:

   | File in this repo | URL on the website |
   |---|---|
   | `install/install.sh` | `https://vibeediting.app/install.sh` |
   | `install/install.ps1` | `https://vibeediting.app/install.ps1` |
   | `vibeediting.mcpb` (from the CI "extension" artifact, or `npm run build:mcpb`) | `https://vibeediting.app/download/vibeediting.mcpb` |

   Also make a `/download` page with a big "Download for the Claude app" button, and link the `.mcpb` in the purchase email.

2. **Replace the whole install tutorial.** No more Node.js, Homebrew, `brew install ffmpeg`, `winget` or `claude mcp add` steps for buyers. The tutorial is now:

   - **Claude app:** download `vibeediting.mcpb`, double-click, Install, paste key, pick the videos folder.
   - **Claude Code, Codex, Cursor on Mac:** open Terminal, paste `curl -fsSL https://vibeediting.app/install.sh | sh`, paste the key when asked.
   - **Claude Code, Codex, Cursor on Windows:** open PowerShell, paste `irm https://vibeediting.app/install.ps1 | iex`, paste the key when asked.
   - Then: open the AI app in the video folder and say "Edit my-video.mp4 into a Reel with captions".

   `docs/install.md` has the full text, ready to copy.

3. **Purchase email.** Add the three install options above under the key, and the sentence: "Forgot to paste the key? Just say *Activate vibeediting with VIBE-...* in the chat."

4. **Privacy page.** Add: "If your computer has no FFmpeg with caption support, vibeediting downloads it once from GitHub (ffmpeg-static b6.1.1). If you have no Node.js 22 or newer, the installer downloads it once from nodejs.org."

## Should change (honest marketing)

5. **Filler words.** Say "removes most filler words" instead of "removes all fillers". Whisper often drops "umm" by itself, so some never reach the transcript. The pauses they leave are still cut by `cut_silences`.

6. **Hinglish captions.** Captions come out exactly as spoken. Hindi words are written in Devanagari. If a user wants Roman-script Hinglish, they just ask ("write the captions in Roman Hinglish") and the agent rewrites them. Show this in a tutorial.

7. **Shorts finder.** Say "finds the best moments and lets you pick" rather than "AI picks your viral moments". vibeediting ranks candidates; the agent and the user choose.

## New things to mention

8. **Claude Code plugin (optional, for power users).** Users can install with two commands and get guided workflows:

   ```text
   /plugin marketplace add highontrading/vibeediting-mcp
   /plugin install vibeediting@vibeediting
   ```

   Claude Code asks for the license key in a form, so users do not paste it into a command.

9. **Speech model download.** The first transcription downloads a speech model once: about 550 MB (190 MB on older Intel Macs). Say this in the tutorial so users are not surprised.

10. **Cursor.** If Cursor shows too many tools, set `"VIBE_TOOLSET": "core"` in the `env` block (31 tools instead of 44).

11. **Privacy page.** It must list: the license check (key, anonymous hashed computer id, version), model downloads from Hugging Face, optional Pexels/Pixabay searches, and optional cloud transcription with the user's own Deepgram/OpenAI key (off by default; uploads audio only when the user asks).

12. **Support and terms links.** The plugin points to `https://vibeediting.app/support`, `/terms`, `/privacy` and `/docs`. Make sure these pages exist, or tell me the right URLs.

13. **Docs page for FFmpeg.** Error messages link to `https://vibeediting.app/docs/install-ffmpeg`. Please create that page (or tell me the right URL).

## Needs a real test before launch

14. Run the one-line installer on a real Mac and a real Windows PC with a real key after the npm package is published (`docs/testing-checklist.md`). CI already runs it on fresh GitHub machines with a test key.
15. Double-click the `.mcpb` in the Claude app on Mac and Windows and edit one video.
