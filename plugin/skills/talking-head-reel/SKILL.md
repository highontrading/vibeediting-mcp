---
name: talking-head-reel
description: Turn a talking-head recording into a punchy vertical Reel, Short or TikTok with vibeediting (silence and filler cuts, word-by-word captions, hook title, punch-in zooms). Use when the user wants a reel, short, or vertical video of themselves talking.
license: Proprietary. See https://vibeediting.app/terms
metadata:
  author: vibeediting
  version: "0.1.0"
---

# Talking-head Reel

Follow the plan, approve, preview, render loop from the `edit-video` skill.

1. `create_project` with `aspect: "9:16"`. Style `bold-yellow-pop`, or `hinglish-pop` if the user speaks Hindi or Hinglish.
2. `transcribe` (language `hi` for Hindi/Hinglish, `en` for English, else `auto`), then `analyze_video`.
3. Propose the plan and wait for OK. A typical plan:
   - Cut silences and filler words (`cut_silences`, `remove_fillers`).
   - Remove retakes: call `remove_retakes`, list the suggestions, cut the ones the user approves.
   - Fix a slow start with `trim` if speech starts late.
   - Captions: 2 to 3 words per line, current word highlighted (`add_captions`).
   - Hook title for the first 2 to 3 seconds (`add_title_card`), written from the first line of the video.
   - Punch-in zooms every 6 to 8 seconds (`add_zoom` with `auto: true`).
   - Music only if the user gives a file (`add_music`).
4. If the source video is horizontal, `set_aspect_ratio` with `fit: "crop"` and check with `view_frames` that the speaker is in frame. Adjust `crop_x` if needed, or use `fit: "blur"`.
5. `preview_video`, ask the user to watch, fix, then `export_video` with preset `reels` (or `shorts` / `tiktok`).
