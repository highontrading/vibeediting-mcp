# Changelog

## 0.1.0 (unreleased)

First version.

- MCP server `vibeediting` (stdio, MCP SDK v2) with 44 tools and 4 workflow prompts.
- License check with 24-hour cache, 7-day offline grace and friendly messages. Works on 2 computers per key.
- Local speech-to-text (Whisper) with word timings, for Hindi, English and Hinglish. No Python needed.
- Edit plan with undo: cut silences, fillers and retakes, trim, split, reorder, aspect ratio with crop/blur/pad.
- Word-by-word captions with highlight, 6 styles, Devanagari fonts, SRT/VTT export.
- Titles, lower thirds, text, zooms, and animated templates (counter, bar chart, progress bar, checklist, quote, callout) with no extra install.
- Custom HTML/CSS/JS animations rendered with your installed Chrome or Edge.
- Pexels and Pixabay stock footage with automatic credits.
- Music with automatic ducking, noise reduction, loudness normalization to -14 LUFS.
- Fast previews, final export presets for Reels, Shorts, TikTok and YouTube, YouTube chapters.
- Shorts finder for long videos.
- Claude Code plugin with skills that also work in Codex.
- One-line installers for Mac/Linux (`install.sh`) and Windows (`install.ps1`): they bring a private Node.js if needed, ask for the key and connect Claude Code, Codex, Cursor and the Claude app.
- One-click Claude app extension (`vibeediting.mcpb`).
- `npx -y @vibeediting/mcp --setup` guided setup.
- FFmpeg downloads automatically (checksum verified) when the computer has none with caption support. No Homebrew or winget needed.
- `activate_license` tool: users can paste their key in the chat.
