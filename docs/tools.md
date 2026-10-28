# vibeediting tools

This list is generated from the server itself (44 tools). You never call these by hand: you talk to your AI agent, and it calls them. The example sentences show what you can say.

All times are in seconds (`12.5`) or minutes:seconds (`1:05`). Edit tools use the time in the *current edit* (after cuts).

## Setup

### `check_setup`

Check that everything vibeediting needs is ready: FFmpeg (with caption support), license, speech models, browser for custom animations, stock-footage keys, disk space and the working folder. Run this first if anything fails. Set prepare_model=true to download the speech model now (one time, can take a few minutes).

Say: *"Check my vibeediting setup."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `prepare_model` | boolean |  | download the default speech model now |
| `model` | string |  | which model to prepare: tiny, base, small, medium, turbo, large |

### `check_license`

Check the vibeediting license on this computer (use when the user says "Check my vibeediting license"). Contacts the license server.

Say: *"Check my vibeediting license."*

### `activate_license`

Activate vibeediting with the license key the user gives you (VIBE-XXXX-XXXX-XXXX-XXXX, from their purchase email). Saves it on this computer, so it is only needed once. Use when a tool says no license key was found, or the user wants to change their key.

Say: *"Activate vibeediting with VIBE-XXXX-XXXX-XXXX-XXXX."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `key` | string | yes | the license key exactly as the user gave it |

### `deactivate_this_computer`

Free this computer's license slot so the key can be used on another computer (use when the user says "Deactivate vibeediting on this computer"). Ask the user to confirm first.

Say: *"Deactivate vibeediting on this computer."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `confirm` | boolean | yes | must be true: the user confirmed |

### `set_working_folder`

Set the folder that holds the user's videos. vibeediting only reads and writes inside this folder (and its own ~/.vibeediting). Use the full path the user gives you.

Say: *"My videos are in D:\Videos\Reels."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `path` | string | yes | absolute folder path |

### `get_job_status`

Wait for a background job (render, transcription, analysis) and get its result. Waits up to wait_seconds (default 45, max 50) before answering; call again if it is still running. Set cancel=true to stop the job.

Say: *"Is the export done yet?"*

| Input | Type | Required | What it does |
|---|---|---|---|
| `job_id` | string |  | job id; omit to list recent jobs |
| `wait_seconds` | number |  |  |
| `cancel` | boolean |  |  |

## Understand the video

### `probe_media`

Quick facts about a video or audio file: duration, resolution, orientation, fps, rotation, audio. Fast; use before planning.

Say: *"What resolution is talk.mp4?"*

| Input | Type | Required | What it does |
|---|---|---|---|
| `file` | string |  | file path (relative to the working folder); default = project video |
| `project` | string |  | project name; default = the current project |

### `transcribe`

Speech to text with word timings, on this computer (no upload). Needed for captions, filler/retake removal and shorts. Results are cached. For Hindi or Hinglish set language "hi" (captions come out in Devanagari; you can rewrite lines in Roman script with set_caption_text). First use downloads the speech model once. Runs in the background for long videos.

Say: *"Transcribe my video. It is in Hinglish."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `file` | string |  | default = all videos in the project |
| `project` | string |  | project name; default = the current project |
| `language` | string |  | "auto" (default), "hi" Hindi/Hinglish, "en" English, or another code |
| `model` | `tiny` / `base` / `small` / `medium` / `turbo` / `large` |  | default turbo (small on older computers); small is faster |
| `engine` | `local` / `deepgram` / `openai` |  | local (default, private). Cloud engines need the user's own API key and upload the audio |
| `keep_fillers` | boolean |  | try to keep "umm/uh" in the text so they can be removed later (default true) |
| `quality` | `fast` / `best` |  | best = beam search, slower |
| `force` | boolean |  | ignore the cached transcript |

### `get_transcript`

Read the transcript in pages, search it, or get a 1-line-per-minute outline of long videos. With a project (default), times are OUTPUT times of the current edit (cut words are gone) - use these times for edit tools. With file=..., times are the raw file times.

Say: *"Where do I talk about pricing?"*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `file` | string |  |  |
| `page` | integer |  |  |
| `page_size` | integer |  | lines per page (default 60) |
| `search` | string |  | find lines containing this text |
| `mode` | `segments` / `outline` / `words` |  | words = word-level timings between from and to |
| `from` | number,string |  | seconds (12.5) or m:ss (1:05) |
| `to` | number,string |  | seconds (12.5) or m:ss (1:05) |

### `analyze_video`

Review a video like an editor: hook check (first 3 s), pacing, pauses, scene changes, slow parts, loudness (EBU R128), plus 1-2 small contact-sheet images and concrete suggestions. Transcribe first for the best result.

Say: *"Review my video like an editor. Is the hook strong?"*

| Input | Type | Required | What it does |
|---|---|---|---|
| `file` | string |  |  |
| `project` | string |  | project name; default = the current project |
| `frames` | integer |  | frames in the overview image (default 12) |

### `detect_silences`

List the pauses in a video's audio (raw file times). Threshold "auto" adapts to the speaker's loudness. To remove them use cut_silences.

Say: *"How many long pauses are in my video?"*

| Input | Type | Required | What it does |
|---|---|---|---|
| `file` | string |  |  |
| `project` | string |  | project name; default = the current project |
| `threshold_db` | number |  | default auto |
| `min_silence` | number |  | seconds, default 0.5 |

### `view_frames`

See the video: returns ONE small image grid of frames at the times you choose (or evenly spaced). Use target "preview" or "export" to look at the latest rendered file of the project.

Say: *"Show me what the preview looks like at 0:05 and 0:20."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `file` | string |  |  |
| `project` | string |  | project name; default = the current project |
| `target` | `source` / `preview` / `export` |  | default source |
| `times` | list of number,string |  | up to 12 times; default 8 evenly spaced |

## Edit plan

### `create_project`

Start an edit. Makes an edit plan (project) for one or more videos; the originals are never changed. Several videos are joined in order. Creates .vibeediting/ next to the video. Set aspect "9:16" for Reels/Shorts.

Say: *"Start a Reel from talk.mp4."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `videos` | list of string | yes | video file paths, in order |
| `name` | string |  | project name (default: video file name) |
| `aspect` | `9:16` / `1:1` / `4:5` / `16:9` / `original` |  | default original |
| `style` | string |  | style preset name (see list_styles); default bold-yellow-pop or the user's saved default |
| `replace` | boolean |  | start an existing project again from scratch |

### `get_project`

Show the edit plan: clips, overlays (with ids), captions, audio, format, style and recent changes. Without a name, shows the current project (and lists other projects).

Say: *"What have you changed so far?"*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |

### `undo`

Undo the last change to the project (can be repeated).

Say: *"Undo that."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |

### `cut_silences`

Remove pauses from the edit and keep a short natural pause at each cut. Defaults come from the style (fast for Reels, calmer for podcasts). Use dry_run to only report. Change is undoable.

Say: *"Cut the silences but keep it natural."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `threshold_db` | number |  | quieter than this = silence; default auto (adapts to the voice) |
| `min_silence` | number |  | only cut pauses longer than this (s) |
| `keep_pause` | number |  | pause kept on each side of a cut (s) |
| `dry_run` | boolean |  |  |

### `remove_fillers`

Cut filler words ("umm", "uh", "matlab", "basically"...) and stutters ("I I") using the transcript. Best effort: Whisper leaves out many fillers by itself. Default list: um, umm, ummm, uh, uhh, uhm, erm, er, ah, ahh, hmm, hmmm, mm, mmm, matlab, basically, अं, अ... "matlab" and "basically" are only cut when said as a filler (next to a pause). Add words like "achha" or "like" with extra_words. Use dry_run to review first.

Say: *"Remove the umms and "matlab"s."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `extra_words` | list of string |  | more words to treat as fillers |
| `only_words` | list of string |  | use exactly these words instead of the default list |
| `stutters` | boolean |  | remove repeated words like "the the" (default true) |
| `dry_run` | boolean |  |  |

### `remove_retakes`

Find places where the speaker started a sentence and said it again (a retake). First call without apply to get suggestions with ids; show them to the user; then call again with apply=[ids] to cut the earlier attempts.

Say: *"I repeated some sentences. Remove the bad takes."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `apply` | list of string |  | ids of suggestions to cut, e.g. ["s1-r1"] |

### `cut_range`

Delete a part of the edit, given in OUTPUT time (as shown by get_transcript/get_project). Later parts move up. Undoable.

Say: *"Delete 0:42 to 0:51."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `start` | number,string | yes | seconds (12.5) or m:ss (1:05) |
| `end` | number,string | yes | seconds (12.5) or m:ss (1:05) |

### `trim`

Keep only the part between start and end (OUTPUT time). Use start to remove a slow beginning, end to cut the tail.

Say: *"Start the video at my first word and end at 0:58."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `start` | number,string |  | seconds (12.5) or m:ss (1:05) |
| `end` | number,string |  | seconds (12.5) or m:ss (1:05) |

### `split`

Split the clip at an OUTPUT time into two clips (for reordering).

Say: *"Split the video at 0:30."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `at` | number,string | yes | seconds (12.5) or m:ss (1:05) |

### `reorder_clips`

Change the order of clips. Give clip ids (from get_project) in the new order; clips you leave out stay at the end.

Say: *"Put the last part first."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `order` | list of string | yes |  |

### `set_aspect_ratio`

Set the output shape: 9:16 (Reels/Shorts/TikTok), 1:1, 4:5 (feed), 16:9 (YouTube) or original. fit: crop (fill the frame; move the crop with crop_x 0=left..1=right), blur (whole picture over a blurred background), pad (black bars).

Say: *"Make it 9:16 for Reels, keep me in the frame."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `ratio` | `9:16` / `1:1` / `4:5` / `16:9` / `original` | yes |  |
| `fit` | `crop` / `blur` / `pad` |  |  |
| `crop_x` | number |  | 0 = left, 0.5 = center, 1 = right |
| `crop_y` | number |  |  |

## Captions and graphics

### `add_captions`

Turn on burned-in captions from the transcript, word by word with the current word highlighted (style from the project style; override anything here). Captions follow every cut automatically. Call again to change settings; enabled=false turns them off.

Say: *"Add yellow word-by-word captions, 3 words per line."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `enabled` | boolean |  |  |
| `position` | `bottom` / `lower` / `middle` / `top` |  |  |
| `max_words_per_line` | integer |  |  |
| `lines` | `1` or `2` |  |  |
| `highlight` | `color` / `karaoke` / `single` / `none` |  | color = current word coloured; single = one word at a time; karaoke = fill sweep |
| `highlight_color` | string |  | #RRGGBB |
| `text_color` | string |  | #RRGGBB |
| `uppercase` | boolean |  |  |
| `punctuation` | boolean |  |  |
| `pop` | boolean |  | current word pops bigger |
| `size` | number |  | font size as a fraction of the short side (0.08 = big) |
| `font` | string |  | e.g. "Poppins ExtraBold", "Mukta ExtraBold", "Anton Regular" |
| `box` | boolean |  | dark box behind the text |

### `set_caption_text`

Replace the caption words between start and end (OUTPUT time) with new text: fix a wrong word, a brand name, or rewrite Hindi lines in Roman-script Hinglish. Timing is spread over the original words. Does not change the audio.

Say: *"Write the captions from 0:10 to 0:14 in Roman Hinglish."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `start` | number,string | yes | seconds (12.5) or m:ss (1:05) |
| `end` | number,string | yes | seconds (12.5) or m:ss (1:05) |
| `text` | string | yes |  |

### `add_title_card`

Big animated title text (e.g. the hook or the video topic) at a time, drawn on top of the video. Optional smaller subtitle. Animations: pop, fade, slide, typewriter.

Say: *"Add a title "3 mistakes every creator makes" at the start."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `text` | string | yes |  |
| `subtitle` | string |  |  |
| `start` | number,string |  | default 0 |
| `duration` | number |  | seconds, default 2.5 |
| `position` | `center` / `top` / `bottom` |  |  |
| `animation` | `pop` / `fade` / `slide` / `typewriter` |  |  |
| `background` | `none` / `box` / `full` |  | full = solid colour card over the whole frame |
| `color` | string |  | #RRGGBB |

### `add_lower_third`

Name tag in the lower part of the frame (name + optional role), sliding in with an accent bar.

Say: *"Show my name, Asha, Founder of Acme, at 0:03."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `name` | string | yes |  |
| `title` | string |  | role, e.g. "Founder, Acme" |
| `start` | number,string |  | seconds (12.5) or m:ss (1:05) |
| `duration` | number |  |  |
| `side` | `left` / `right` |  |  |

### `add_zoom`

Punch-in zoom for emphasis. Give start (+duration), or auto=true to place zooms at sentence starts every N seconds (uses the transcript; good for talking-head reels).

Say: *"Add punch-in zooms every few seconds."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `start` | number,string |  | seconds (12.5) or m:ss (1:05) |
| `duration` | number |  | default 2 |
| `scale` | number |  | default from style, about 1.12 |
| `x` | number |  | zoom towards: 0 left .. 1 right (default 0.5) |
| `y` | number |  | 0 top .. 1 bottom (default 0.4, the face) |
| `auto` | boolean |  |  |
| `every` | number |  | auto: seconds between zooms (default from style, 7) |

### `add_text_overlay`

Any text on screen (key point, emoji-free label, call to action) at a position and time.

Say: *"Put "Link in bio" at the bottom for the last 3 seconds."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `text` | string | yes |  |
| `start` | number,string | yes | seconds (12.5) or m:ss (1:05) |
| `duration` | number |  |  |
| `position` | `top` / `center` / `bottom` / `top-left` / `top-right` / `bottom-left` / `bottom-right` / `left` / `right` |  |  |
| `size` | number |  | fraction of the short side, default 0.06 |
| `color` | string |  | #RRGGBB |
| `box` | boolean |  |  |
| `animation` | `pop` / `fade` / `slide` / `none` |  |  |
| `font` | string |  |  |

### `render_motion_graphic`

Add an animated graphic (B-roll made with code, no AI generation). Two ways:
1) template (instant, no browser): counter {from,to,prefix,suffix,decimals,label}, bar_chart {title,bars:[{label,value}],prefix,suffix}, progress_bar {percent,label}, checklist {title,items:[...]}, quote {text,author}, callout {text,x,y}.
2) html: write a small self-contained HTML/CSS/JS animation. Transparent background by default. Animate with CSS animations, requestAnimationFrame, or define window.seek = (t) => {...} (t in seconds) to draw each frame. The clock is virtual, so animations are smooth. Fonts available: Poppins, Mukta, Anton, Bebas Neue, Noto Sans Devanagari. Needs Chrome or Edge installed.

Say: *"Show an animated counter to 10,000 subscribers when I say it."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `template` | `counter` / `bar_chart` / `progress_bar` / `checklist` / `quote` / `callout` |  |  |
| `params` | object |  |  |
| `html` | string |  | full HTML document or body content |
| `html_file` | string |  | or a .html file in the working folder |
| `start` | number,string | yes | seconds (12.5) or m:ss (1:05) |
| `duration` | number |  | default 3 |
| `placement` | `full` / `box` |  | html: full frame (default) or a box |
| `box` | object |  | fractions of the frame |

### `update_overlay`

Move, retime, change text or remove an overlay (title, text, lower third, graphic, zoom, B-roll). Get ids from get_project.

Say: *"Move the title to 0:02 and make it shorter."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `id` | string | yes |  |
| `remove` | boolean |  |  |
| `start` | number,string |  | seconds (12.5) or m:ss (1:05) |
| `duration` | number |  |  |
| `text` | string |  |  |
| `subtitle` | string |  |  |
| `position` | string |  |  |
| `color` | string |  | #RRGGBB |
| `scale` | number |  |  |
| `params` | object |  | template parameters to merge |

## B-roll

### `search_stock_footage`

Search free stock videos on Pexels and/or Pixabay with the user's own free API keys. Returns ids like "pexels:12345" for add_broll. Use short English queries ("city traffic night", "typing on laptop").

Say: *"Find a stock clip of a busy Mumbai street."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `query` | string | yes |  |
| `provider` | `pexels` / `pixabay` / `both` |  |  |
| `orientation` | `portrait` / `landscape` / `square` / `any` |  | default: matches the project |
| `min_duration` | number |  |  |
| `per_page` | integer |  | default 6 |
| `show_thumbnails` | boolean |  | return one small image with the thumbnails (costs tokens) |
| `project` | string |  | project name; default = the current project |

### `add_broll`

Put a cutaway clip over the video while the voice continues: a stock clip from search_stock_footage (ref="pexels:123") or the user's own video/image file. mode full = covers the frame, pip = small window. Images get a slow zoom.

Say: *"Use that clip at 0:12 for 3 seconds."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `ref` | string |  | stock id from search_stock_footage |
| `file` | string |  | or a video/image file in the working folder |
| `start` | number,string | yes | seconds (12.5) or m:ss (1:05) |
| `duration` | number |  | default 3 |
| `trim_start` | number |  | seconds into the B-roll clip to start from |
| `mode` | `full` / `pip` |  |  |

## Audio

### `add_music`

Add background music from the user's own audio file (mp3/wav/m4a...). It loops to fit, fades in/out, and is automatically lowered while someone speaks (ducking). remove=true removes it. vibeediting never generates music.

Say: *"Add music.mp3 quietly in the background."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `file` | string |  |  |
| `volume` | number |  | 0.1 = 10% (default from style) |
| `duck` | boolean |  | lower music under speech (default true) |
| `fade_in` | number |  |  |
| `fade_out` | number |  |  |
| `start` | number |  | output second where music starts |
| `remove` | boolean |  |  |

### `normalize_audio`

Make the final loudness even and platform-ready (EBU R128, default -14 LUFS, true peak -1.5 dB). On by default for new projects; measured exactly at export.

Say: *"Make the volume right for Instagram."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `enabled` | boolean |  |  |
| `target_lufs` | number |  |  |

### `denoise_audio`

Reduce steady background noise (fan, AC, hiss) in the voice. light / medium / strong, or off. Strong can make the voice sound thin: check with preview_video.

Say: *"There is a fan noise. Clean it up a bit."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `strength` | `off` / `light` / `medium` / `strong` | yes |  |

## Output

### `preview_video`

Fast, small (480p) render of the current edit so the user can watch it before the final export. Optionally only a part (start/end in output time). Returns the file path and a few frames. Saves to exports/<project>-preview.mp4.

Say: *"Make a quick preview so I can check."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `start` | number,string |  | seconds (12.5) or m:ss (1:05) |
| `end` | number,string |  | seconds (12.5) or m:ss (1:05) |
| `frames` | boolean |  | return a small frame grid (default true) |

### `export_video`

Final render to an H.264 MP4 in the exports folder (never overwrites originals). Preset: auto (project format), reels, shorts, tiktok (1080x1920), youtube (1920x1080), square, portrait (1080x1350). Loudness is measured and normalized exactly. Runs in the background; render once after the user approved the preview.

Say: *"Looks good, export it for Reels."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `preset` | `auto` / `reels` / `shorts` / `tiktok` / `youtube` / `square` / `portrait` |  |  |
| `quality` | `high` / `standard` / `small` |  | standard (default), high = bigger file, small = for sharing |
| `filename` | string |  | file name without folder |

### `export_subtitles`

Write a subtitle file for the current edit (times match the exported video): srt (YouTube, Premiere), vtt (web) or ass (styled). Upload SRT to YouTube for searchable captions.

Say: *"Give me an SRT file for YouTube."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `format` | `srt` / `vtt` / `ass` |  |  |

### `export_chapters`

YouTube chapters. Call with suggest=true to get a compact outline of the edit (1 line per minute) so you can write chapter titles; then call with chapters=[{time, title}] to save exports/<project>-chapters.txt ready to paste into the YouTube description. Rules: first at 0:00, at least 3, each at least 10 s long.

Say: *"Make YouTube chapters for this video."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `suggest` | boolean |  |  |
| `chapters` | list of object |  |  |

### `make_shorts_from_long_video`

Find the best 30-60 s moments in a long video (complete sentences, strong first line, dense speech, few pauses) and create one 9:16 project per chosen moment with captions. Step 1: call without create to get ranked candidates with text; pick with the user. Step 2: call with create=[ids].

Say: *"Find the 3 best Shorts in my podcast."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `count` | integer |  | candidates to return (default 5) |
| `min_seconds` | number |  |  |
| `max_seconds` | number |  |  |
| `keywords` | list of string |  | topics the user cares about |
| `create` | list of string |  | candidate ids to turn into projects, e.g. ["m1","m3"] |
| `style` | string |  |  |

## Styles

### `list_styles`

Show the caption/title styles: built-in presets, the user's saved styles and my-style.json in the working folder.

Say: *"What caption styles do you have?"*

### `apply_style`

Switch the project to a style (fonts, colours, caption look, title animation, pacing, music level). Resets caption overrides unless keep_overrides=true.

Say: *"Use the Hinglish style."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `project` | string |  | project name; default = the current project |
| `style` | string | yes |  |
| `keep_overrides` | boolean |  |  |

### `save_style`

Save a style for later (e.g. "save this as my default"). Starts from the current project's look (style + caption changes) or from another style, applies `changes` (same shape as list_styles entries: fonts, colors, caption, title, pacing, music), and saves to ~/.vibeediting/styles. as_default=true uses it for new projects.

Say: *"Save this look as my default style."*

| Input | Type | Required | What it does |
|---|---|---|---|
| `name` | string | yes |  |
| `project` | string |  | project name; default = the current project |
| `from_style` | string |  |  |
| `changes` | object |  |  |
| `description` | string |  |  |
| `as_default` | boolean |  |  |
