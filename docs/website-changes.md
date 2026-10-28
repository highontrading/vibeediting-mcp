# Changes needed on vibeediting.app

The MCP keeps every name from the brief: server `vibeediting`, package `@vibeediting/mcp`, start command `npx -y @vibeediting/mcp`, env vars `VIBE_LICENSE_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `VIBE_API_URL`, and the tool names `analyze_video`, `cut_silences`, `add_captions`, `render_motion_graphic`, `export_video`, `check_license`, `deactivate_this_computer`. The license API calls match the brief exactly.

Please change these things on the website and in the tutorials.

## Must change

1. **Mac FFmpeg install.** Replace `brew install ffmpeg` with:

   ```bash
   brew install ffmpeg-full
   ```

   Since January 2026 the normal Homebrew `ffmpeg` has no caption support (no libass). Captions and titles would fail. vibeediting finds `ffmpeg-full` by itself, even though Homebrew does not put it on the PATH.

2. **Node version.** Write "Node.js 22 or newer (LTS)". Node 20 is end of life. If the tutorial only says "install Node LTS", it is already fine.

3. **Windows FFmpeg.** `winget install Gyan.FFmpeg` is correct. Add: "Close and reopen your terminal, and restart your AI app, after installing."

## Should change (honest marketing)

4. **Filler words.** Say "removes most filler words" instead of "removes all fillers". Whisper often drops "umm" by itself, so some never reach the transcript. The pauses they leave are still cut by `cut_silences`.

5. **Hinglish captions.** Captions come out exactly as spoken. Hindi words are written in Devanagari. If a user wants Roman-script Hinglish, they just ask ("write the captions in Roman Hinglish") and the agent rewrites them. Show this in a tutorial.

6. **Shorts finder.** Say "finds the best moments and lets you pick" rather than "AI picks your viral moments". vibeediting ranks candidates; the agent and the user choose.

## New things to mention

7. **Claude Code plugin.** Users can install with two commands and get guided workflows:

   ```text
   /plugin marketplace add highontrading/vibeediting-mcp
   /plugin install vibeediting@vibeediting
   ```

   Claude Code asks for the license key in a form, so users do not paste it into a command.

8. **Speech model download.** The first transcription downloads a speech model once: about 550 MB (190 MB on older Intel Macs). Say this in the tutorial so users are not surprised.

9. **Cursor.** If Cursor shows too many tools, set `"VIBE_TOOLSET": "core"` in the `env` block (30 tools instead of 43).

10. **Privacy page.** It must list: the license check (key, anonymous hashed computer id, version), model downloads from Hugging Face, optional Pexels/Pixabay searches, and optional cloud transcription with the user's own Deepgram/OpenAI key (off by default; uploads audio only when the user asks).

11. **Support and terms links.** The plugin points to `https://vibeediting.app/support`, `/terms`, `/privacy` and `/docs`. Make sure these pages exist, or tell me the right URLs.

12. **Docs page for FFmpeg.** Error messages link to `https://vibeediting.app/docs/install-ffmpeg`. Please create that page (or tell me the right URL).

## Needs a real test before launch

13. **`cmd /c npx` on Windows.** Current Claude Code docs no longer mention it. It is harmless, so keep it, but test the Windows tutorial on a real Windows PC with the checklist in `docs/testing-checklist.md`.
