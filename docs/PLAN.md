# vibeediting MCP: build plan

Date: 2026-10-27. Status: **approved and built** (2026-10-28). The owner asked to go with every recommendation below.

## Decisions taken

1. Node 22+; Mac tutorial uses `brew install ffmpeg-full`. No bundled or downloaded FFmpeg: clear install messages instead.
2. Captions are written as spoken (Devanagari for Hindi). `set_caption_text` lets the agent rewrite lines in Roman Hinglish on request.
3. Default speech model `turbo` (large-v3-turbo q5_0, 574 MB); `small` on Intel Macs and computers with less than 8 GB RAM.
4. Motion graphics: built-in libass templates (no install) plus our own HTML renderer on playwright-core with the installed Chrome/Edge. No Remotion, no HyperFrames.
5. TypeScript 6.0 instead of 7.0, because typescript-eslint does not support 7 yet.
6. All server-side waits stay under 50 s, because many MCP clients cancel requests after 60 s.

What changed on the website side is listed in `docs/website-changes.md`.

All versions, prices and licence terms below were checked against live sources on
2026-10-27 (npm registry, GitHub, official docs). Items marked *unverified* could
not be opened from the build sandbox and need a manual check.

## 1. Stack choices

| Area | Choice | Why |
|---|---|---|
| Runtime | **Node.js 22+** (`engines.node: ">=22.12"`), ESM | Node 20 reached end of life on 2026-04-30. "Node LTS" from nodejs.org installs 24 today and 26 from 2026-10-28. The MCP SDK v2, vitest 5 and the Whisper binding all need 22+. |
| Language | TypeScript 7.0 (the new Go-based `tsc`), strict | Current `latest`. Falls back to 6.0 if any tool needs the old programmatic API. |
| MCP SDK | **`@modelcontextprotocol/server` 2.4.0** (v2) + **zod 4** (`zod/v4`), stdio via `serveStdio` | v2 is the stable line since 2026-07-27 and speaks both the 2025 and the 2026-07-28 protocol, so old and new clients work. The old `@modelcontextprotocol/sdk` 1.32 is only promised fixes until about January 2027. |
| Build | tsdown → one bundled `dist/cli.js`; `bin` has exactly one entry | Small install, fast `npx` cold start. tsup is no longer maintained. |
| Tests | vitest 5, ESLint 10 (flat config), Prettier | Current majors. |
| Video | ffmpeg / ffprobe found on the user's machine (see §4) | As in the brief. |
| Transcription | **whisper.cpp via `@fugood/whisper.node`** (prebuilt binaries for Mac arm64 with Metal, Mac Intel, Windows x64; no compiler needed) | Only maintained Node binding with prebuilt binaries for all three targets. Word timing: `tokenTimestamps` + `maxLen: 1`, then merge tokens into words. Note: its times are milliseconds. |
| Transcription fallback | Spawn the official `whisper-cli` binary (Windows x64 release zips exist; Mac needs our own build) | Richer per-token JSON with DTW alignment. Not needed for milestone 2. |
| Cloud transcription (opt-in) | Deepgram Nova-3 (`language=multi`) and OpenAI `whisper-1` (`verbose_json` + word granularity). `gpt-4o-transcribe` cannot give word timestamps. | Off by default. |
| Captions | Generated `.ass` with one Dialogue per word window, active word restyled (`\1c`, `\fscx`), burned with `subtitles=...:fontsdir=...`; `.srt` export | Works in libass today. HarfBuzz shaping for Devanagari. |
| Fonts (OFL) | Noto Sans Devanagari, Poppins, Mukta (Latin + Devanagari in one family), Inter, Anton, Bebas Neue | All OFL per Google Fonts metadata. Set the font name explicitly per style; never rely on libass fallback for mixed Latin/Devanagari. |
| Motion graphics, tier 1 (no install) | **ffmpeg + libass**: titles, lower thirds, call-outs, counters, animated text via `\move`, `\t`, `\fad`, `\pos`, drawtext/drawbox, zoompan | Zero extra install, zero licence cost. Good enough for milestone 2. |
| Motion graphics, tier 2 | Our own thin HTML/CSS/Canvas renderer on **playwright-core** (Apache-2.0) using the Chrome or Edge **already installed** (`channel: 'chrome'` / `'msedge'`), headless-shell download (~105-125 MB) only if neither exists. Agent writes an HTML template with a `seek(t)` contract; we screenshot frames and pipe to ffmpeg with alpha. | No licence cost, deterministic, charts and complex layouts possible. |
| Not chosen: Remotion | See §3. | Licence and distribution risk, 100+ MB Chrome download, needs a bundler at render time. |
| Considered: HyperFrames | Apache-2.0, HeyGen, does exactly tier 2, used in production at HeyGen. But 0.8.x with several releases per day, Node 22+, own ~100 MB headless-shell download, engine packages lack a licence field on npm. | Keep as an option for tier 2 if our own renderer grows too big. |
| Machine id | Our own 40-line implementation: macOS `ioreg` IOPlatformUUID, Windows `reg query ... MachineGuid`, Linux `/etc/machine-id`, fallback hostname; SHA-256 of id + username | `node-machine-id` is abandoned (2019). `@mongodb-js/native-machine-id` compiles at install (bad for `npx`). |
| Stock | Pexels (200 req/h) and Pixabay (100 req/min, 24-hour cache rule) with the user's keys; `credits.json` | As in the brief. Licence pages need one manual read before launch (*unverified*). |
| CI | GitHub Actions: ubuntu-latest, windows-latest, macos-latest (Apple Silicon); Node 22 and 24; ffmpeg via apt / choco / brew; actions/setup-node v7 | `setup-ffmpeg@v3` still runs on Node 20 and has no Apple Silicon build. |
| npm | Public scoped package, trusted publishing (OIDC) from GitHub Actions after a first manual publish with a granular token | Classic npm tokens were revoked in December 2025. |

## 2. Changes to the website contract (please confirm)

1. **Node version.** "Node.js 20+" becomes **"Node.js 22+"**. Tutorials that say "install Node LTS" need no change.
2. **Mac ffmpeg install.** The Homebrew `ffmpeg` formula was slimmed in January 2026 and **no longer includes libass or drawtext**, so captions would fail. The tutorial must say **`brew install ffmpeg-full`** (installed under `$(brew --prefix)/opt/ffmpeg-full/bin`; we will find it there). `check_setup` will detect the slim build and print this fix.
3. **Windows ffmpeg install.** `winget install Gyan.FFmpeg` or `Gyan.FFmpeg.Essentials` both include libass (verified from the 9.0.2 zip). winget adds ffmpeg to PATH only for new terminals; we also look in `%LOCALAPPDATA%\Microsoft\WinGet\Links`.
4. **`cmd /c npx` on Windows.** Keep it (it avoids Node's EINVAL error when spawning `npx.cmd`), but current Claude Code docs no longer mention it, so it must be tested on a real Windows machine before launch.
5. **Marketing wording.** Three features need honest copy: `remove_fillers` is best-effort (Whisper drops most "umm"/"uh" on its own; we seed a prompt and remove what it keeps); `make_shorts_from_long_video` gives ranked candidate moments and the agent picks; "Hinglish captions" depends on question 3 below.
6. **Plugin for Anthropic's directory.** Local stdio servers are only accepted inside a plugin bundle, the `npx` launcher must be **pinned to an exact version**, and every submission gets a human review. The unpinned `npx -y @vibeediting/mcp` stays correct for the `claude mcp add` tutorials.
7. **Remotion.** The brief's "individuals and small companies are free" is right only while the vendor has at most 3 employees (contractors count from 5.0). See §3.
8. **npm scope.** `@vibeediting` is still unclaimed. **Please create the org now** (free for public packages), so nobody else takes it.

## 3. Remotion: the facts

- Free: individuals, non-profits, for-profit companies with **up to 3 employees**.
- Otherwise a Company Licence. A product that calls `renderMedia()` programmatically is an "automation": **"Remotion for Automators", $0.01 per render with a $100/month minimum** (Enterprise from $500/month). Creator seats ($25/month) explicitly do not cover automations.
- Version 5.0 terms (not yet in force; 4.0 terms apply today and the 4.0 page was *unverified* from the sandbox) add mandatory per-render telemetry for licence holders, allow bundling in a distributed app only behind an "abstraction layer" while still requiring render reporting, and say an end user with 4+ staff who can see or edit the Remotion code needs their own licence. Whether an MCP writing Remotion code into the buyer's folder counts as "code access" is unclear. Only Remotion can answer this in writing.
- Technical: downloads its own pinned Chrome Headless Shell (~105-125 MB) into `node_modules`, discourages using the installed Chrome, requires macOS 15+, and agent-written compositions need `@remotion/bundler` (webpack) on the user's machine at render time.
- Conclusion: not as the primary engine. Our tier 1 + tier 2 above cost nothing and have no telemetry.

## 4. How the server will work

**Project root and path safety.** The server cannot trust `process.cwd()` (Claude Desktop and Cursor sometimes start servers in `$HOME` or `C:\Windows\system32`). Order: `CLAUDE_PROJECT_DIR` env → MCP roots (where the client supports it) → an explicit `project_dir` argument on `create_project`. Every path is resolved and must stay inside that root or `~/.vibeediting/`. Originals are never written to. Symlinks are resolved before the check.

**Working folders.** `.vibeediting/` next to the video holds only small files (project JSON, transcript, credits). Proxies and render caches go to `~/.vibeediting/cache/<project-id>/`, because Windows 11 backs up Desktop/Documents to OneDrive by default and dot-folders are not hidden on NTFS (we also set the hidden attribute). Finished files go to `exports/`.

**Jobs.** `transcribe`, `analyze_video`, `preview_video` and `render` all run as background jobs with progress notifications and `get_job_status`, because Codex's default tool timeout is 300 seconds and a long Hindi transcription on an Intel Mac takes longer. Rendering uses `spawn` with an args array (never a shell string), `windowsHide: true`, and never blocks the event loop.

**Startup.** Claude Code and Codex give the server 30 seconds to start. The entry bundle loads nothing heavy; whisper.node and playwright-core are lazy-imported on first use. Model downloads (from Hugging Face `ggerganov/whisper.cpp`, SHA-256 checked) report progress and can also be triggered by `check_setup`. A mirror on vibeediting.app is optional later.

**Timeline.** `project.json` = clips (source, in, out), caption track, overlay track, audio track, aspect, style, output preset. Edits only change JSON. `preview_video` renders 480p fast; `render` renders once. Silence cuts use a single `filter_complex` with `trim/atrim + setpts + concat` (frame-accurate, keeps sync); the concat demuxer is only used for keyframe-aligned coarse cuts.

**Token economy.** Tools return a short text summary plus file paths. `get_transcript` is paginated and searchable. `analyze_video` returns 1-3 JPEG contact sheets as MCP image content. Server `instructions` stay under Claude Code's 4,096-character limit. The plan → approve → preview → render loop lives in `instructions`, in 4 MCP prompts, and in the SKILL.md files (Cursor and Codex support for MCP prompts is uneven).

**Tool count.** About 38 tools. Claude Code has no per-server cap; Cursor's cap is reportedly 40-80 (*unverified*). If Cursor becomes a problem we fold the small edit tools into one `edit_timeline` with an operation enum, keeping the seven marketed names.

**Licence client.** Exactly as the brief: key normalisation and format check, `POST /api/license/verify` with `{licenseKey, machineId, mcpVersion}`, cache in `~/.vibeediting/license.json` with 24-hour re-check and 7-day offline grace, friendly messages per reason with the activate-license link, `check_license` and `deactivate_this_computer`. The server always starts.

**Privacy.** No telemetry. Outbound calls: licence API, optional Pexels/Pixabay, model downloads. README discloses all three (the directory scanner checks for undisclosed destinations).

## 5. Tool list (38)

Setup: `check_setup`, `check_license`, `deactivate_this_computer`, `download_model`.
Understand: `probe_media`, `transcribe`, `get_transcript`, `analyze_video`, `detect_silences`.
Plan: `create_project`, `get_project`, `cut_silences`, `remove_fillers`, `remove_retakes`, `trim`, `split`, `reorder_clips`, `set_aspect_ratio`, `add_captions`, `set_caption_text` (lets the agent fix or romanise lines), `add_title_card`, `add_lower_third`, `add_zoom`, `add_text_overlay`, `render_motion_graphic`, `search_stock_footage`, `add_broll`, `add_music`, `normalize_audio`, `denoise_audio`.
Output: `preview_video`, `render` (`export_video` kept as an alias name), `get_job_status`, `export_subtitles`, `make_shorts_from_long_video`.
Style: `list_styles`, `apply_style`, `save_style`.

`docs/tools.md` will list inputs and an example prompt for each.

## 6. Open questions for you

1. **Node 22+** instead of 20+: OK?
2. **Mac tutorial** changes to `brew install ffmpeg-full`: OK? And do you want a lazy-download ffmpeg fallback at all? It means hosting or linking a GPL binary (needs a legal check and a source offer). My suggestion: not in milestone 1; clear install messages first.
3. **Hinglish captions in Roman script.** Whisper writes Hindi in Devanagari and cannot be asked for romanised output. Options: (a) captions "as spoken" (Devanagari + English) by default, plus `set_caption_text` so the agent romanises lines when the user asks (costs the user's tokens); (b) a rule-based transliteration library (fast, free, but spellings look academic, not natural); (c) a community Hinglish fine-tuned model (licence unclear). I recommend (a) now, (b) as an option later.
4. **Default Whisper model.** The brief says "small". Small and base are known to output Urdu script for Hindi. I recommend `large-v3-turbo-q5_0` (574 MB download, ~2-3 GB RAM, about 0.5x realtime on an M2 CPU) as the default for Hindi/Hinglish, with `small-q5_1` (190 MB) selectable as "fast", and `small` as the default on Intel Macs. OK?
5. **Motion graphics tier 2.** Own thin renderer on playwright-core using the installed Chrome/Edge (my recommendation), or adopt HyperFrames? Remotion is out unless you want me to write to Remotion for a ruling.
6. **Website copy** for fillers, shorts and Hinglish (§2.5): can you adjust it, or should the tools over-deliver instead?
7. **Create the `@vibeediting` npm org now.** I will not publish without asking; the first publish must be manual, after that CI publishes with trusted publishing.
8. Anything in §2 you cannot change on the website? Then tell me and I adapt the server side.

## 7. Milestones

1. **Skeleton (first).** Repo, SDK v2 server, `check_setup` (ffmpeg with libass check, Node, disk, models), licence client + cache + grace, machine id, path safety, job runner, `probe_media`, unit tests, CI on three OSes, `npm pack` check.
2. **Talking-head reel, end to end.** whisper.node + model download, `transcribe`/`get_transcript`, timeline, `cut_silences`, `remove_fillers` (best-effort), `add_captions` (.ass + fonts), `set_aspect_ratio`, `add_title_card` (libass), `preview_video`, `render`, 4 style presets, first MCP prompt and skill. Integration tests with ffmpeg `lavfi` fixtures. Demo video.
3. **Analysis.** `analyze_video` with contact sheets, hook and pacing notes, loudness (`ebur128`), `normalize_audio` (two-pass loudnorm to -14 LUFS), `denoise_audio` (`afftdn`), `detect_silences`, `add_zoom`.
4. **B-roll.** Tier 2 browser renderer + templates (counter, chart, lower third, call-out), `render_motion_graphic`, Pexels/Pixabay search and download with `credits.json`, `add_broll`, `add_music` with ducking (`sidechaincompress`).
5. **Long-form.** YouTube presets, chapters, `remove_retakes`, `make_shorts_from_long_video`, `export_subtitles`.
6. **Packaging.** Claude Code plugin (`.claude-plugin/plugin.json`, `.mcp.json` with `userConfig` for the key, `marketplace.json`), skills usable by Codex, `list/apply/save_style`, MCP registry `server.json`, docs, changelog, publish dry-run, Mac/Windows manual test checklist.
7. **Later.** FCPXML/EDL export, face-tracking reframe.

After each milestone: a real before/after video and a test list for you.
