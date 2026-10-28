---
name: youtube-long-form
description: Edit a long horizontal YouTube video with vibeediting - tighten pauses, remove retakes, fix the intro, add lower thirds and section titles, export with SRT subtitles and chapters. Use for videos longer than a few minutes meant for YouTube.
license: Proprietary. See https://vibeediting.app/terms
metadata:
  author: vibeediting
  version: "0.1.0"
---

# YouTube long-form edit

Follow the plan, approve, preview, render loop from the `edit-video` skill.

1. `create_project` with `aspect: "16:9"` and style `youtube-clean`. `transcribe`, then `analyze_video`.
2. Read the video with `get_transcript` using `mode: "outline"` (one line per minute) to save tokens.
3. Propose the plan and wait for OK:
   - Gentle pause cuts: `cut_silences` with `min_silence: 0.8` and `keep_pause: 0.2` so it still sounds natural.
   - Retakes (`remove_retakes`, user picks).
   - Trim a slow intro.
   - `add_lower_third` with the speaker's name near the start.
   - Section titles with `add_title_card` (`animation: "fade"`, `background: "box"`).
   - Optional captions (`add_captions` with `position: "bottom"`).
4. Preview parts with `preview_video` and `start`/`end`, not the whole video every time.
5. Export: `export_video` preset `youtube`, then `export_subtitles` (srt) and `export_chapters` (first call with `suggest: true`, write titles, then save). Give the user the chapter text to paste into the description.
